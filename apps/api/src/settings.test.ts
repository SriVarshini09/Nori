import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureDefaultUser, ingestResume, openTestDb, userCredentials, type Db } from "@jobgraph/core";
import { createApp } from "./app.js";

const SAVED = { LOCAL_ONLY: process.env.LOCAL_ONLY, HOSTED_LLM_API_KEY: process.env.HOSTED_LLM_API_KEY, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, OPENAI_COMPAT_BASE_URL: process.env.OPENAI_COMPAT_BASE_URL, LLM_PROVIDER: process.env.LLM_PROVIDER };
let db: Db;
let app: ReturnType<typeof createApp>;

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
  await ingestResume(db, user.id, "Jordan Rivera\njordan@example.com\n\nEXPERIENCE\nSenior Software Engineer at Northwind\nJan 2020 - Present\n- Built React apps\n\nSKILLS\nTypeScript, React");
});
afterAll(() => {
  for (const [k, v] of Object.entries(SAVED)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

describe("model settings", () => {
  it("starts in heuristic mode and health reports tiers without keys", async () => {
    const s = await call("GET", "/api/settings/model");
    expect(s.json).toMatchObject({ provider: null, hasKey: false, mode: "heuristic" });
    const h = await call("GET", "/api/health");
    expect(h.json.models).toEqual({ quality: { mode: "heuristic", model: null }, bulk: { mode: "heuristic", model: null } });
  });

  it("stores a Cline key encrypted, never echoes it, and a failing test is a clean ok:false", async () => {
    const put = await call("PUT", "/api/settings/model", { provider: "cline", apiKey: "sk-fake-cline-key-123456" });
    expect(put.status).toBe(200);
    expect(put.json).toMatchObject({ provider: "cline", hasKey: true, mode: "cline", baseUrl: "https://api.cline.bot/api/v1", qualityModel: "deepseek/deepseek-v4-pro", bulkModel: "qwen/qwen3.7-plus" });
    expect(put.text).not.toContain("sk-fake-cline-key-123456");
    const [row] = await db.select().from(userCredentials);
    expect(row.encryptedKey).not.toContain("sk-fake-cline-key-123456");

    // Point the endpoint somewhere that refuses connections so the test is offline and fast.
    await call("PUT", "/api/settings/model", { provider: "cline", baseUrl: "http://127.0.0.1:9/v1" });
    const t = await call("POST", "/api/settings/model/test");
    expect(t.status).toBe(200);
    expect(t.json).toMatchObject({ ok: false, mode: "cline", model: "deepseek/deepseek-v4-pro" });
    expect(typeof t.json.error).toBe("string");
    expect(t.text).not.toContain("sk-fake-cline-key-123456");

    const bad = await call("PUT", "/api/settings/model", { provider: "openai-compatible" });
    expect(bad.status).toBe(400);
    expect((await call("DELETE", "/api/settings/model")).json.mode).toBe("heuristic");
  });

  it("LOCAL_ONLY refuses cloud providers", async () => {
    process.env.LOCAL_ONLY = "1";
    try {
      expect((await call("PUT", "/api/settings/model", { provider: "cline", apiKey: "sk-x-123456" })).status).toBe(409);
      expect((await call("PUT", "/api/settings/model", { provider: "ollama", qualityModel: "qwen3:8b" })).status).toBe(200);
    } finally { delete process.env.LOCAL_ONLY; await call("DELETE", "/api/settings/model"); }
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
  it("downloads nodes, edges and profile without credentials or password hash", async () => {
    await call("PUT", "/api/settings/model", { provider: "cline", apiKey: "sk-export-secret-999" });
    const r = await call("GET", "/api/graph/export");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-disposition")).toMatch(/attachment; filename="jobgraph-export-\d{4}-\d{2}-\d{2}\.json"/);
    expect(r.json.nodes.length).toBeGreaterThan(0);
    expect(Array.isArray(r.json.edges)).toBe(true);
    expect(r.json.profile.userId).toBeTruthy();
    expect(r.text).not.toMatch(/sk-export-secret-999|encrypted_?key|password_?hash/i);
  });
});
