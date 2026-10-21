import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureDefaultUser, ingestResume, openTestDb, type ApplyDriver, type Db } from "@jobgraph/core";
import { createApp } from "./app.js";
import { uuidOk } from "./http.js";

// Found by scripts/qa-probe.mts: hostile ids and NUL characters came back as 500 with the raw SQL error in the body.
let db: Db;
let app: ReturnType<typeof createApp>;

async function call(method: string, url: string, body?: unknown) {
  const res = await app.request(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}

beforeAll(async () => {
  db = await openTestDb();
  const artifactsRoot = await mkdtemp(path.join(os.tmpdir(), "jobgraph-robust-"));
  const driver: ApplyDriver = { atsType: "web", supports: () => true, async run() { throw new Error("not used"); } };
  app = createApp(db, { runnerDeps: { pickDriver: () => driver, artifactsRoot, allowRealSubmit: false }, mcp: false, defaultUserEmail: "me@example.com" });
  const user = await ensureDefaultUser(db, "me@example.com");
  await ingestResume(db, user.id, "Jordan Rivera\nSan Francisco, CA | jordan@example.com\n\nEXPERIENCE\nSenior Engineer at Acme\nJan 2020 - Present\n- Built React apps\n\nSKILLS\nReact, TypeScript");
}, 60_000);

describe("ids", () => {
  it("accepts only canonical UUIDs", () => {
    expect(uuidOk("8d5acf33-00d2-482f-abe1-5611d9eacbee")).toBe(true);
    expect(uuidOk("8D5ACF33-00D2-482F-ABE1-5611D9EACBEE")).toBe(true);
    for (const bad of ["", "not-a-uuid", "-".repeat(36), "a".repeat(36), "8d5acf33-00d2-482f-abe1-5611d9eacbeg", "8d5acf33-00d2-482f-abe1-5611d9eacbee0", "../../etc/passwd"]) expect(uuidOk(bad)).toBe(false);
  });

  it("answers a malformed application id with 404 on every route, never a 500 with SQL in it", async () => {
    for (const id of ["not-a-uuid", "-".repeat(36), "a".repeat(36), "%27%20OR%201=1"]) {
      for (const action of ["approve-resume", "approve-form", "answer", "skip", "retry"]) {
        const r = await call("POST", `/api/applications/${id}/${action}`, {});
        expect(r.status, `${action} ${id}`).toBe(404);
        expect(r.text).not.toMatch(/Failed query|select "|insert into/i);
      }
      expect((await call("GET", `/api/applications/${id}`)).status).toBe(404);
    }
  });
});

describe("text input", () => {
  it("strips NUL characters instead of failing in the database", async () => {
    const fact = await call("POST", "/api/graph/facts", { text: "At Acme I cut CI time by half\u0000 using Playwright" });
    expect(fact.status).toBe(200);
    const chat = await call("POST", "/api/agent/chat", { text: "hello\u0000 there" });
    expect(chat.status).toBe(200);
    const resume = await call("POST", "/api/profile/resume", { text: "Jordan Rivera\u0000\nEXPERIENCE\nEngineer at Acme\nJan 2020 - Present\n- Built things" });
    expect(resume.status).toBe(200);
  });

  it("refuses an oversized fact with a readable 400", async () => {
    const r = await call("POST", "/api/graph/facts", { text: "x".repeat(4001) });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/under 4000/);
    expect((await call("POST", "/api/graph/facts", { text: "" })).status).toBe(400);
  });

  it("survives a huge pasted resume without freezing (regression: ReDoS in contact extraction)", async () => {
    const t = Date.now();
    const r = await call("POST", "/api/profile/resume", { text: `Jordan Rivera\njordan@example.com\n${"x".repeat(450_000)}` });
    expect(r.status).toBeLessThan(500);
    expect(Date.now() - t).toBeLessThan(10_000);
  });
});

describe("preferences that the server also writes to", () => {
  // Found by scripts/qa-clicks.mts: once the agent had run, the wizard sent preferences.agent back and PUT /api/onboarding answered 400.
  it("accepts the whole preferences object echoed back, and keeps the server's own bookkeeping", async () => {
    const lane = { id: "l1", name: "Frontend", titles: ["Frontend Engineer"], locations: [], remote: "ok", minScore: 0.7 };
    const first = await call("PUT", "/api/profile", { preferences: { titles: ["Engineer"] } });
    expect(first.status).toBe(200);
    // simulate the agent having run
    const { profiles } = await import("@jobgraph/core");
    const [row] = await db.select().from(profiles);
    await db.update(profiles).set({ preferences: { ...(row.preferences as object), agent: { lastTickAt: "2026-01-01T00:00:00.000Z" }, lanes: [lane] } as never });
    const echoed = await call("PUT", "/api/onboarding", { step: "preferences", data: { preferences: { titles: ["Staff Engineer"], remote: "ok", agent: { lastTickAt: "forged" }, lanes: [] }, autoApplyDailyCap: 2 } });
    expect(echoed.status, echoed.text).toBe(200);
    const [after] = await db.select().from(profiles);
    const prefs = after.preferences as { titles: string[]; agent: { lastTickAt: string }; lanes: unknown[] };
    expect(prefs.titles).toEqual(["Staff Engineer"]);
    expect(prefs.agent.lastTickAt).toBe("2026-01-01T00:00:00.000Z");
    expect(prefs.lanes).toHaveLength(1);
  });
});
