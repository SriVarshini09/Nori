import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addUsage, ensureDefaultUser, ingestResume, openTestDb, type Db } from "@jobgraph/core";
import { createApp } from "./app.js";

const SAVED = { LOCAL_ONLY: process.env.LOCAL_ONLY, HOSTED_LLM_API_KEY: process.env.HOSTED_LLM_API_KEY, HOSTED_LLM_PROVIDER: process.env.HOSTED_LLM_PROVIDER, HOSTED_LLM_BASE_URL: process.env.HOSTED_LLM_BASE_URL, HOSTED_LLM_DAILY_TOKEN_CAP: process.env.HOSTED_LLM_DAILY_TOKEN_CAP, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, OPENAI_COMPAT_BASE_URL: process.env.OPENAI_COMPAT_BASE_URL, LLM_PROVIDER: process.env.LLM_PROVIDER };
let db: Db;
let app: ReturnType<typeof createApp>;
let userId: string;

async function call(method: string, url: string, body?: unknown) {
  const res = await app.request(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, json: (text ? JSON.parse(text) : null) as any };
}

beforeAll(async () => {
  for (const k of Object.keys(SAVED)) delete process.env[k];
  db = await openTestDb();
  app = createApp(db, { mcp: false, defaultUserEmail: "me@example.com", notify: async () => undefined });
  const user = await ensureDefaultUser(db, "me@example.com");
  userId = user.id;
  await ingestResume(db, user.id, "Jordan Rivera\njordan@example.com\n\nEXPERIENCE\nSenior Software Engineer at Northwind\nJan 2020 - Present\n- Built React apps\n\nSKILLS\nTypeScript, React");
});
afterAll(() => {
  for (const [k, v] of Object.entries(SAVED)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

describe("model", () => {
  it("is read-only: no keys to save, and health reports tiers", async () => {
    const s = await call("GET", "/api/settings/model");
    expect(s.json).toMatchObject({ mode: "heuristic", source: "none" });
    expect(s.json.usage).toMatchObject({ totalTokens: 0, capTokens: null });
    for (const method of ["PUT", "DELETE"]) expect((await call(method, "/api/settings/model", { provider: "cline", apiKey: "sk-x" })).status).toBe(404);
    expect((await call("POST", "/api/settings/model/test")).status).toBe(404);
    expect((await call("GET", "/api/settings/model/presets")).status).toBe(404);
    const h = await call("GET", "/api/health");
    expect(h.json.models).toEqual({ quality: { mode: "heuristic", model: null }, bulk: { mode: "heuristic", model: null } });
  });

  it("shows today's use against the daily allowance on the hosted key", async () => {
    process.env.HOSTED_LLM_PROVIDER = "openai-compatible";
    process.env.HOSTED_LLM_BASE_URL = "https://llm.example.com/v1";
    process.env.HOSTED_LLM_API_KEY = "hosted-key-secret";
    process.env.HOSTED_LLM_DAILY_TOKEN_CAP = "5000";
    try {
      await addUsage(db, userId, { promptTokens: 1200, completionTokens: 300, calls: 3 });
      const s = await call("GET", "/api/settings/model");
      expect(s.json).toMatchObject({ source: "hosted", usage: { shared: true, totalTokens: 1500, capTokens: 5000, remainingTokens: 3500, exhausted: false, calls: 3 } });
      expect(s.text).not.toContain("hosted-key-secret");
    } finally {
      for (const k of ["HOSTED_LLM_PROVIDER", "HOSTED_LLM_BASE_URL", "HOSTED_LLM_API_KEY", "HOSTED_LLM_DAILY_TOKEN_CAP"]) delete process.env[k];
    }
  });
});

describe("lanes", () => {
  it("validates, fills ids, and shows in agent status", async () => {
    expect((await call("GET", "/api/lanes")).json).toEqual([]);
    expect((await call("PUT", "/api/lanes", [{ titles: ["x"] }])).status).toBe(400);
    const put = await call("PUT", "/api/lanes", [
      { name: "Senior Frontend", titles: ["Senior Frontend Engineer"], locations: ["San Francisco"], remote: "ok", minScore: 0.3 },
      { name: "Staff", titles: ["Staff Engineer"], remote: "only", minScore: 70, enabled: false },
    ]);
    expect(put.status).toBe(200);
    expect(put.json.map((l: any) => [l.id, l.minScore, l.enabled])).toEqual([["senior-frontend", 0.3, true], ["staff", 0.7, false]]);
    expect((await call("GET", "/api/lanes")).json).toHaveLength(2);
    const status = await call("GET", "/api/agent/status");
    expect(status.json.mode).toBe("heuristic");
    expect(status.json.lanes).toEqual([
      { id: "senior-frontend", name: "Senior Frontend", enabled: true, queuedToday: 0 },
      { id: "staff", name: "Staff", enabled: false, queuedToday: 0 },
    ]);
  });
});

describe("graph export", () => {
  it("downloads nodes, edges and profile without secrets or password hash", async () => {
    const r = await call("GET", "/api/graph/export");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-disposition")).toMatch(/attachment; filename="jobgraph-export-\d{4}-\d{2}-\d{2}\.json"/);
    expect(r.json.nodes.length).toBeGreaterThan(0);
    expect(Array.isArray(r.json.edges)).toBe(true);
    expect(r.json.profile.userId).toBeTruthy();
    expect(r.text).not.toMatch(/encrypted_?key|password_?hash/i);
  });
});
