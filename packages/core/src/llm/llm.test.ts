import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openTestDb, type Db } from "../db/client.js";
import { userCredentials } from "../db/schema.js";
import { ensureDefaultUser } from "../users.js";
import {
  decryptSecret, encryptSecret, getLLM, modelSettings, resolveUserLLM, saveUserCredentials, testUserModel, withUserLLM,
} from "./index.js";

const ENV_KEYS = ["HOSTED_LLM_PROVIDER", "HOSTED_LLM_API_KEY", "HOSTED_LLM_BASE_URL", "HOSTED_LLM_QUALITY_MODEL", "HOSTED_LLM_BULK_MODEL",
  "LOCAL_ONLY", "ANTHROPIC_API_KEY", "OPENAI_COMPAT_BASE_URL", "LLM_PROVIDER", "CREDENTIALS_KEY"];
let saved: Record<string, string | undefined>;
let db: Db;
let userId: string;

beforeAll(async () => {
  db = await openTestDb();
  userId = (await ensureDefaultUser(db, "llm@example.com")).id;
}, 60_000);
beforeEach(async () => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  await db.delete(userCredentials);
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

describe("credentials", () => {
  it("encrypts keys with AES-256-GCM and never stores the plain key", async () => {
    process.env.CREDENTIALS_KEY = Buffer.alloc(32, 7).toString("base64");
    const blob = encryptSecret("sk-cline-secret-123");
    expect(blob).toMatch(/^v1:/);
    expect(blob).not.toContain("sk-cline-secret-123");
    expect(decryptSecret(blob)).toBe("sk-cline-secret-123");
    expect(encryptSecret("sk-cline-secret-123")).not.toBe(blob); // random IV
    await saveUserCredentials(db, userId, { provider: "cline", apiKey: "sk-cline-secret-123" });
    const [row] = await db.select().from(userCredentials);
    expect(row.encryptedKey).not.toContain("sk-cline-secret-123");
    expect(row.baseUrl).toBe("https://api.cline.bot/api/v1");
  });

  it("resolves own key > hosted env > none, per tier", async () => {
    expect((await resolveUserLLM(db, userId, "quality")).available).toBe(false);
    expect((await modelSettings(db, userId)).mode).toBe("heuristic");

    process.env.HOSTED_LLM_PROVIDER = "openai-compatible";
    process.env.HOSTED_LLM_BASE_URL = "https://llm.example.com/v1";
    process.env.HOSTED_LLM_API_KEY = "hosted-key";
    process.env.HOSTED_LLM_QUALITY_MODEL = "big";
    process.env.HOSTED_LLM_BULK_MODEL = "small";
    expect((await resolveUserLLM(db, userId, "quality")).model).toBe("big");
    expect((await resolveUserLLM(db, userId, "bulk")).model).toBe("small");

    await saveUserCredentials(db, userId, { provider: "cline", apiKey: "sk-user-key-xyz", bulkModel: "cline-pass/qwen3.7-plus" });
    const q = await resolveUserLLM(db, userId, "quality");
    expect([q.mode, q.model]).toEqual(["cline", "deepseek/deepseek-v4-pro"]);
    expect((await resolveUserLLM(db, userId, "bulk")).model).toBe("cline-pass/qwen3.7-plus");
    const view = await modelSettings(db, userId);
    expect(view).toMatchObject({ provider: "cline", hasKey: true, mode: "cline", source: "own" });
    expect(JSON.stringify(view)).not.toContain("sk-user-key-xyz");

    // Bound per user inside withUserLLM.
    await withUserLLM(db, userId, async () => {
      expect(getLLM("bulk").model).toBe("cline-pass/qwen3.7-plus");
    });
  });

  it("LOCAL_ONLY refuses cloud credentials and hosted keys", async () => {
    process.env.HOSTED_LLM_API_KEY = "hosted-key";
    await saveUserCredentials(db, userId, { provider: "cline", apiKey: "sk-user-key-xyz" });
    process.env.LOCAL_ONLY = "1";
    expect((await resolveUserLLM(db, userId, "quality")).available).toBe(false);
    const t = await testUserModel(db, userId);
    expect(t.ok).toBe(false);
    expect(t.error).toMatch(/LOCAL_ONLY/);
  });

  it("test with no model gives a clear error", async () => {
    const t = await testUserModel(db, userId);
    expect(t).toMatchObject({ ok: false, mode: "heuristic" });
    expect(t.error).toMatch(/No model configured/);
  });
});
