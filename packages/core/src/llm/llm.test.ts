import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openTestDb, type Db } from "../db/client.js";
import { ensureDefaultUser } from "../users.js";
import { decryptSecret, encryptSecret, getLLM, modelSettings, resolveUserLLM, testUserModel, withUserLLM } from "./index.js";

const ENV_KEYS = ["HOSTED_LLM_PROVIDER", "HOSTED_LLM_API_KEY", "HOSTED_LLM_BASE_URL", "HOSTED_LLM_QUALITY_MODEL", "HOSTED_LLM_BULK_MODEL",
  "LOCAL_ONLY", "ANTHROPIC_API_KEY", "OPENAI_COMPAT_BASE_URL", "LLM_PROVIDER", "CREDENTIALS_KEY"];
let saved: Record<string, string | undefined>;
let db: Db;
let userId: string;

beforeAll(async () => {
  db = await openTestDb();
  userId = (await ensureDefaultUser(db, "llm@example.com")).id;
}, 60_000);
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

describe("secrets at rest", () => {
  it("encrypts with AES-256-GCM, a random IV each time, and round-trips", () => {
    process.env.CREDENTIALS_KEY = Buffer.alloc(32, 7).toString("base64");
    const blob = encryptSecret("sk-secret-123");
    expect(blob).toMatch(/^v1:/);
    expect(blob).not.toContain("sk-secret-123");
    expect(decryptSecret(blob)).toBe("sk-secret-123");
    expect(encryptSecret("sk-secret-123")).not.toBe(blob);
  });
});

describe("which model serves a user", () => {
  it("is the hosted env, per tier, and nothing without it", async () => {
    expect((await resolveUserLLM(db, userId, "quality")).available).toBe(false);
    const none = await modelSettings(db, userId);
    expect(none).toMatchObject({ mode: "heuristic", source: "none" });
    expect(none.usage).toMatchObject({ shared: false, capTokens: null });

    process.env.HOSTED_LLM_PROVIDER = "openai-compatible";
    process.env.HOSTED_LLM_BASE_URL = "https://llm.example.com/v1";
    process.env.HOSTED_LLM_API_KEY = "hosted-key";
    process.env.HOSTED_LLM_QUALITY_MODEL = "big";
    process.env.HOSTED_LLM_BULK_MODEL = "small";
    expect((await resolveUserLLM(db, userId, "quality")).model).toBe("big");
    expect((await resolveUserLLM(db, userId, "bulk")).model).toBe("small");
    const view = await modelSettings(db, userId);
    expect(view).toMatchObject({ mode: "openai-compatible", source: "hosted", tiers: { quality: { model: "big" }, bulk: { model: "small" } } });
    expect(view.usage).toMatchObject({ shared: true, capTokens: 300_000 });
    expect(JSON.stringify(view)).not.toContain("hosted-key");

    // Bound per user inside withUserLLM.
    await withUserLLM(db, userId, async () => {
      expect(getLLM("bulk").model).toBe("small");
    });
  });

  it("LOCAL_ONLY refuses the hosted key", async () => {
    process.env.HOSTED_LLM_PROVIDER = "openai-compatible";
    process.env.HOSTED_LLM_BASE_URL = "https://llm.example.com/v1";
    process.env.HOSTED_LLM_API_KEY = "hosted-key";
    process.env.LOCAL_ONLY = "1";
    expect((await resolveUserLLM(db, userId, "quality")).available).toBe(false);
    expect((await modelSettings(db, userId)).localOnly).toBe(true);
  });

  it("the connection test with no model gives a clear error, and never the key on a failure", async () => {
    const t = await testUserModel(db, userId);
    expect(t).toMatchObject({ ok: false, mode: "heuristic" });
    expect(t.error).toMatch(/No model configured/);

    // Point the hosted endpoint somewhere that refuses connections so the test is offline and fast.
    process.env.HOSTED_LLM_PROVIDER = "openai-compatible";
    process.env.HOSTED_LLM_BASE_URL = "http://127.0.0.1:9/v1";
    process.env.HOSTED_LLM_API_KEY = "hosted-key-secret";
    process.env.HOSTED_LLM_QUALITY_MODEL = "big";
    const f = await testUserModel(db, userId, { timeoutMs: 3000 });
    expect(f).toMatchObject({ ok: false, model: "big", mode: "openai-compatible" });
    expect(typeof f.error).toBe("string");
    expect(JSON.stringify(f)).not.toContain("hosted-key-secret");
  });
});
