import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { openTestDb } from "../db/client.js";
import { companies, jobs } from "../db/schema.js";
import type { NormalizedJob } from "../contracts.js";
import { BLOCKED_SOURCES, BlockedSourceError, isBlockedBoard, isBlockedCompany, normalizeSourceKey, purgeBlockedSources } from "./blocklist.js";
import { BOARD_REGISTRY } from "./board-registry.js";
import { EARLY_CAREER_BOARDS } from "./board-registry-early-career.js";
import { pollTenant, upsertJobs } from "./normalize.js";
import { seedBoardRegistry } from "./registry-seed.js";

const job = (over: Partial<NormalizedJob> = {}): NormalizedJob => ({
  atsType: "lever", externalId: "1", companyName: "Jobgether", companyToken: "jobgether", title: "Engineer", remote: false,
  descriptionText: "text", applyUrl: "https://jobs.lever.co/jobgether/1", discoveredVia: "feed", ...over,
});

afterEach(() => { vi.unstubAllGlobals(); });

describe("blocklist matching", () => {
  it("catches aggregators by name or token, in any case and punctuation", () => {
    expect(isBlockedCompany({ name: "Jobgether" })).toBe(true);
    expect(isBlockedCompany({ name: "JOBGETHER" })).toBe(true);
    expect(isBlockedCompany({ token: "jobgether" })).toBe(true);
    expect(isBlockedCompany({ name: "Talent.com" })).toBe(true);
    expect(isBlockedCompany({ token: "talent-com" })).toBe(true);
    expect(isBlockedBoard("lever", "Jobgether")).toBe(true);
    expect(isBlockedBoard("ashby", "jobgether")).toBe(true);
  });

  it("matches exactly, never by substring, so real employers are untouched", () => {
    expect(isBlockedCompany({ name: "Stripe", token: "stripe" })).toBe(false);
    expect(isBlockedCompany({ name: "Jobgether Labs Inc", token: "jobgetherlabs" })).toBe(false);
    expect(isBlockedCompany({ name: "Lensator", token: "lensator" })).toBe(false);
    expect(isBlockedCompany({})).toBe(false);
  });

  it("explains every entry and keeps the curated registry free of them", () => {
    expect(BLOCKED_SOURCES.map((b) => b.name)).toContain("Jobgether");
    for (const b of BLOCKED_SOURCES) {
      expect(b.why.length).toBeGreaterThan(20);
      expect(b.tokens.every((t) => t === normalizeSourceKey(t))).toBe(true);
    }
    expect(BOARD_REGISTRY.filter((b) => isBlockedCompany({ name: b.name, token: b.token }))).toEqual([]);
  });
});

describe("refusing blocked sources", () => {
  it("pollTenant refuses without touching the network", async () => {
    const db = await openTestDb();
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await expect(pollTenant(db, "lever", "jobgether")).rejects.toBeInstanceOf(BlockedSourceError);
    expect(f).not.toHaveBeenCalled();
    expect(await db.select().from(companies)).toHaveLength(0);
  });

  it("upsertJobs drops discovered postings from a blocked source but keeps ones the user pasted", async () => {
    const db = await openTestDb();
    const a = await upsertJobs(db, [job({ externalId: "a" }), job({ externalId: "b", discoveredVia: "exa_search" }), job({ externalId: "keep", companyName: "Acme", companyToken: "acme" })]);
    expect(a.added).toBe(1);
    expect((await db.select().from(companies)).map((c) => c.atsToken)).toEqual(["acme"]);
    const p = await upsertJobs(db, [job({ externalId: "mine", discoveredVia: "pasted" })]);
    expect(p.added).toBe(1);
  });
});

describe("purgeBlockedSources", () => {
  async function setup() {
    const db = await openTestDb();
    const [bad] = await db.insert(companies).values({ name: "Jobgether", atsType: "lever", atsToken: "jobgether" }).returning();
    const [good] = await db.insert(companies).values({ name: "Acme", atsType: "greenhouse", atsToken: "acme" }).returning();
    const base = { descriptionText: "x", applyUrl: "https://x.test", remote: false };
    await db.insert(jobs).values([
      { ...base, companyId: bad.id, companyName: "Jobgether", atsType: "lever", externalId: "j1", title: "A" },
      { ...base, companyId: bad.id, companyName: "Jobgether", atsType: "lever", externalId: "j2", title: "B" },
      { ...base, companyId: bad.id, companyName: "Jobgether", atsType: "lever", externalId: "j3", title: "C", closedAt: new Date("2026-01-01") },
      // came in through web discovery with no company row
      { ...base, companyId: null, companyName: "JobGether", atsType: "web", externalId: "w1", title: "D" },
      { ...base, companyId: good.id, companyName: "Acme", atsType: "greenhouse", externalId: "g1", title: "E" },
    ]);
    return { db, bad, good };
  }

  it("closes the open jobs, removes the company rows, and leaves real employers alone", async () => {
    const { db, good } = await setup();
    expect(await purgeBlockedSources(db)).toEqual({ closedJobs: 3, removedCompanies: 1 });
    const open = await db.select().from(jobs).where(isNull(jobs.closedAt));
    expect(open.map((j) => j.externalId)).toEqual(["g1"]);
    // the job that was already closed keeps its original closing time
    const [j3] = await db.select().from(jobs).where(eq(jobs.externalId, "j3"));
    expect(j3.closedAt?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect((await db.select().from(companies)).map((c) => c.id)).toEqual([good.id]);
  });

  it("is idempotent", async () => {
    const { db } = await setup();
    await purgeBlockedSources(db);
    expect(await purgeBlockedSources(db)).toEqual({ closedJobs: 0, removedCompanies: 0 });
  });

  it("runs from seedBoardRegistry and does not bring the company back", async () => {
    const { db } = await setup();
    const log = vi.fn();
    const added = await seedBoardRegistry(db, { log });
    expect(added).toBe(BOARD_REGISTRY.length); // Acme is not a registry entry, so every registry board is new
    expect(log).toHaveBeenCalledWith(expect.stringContaining("closed 3 open job(s) and removed 1 company row(s)"));
    expect(await db.select().from(companies).where(eq(companies.atsToken, "jobgether"))).toHaveLength(0);
    expect(await db.select().from(jobs).where(and(isNull(jobs.closedAt), eq(jobs.companyName, "Jobgether")))).toHaveLength(0);
    expect(await seedBoardRegistry(db, { log })).toBe(0);
  });
});

describe("seedBoardRegistry with new registry entries", () => {
  it("inserts only the missing boards and leaves existing rows (name, poll time) as they were", async () => {
    const db = await openTestDb();
    const first = BOARD_REGISTRY[0];
    const polled = new Date("2026-10-01T00:00:00Z");
    await db.insert(companies).values({ name: "Custom Display Name", atsType: first.atsType, atsToken: first.token, lastPolledAt: polled });
    expect(await seedBoardRegistry(db)).toBe(BOARD_REGISTRY.length - 1);
    const [row] = await db.select().from(companies).where(and(eq(companies.atsType, first.atsType), eq(companies.atsToken, first.token)));
    expect(row.name).toBe("Custom Display Name");
    expect(row.lastPolledAt?.getTime()).toBe(polled.getTime());
    expect(await seedBoardRegistry(db)).toBe(0);
  });

  it("carries the curated early-career boards, each with a distinct feed key", () => {
    expect(EARLY_CAREER_BOARDS.length).toBeGreaterThanOrEqual(25);
    const keys = new Set(BOARD_REGISTRY.map((b) => `${b.atsType}:${b.token}`));
    for (const e of EARLY_CAREER_BOARDS) expect(keys.has(`${e.atsType}:${e.token}`)).toBe(true);
  });
});
