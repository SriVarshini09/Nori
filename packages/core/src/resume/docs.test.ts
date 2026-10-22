import { beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type Db } from "../db/client.js";
import { ingestResume } from "../graph/index.js";
import { createPasswordUser } from "../users.js";
import { SAMPLE_RESUME, STUDENT_RESUME } from "./sample-content.js";
import {
  MAX_DOCS, MAX_VERSIONS, ResumeDocError, createBlankResumeDoc, createResumeDoc, createResumeDocFromGraph, deleteResumeDoc, duplicateResumeDoc, ensureResumeDoc,
  getDefaultResumeDoc, getResumeDoc, listResumeDocVersions, listResumeDocs, rebuildResumeDocFromGraph, restoreResumeDocVersion, setDefaultResumeDoc, updateResumeDoc,
} from "./docs.js";

const TEXT = `Jordan Rivera
San Francisco, CA | jordan.rivera@example.com | (415) 555-0199 | linkedin.com/in/jordanrivera

EXPERIENCE

Senior Software Engineer at Northwind Labs
Jan 2022 – Present
• Led migration of the checkout flow to React and TypeScript, cutting page load time by 45%
• Built a Node.js and PostgreSQL billing service processing $12M in annual payments

EDUCATION
B.S. in Computer Science, University of Washington
2013 - 2017

SKILLS
Languages: Python, TypeScript, JavaScript, SQL
`;

let db: Db;
let a: string, b: string;
const err = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as ResumeDocError; } throw new Error("expected an error"); };

beforeAll(async () => {
  db = await openTestDb();
  a = (await createPasswordUser(db, { email: "a@example.com", password: "password-a1", name: "Jordan Rivera" }))!.id;
  b = (await createPasswordUser(db, { email: "b@example.com", password: "password-b1" }))!.id;
  await ingestResume(db, a, TEXT);
});

describe("resume library", () => {
  it("creates the first document from the graph and makes it the default", async () => {
    expect(await getDefaultResumeDoc(db, a)).toBeNull();
    const first = await ensureResumeDoc(db, a);
    expect(first).toMatchObject({ name: "My resume", source: "graph", isDefault: true, version: 1, templateId: "classic" });
    expect(first!.content.experience.length).toBeGreaterThan(0);
    expect(first!.content.experience[0].bullets.length).toBeGreaterThan(0);
    expect((await ensureResumeDoc(db, a))).toBeNull(); // already has one
    expect((await getDefaultResumeDoc(db, a))!.id).toBe(first!.id);
  });

  it("keeps exactly one default and switches it", async () => {
    const second = await createResumeDoc(db, a, { name: "Sales version", content: SAMPLE_RESUME, templateId: "modern", theme: { accent: "#ff5500" } });
    expect(second.isDefault).toBe(false);
    expect(second.theme).toMatchObject({ accent: "#ff5500", font: "inter" });
    const made = await setDefaultResumeDoc(db, a, second.id);
    expect(made.isDefault).toBe(true);
    const docs = await listResumeDocs(db, a);
    expect(docs.filter((d) => d.isDefault)).toHaveLength(1);
    expect(docs[0].id).toBe(second.id); // default sorts first
    await setDefaultResumeDoc(db, a, docs[1].id);
    expect((await listResumeDocs(db, a)).filter((d) => d.isDefault)).toHaveLength(1);
  });

  it("snapshots before every change and bumps the version", async () => {
    const doc = await createResumeDoc(db, a, { name: "Edit me", content: structuredClone(STUDENT_RESUME) });
    const edited = structuredClone(doc.content);
    edited.summary = "A new summary";
    const v2 = await updateResumeDoc(db, a, doc.id, { content: edited });
    expect(v2.version).toBe(2);
    const v3 = await updateResumeDoc(db, a, doc.id, { name: "Renamed", theme: { fontSize: 11 } });
    expect(v3).toMatchObject({ version: 3, name: "Renamed" });
    expect(v3.theme).toMatchObject({ fontSize: 11 });
    const versions = await listResumeDocVersions(db, a, doc.id);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(versions[1].content.summary).toBeUndefined();
    expect(versions[0].content.summary).toBe("A new summary");
  });

  it("does nothing, and keeps the version, when nothing changed", async () => {
    const doc = await createResumeDoc(db, a, { name: "Same", content: structuredClone(STUDENT_RESUME) });
    const same = await updateResumeDoc(db, a, doc.id, { name: "Same", content: structuredClone(doc.content), templateId: doc.templateId, theme: doc.theme });
    expect(same.version).toBe(1);
    expect(await listResumeDocVersions(db, a, doc.id)).toHaveLength(0);
  });

  it("rejects a stale save with a 409 instead of overwriting another tab's work", async () => {
    const doc = await createResumeDoc(db, a, { name: "Race", content: structuredClone(STUDENT_RESUME) });
    await updateResumeDoc(db, a, doc.id, { name: "Tab one" }, { expectedVersion: 1 });
    const e = await err(updateResumeDoc(db, a, doc.id, { name: "Tab two" }, { expectedVersion: 1 }));
    expect(e).toBeInstanceOf(ResumeDocError);
    expect(e.status).toBe(409);
    expect(e.message).toMatch(/version 2/);
    expect((await getResumeDoc(db, a, doc.id)).name).toBe("Tab one");
  });

  it("applies the new template's look when the template changes, and keeps the user's theme when it does not", async () => {
    const doc = await createResumeDoc(db, a, { name: "Theme", content: structuredClone(STUDENT_RESUME), templateId: "classic" });
    const tweaked = await updateResumeDoc(db, a, doc.id, { theme: { accent: "#123456" } });
    expect(tweaked.theme).toMatchObject({ accent: "#123456", font: "source-sans" });
    const same = await updateResumeDoc(db, a, doc.id, { theme: { margin: 0.8 } });
    expect(same.theme).toMatchObject({ accent: "#123456", margin: 0.8 });
    const switched = await updateResumeDoc(db, a, doc.id, { templateId: "executive" });
    expect(switched.theme).toMatchObject({ font: "garamond", headerAlign: "center" });
    expect((switched.theme as { accent: string }).accent).not.toBe("#123456");
    expect((await err(updateResumeDoc(db, a, doc.id, { templateId: "wordart" }))).message).toMatch(/template/i);
  });

  it("restores an earlier version and records the state it replaced", async () => {
    const doc = await createResumeDoc(db, a, { name: "Restore", content: structuredClone(STUDENT_RESUME) });
    const c2 = structuredClone(doc.content); c2.summary = "Changed";
    await updateResumeDoc(db, a, doc.id, { content: c2, name: "Restore v2" });
    const back = await restoreResumeDocVersion(db, a, doc.id, 1);
    expect(back.name).toBe("Restore");
    expect(back.content.summary).toBeUndefined();
    expect(back.version).toBe(3);
    const labels = (await listResumeDocVersions(db, a, doc.id)).map((v) => v.label);
    expect(labels).toContain("Before restoring version 1");
    expect((await err(restoreResumeDocVersion(db, a, doc.id, 99))).status).toBe(404);
  });

  it(`keeps at most ${MAX_VERSIONS} snapshots`, async () => {
    const doc = await createResumeDoc(db, a, { name: "Many", content: structuredClone(STUDENT_RESUME) });
    for (let i = 0; i < MAX_VERSIONS + 8; i++) await updateResumeDoc(db, a, doc.id, { name: `Many ${i}` });
    const versions = await listResumeDocVersions(db, a, doc.id);
    expect(versions).toHaveLength(MAX_VERSIONS);
    expect(versions[0].version).toBe(MAX_VERSIONS + 8); // newest kept
  }, 60_000);

  it("duplicates, and promotes another document when the default is deleted", async () => {
    const fresh = await createPasswordUser(db, { email: "c@example.com", password: "password-c1" });
    const c = fresh!.id;
    const one = await createResumeDoc(db, c, { name: "One", content: SAMPLE_RESUME });
    expect(one.isDefault).toBe(true);
    const copy = await duplicateResumeDoc(db, c, one.id);
    expect(copy).toMatchObject({ name: "Copy of One", source: "copy", isDefault: false });
    expect(copy.content).toEqual(one.content);
    await deleteResumeDoc(db, c, one.id);
    expect((await getDefaultResumeDoc(db, c))!.id).toBe(copy.id);
    await deleteResumeDoc(db, c, copy.id);
    expect(await getDefaultResumeDoc(db, c)).toBeNull();
    expect(await listResumeDocs(db, c)).toEqual([]);
  });

  it("isolates users and rejects malformed ids", async () => {
    const mine = (await listResumeDocs(db, a))[0];
    expect((await err(getResumeDoc(db, b, mine.id))).status).toBe(404);
    expect((await err(updateResumeDoc(db, b, mine.id, { name: "hijack" }))).status).toBe(404);
    expect((await err(deleteResumeDoc(db, b, mine.id))).status).toBe(404);
    expect((await err(getResumeDoc(db, a, "not-a-uuid"))).status).toBe(404);
    expect(await listResumeDocs(db, b)).toEqual([]);
  });

  it("refreshes from the graph but keeps the summary and layout the user chose", async () => {
    const doc = await createResumeDocFromGraph(db, a, { name: "Graph doc" });
    const mine = structuredClone(doc.content);
    mine.summary = "My own words"; mine.layout = { sections: ["skills", "experience"] }; mine.experience = [];
    await updateResumeDoc(db, a, doc.id, { content: mine });
    const rebuilt = await rebuildResumeDocFromGraph(db, a, doc.id);
    expect(rebuilt.content.experience.length).toBeGreaterThan(0);
    expect(rebuilt.content.summary).toBe("My own words");
    expect(rebuilt.content.layout).toEqual({ sections: ["skills", "experience"] });
    expect((await listResumeDocVersions(db, a, doc.id)).some((v) => v.label === "Before refreshing from your graph")).toBe(true);
  });

  it("makes a blank document from the profile", async () => {
    const blank = await createBlankResumeDoc(db, a, "Blank");
    expect(blank.content.name).toBe("Jordan Rivera");
    expect(blank.content.contact.email).toBeTruthy();
    expect(blank.source).toBe("manual");
  });

  it(`caps a user at ${MAX_DOCS} documents`, async () => {
    const d = await createPasswordUser(db, { email: "d@example.com", password: "password-d1" });
    for (let i = 0; i < MAX_DOCS; i++) await createResumeDoc(db, d!.id, { name: `R${i}`, content: SAMPLE_RESUME });
    const e = await err(createResumeDoc(db, d!.id, { name: "one too many", content: SAMPLE_RESUME }));
    expect(e.status).toBe(409);
  }, 60_000);
});
