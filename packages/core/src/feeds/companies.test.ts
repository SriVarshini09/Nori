import { describe, expect, it } from "vitest";
import { openTestDb } from "../db/client.js";
import { ensureDefaultUser } from "../users.js";
import { ATS_TYPES } from "../db/schema.js";
import { BOARD_REGISTRY } from "./board-registry.js";
import { followCompany, listCompanies, unfollowCompany } from "./companies.js";
import { findBoardsInHtml } from "./detect.js";
import { seedBoardRegistry } from "./registry-seed.js";

describe("board registry", () => {
  it("is a large, clean list of supported boards with no duplicates", () => {
    expect(BOARD_REGISTRY.length).toBeGreaterThan(100);
    const keys = BOARD_REGISTRY.map((b) => `${b.atsType}:${b.token}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const b of BOARD_REGISTRY) {
      expect(["greenhouse", "lever", "ashby", "smartrecruiters"]).toContain(b.atsType);
      expect(ATS_TYPES).toContain(b.atsType);
      expect(b.token).toMatch(/^[A-Za-z0-9_.-]+$/);
      expect(b.name.trim().length).toBeGreaterThan(1);
    }
  });

  it("seeds the companies table once and leaves existing rows alone", async () => {
    const db = await openTestDb();
    expect(await seedBoardRegistry(db)).toBe(BOARD_REGISTRY.length);
    expect(await seedBoardRegistry(db)).toBe(0);
  });
});

describe("following companies", () => {
  it("lists, searches, follows and unfollows per user", async () => {
    const db = await openTestDb();
    await seedBoardRegistry(db);
    const me = await ensureDefaultUser(db);
    const all = await listCompanies(db, me.id);
    expect(all.total).toBe(BOARD_REGISTRY.length);
    expect(all.companies.length).toBe(60);
    expect(all.companies.every((c) => !c.followed)).toBe(true);

    const hit = await listCompanies(db, me.id, { q: "stripe" });
    expect(hit.companies.map((c) => c.name)).toContain("Stripe");
    expect((await listCompanies(db, me.id, { q: "%" })).total).toBe(0); // a wildcard is searched for literally
    expect((await listCompanies(db, me.id, { q: "zzzz-no-such-company" })).total).toBe(0);

    const stripe = hit.companies.find((c) => c.name === "Stripe")!;
    expect(await followCompany(db, me.id, stripe.atsType, stripe.token)).toBe(true);
    expect(await followCompany(db, me.id, stripe.atsType, stripe.token)).toBe(true); // idempotent
    expect(await followCompany(db, me.id, "greenhouse", "not-a-watched-board")).toBe(false);
    const mine = await listCompanies(db, me.id, { followedOnly: true });
    expect(mine.companies.map((c) => c.name)).toEqual(["Stripe"]);

    await unfollowCompany(db, me.id, stripe.atsType, stripe.token);
    expect((await listCompanies(db, me.id, { followedOnly: true })).total).toBe(0);
  });
});

describe("findBoardsInHtml", () => {
  it("finds embedded and linked boards across all 13 ATS platforms, most mentioned first, and ignores look-alike words", () => {
    const html = `
      <iframe src="https://boards.greenhouse.io/embed/job_board?for=acme"></iframe>
      <a href="https://boards.greenhouse.io/acme/jobs/1">x</a><a href="https://boards.greenhouse.io/acme/jobs/2">y</a>
      <script src="https://boards.greenhouse.io/embed/job_board/js?for=acme"></script>
      <a href="https://jobs.lever.co/other-co">Lever</a>
      <a href="https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite">Workday</a>
      <a href="https://apply.workable.com/workable-co">Workable</a>
      <a href="https://ats.rippling.com/rippling-co/jobs">Rippling</a>
      <a href="https://recruitee-co.recruitee.com">Recruitee</a>
      <a href="https://bamboohr-co.bamboohr.com/careers">BambooHR</a>
      <a href="https://pinpoint-co.pinpointhq.com">Pinpoint</a>
      <a href="https://breezy-co.breezy.hr">Breezy</a>
      <a href="https://app.dover.com/DoverCo/careers/11111111-2222-3333-4444-555555555555">Dover</a>
      <a href="https://personio-co.jobs.personio.de">Personio</a>
      <a href="https://jobs.ashbyhq.com/embed">not a company</a>`;
    const found = findBoardsInHtml(html);
    expect(found[0]).toMatchObject({ atsType: "greenhouse", token: "acme" });
    const keys = found.map((f) => `${f.atsType}:${f.token}`);
    expect(keys).toContain("lever:other-co");
    expect(keys).toContain("workday:nvidia:wd5:NVIDIAExternalCareerSite");
    expect(keys).toContain("workable:workable-co");
    expect(keys).toContain("rippling:rippling-co");
    expect(keys).toContain("recruitee:recruitee-co");
    expect(keys).toContain("bamboohr:bamboohr-co");
    expect(keys).toContain("pinpoint:pinpoint-co");
    expect(keys).toContain("breezy:breezy-co");
    expect(keys).toContain("dover:DoverCo:11111111-2222-3333-4444-555555555555");
    expect(keys).toContain("personio:personio-co");
    expect(found.some((f) => f.token.toLowerCase() === "embed")).toBe(false);
    expect(findBoardsInHtml("<p>No board here, just words about careers.</p>")).toEqual([]);
  });
});
