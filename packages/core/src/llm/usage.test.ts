import { createServer, type Server } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openTestDb, type Db } from "../db/client.js";
import { llmUsage, userCredentials } from "../db/schema.js";
import { ensureDefaultUser } from "../users.js";
import {
  LLMCapExceededError, addUsage, dailyTokenCap, getLLM, meterForUser, meteredLLM, modelSettings, newUsage, recordUsage,
  runCollectingUsage, usageToday, usageView, withFallback, withUsage, withUserLLM, type LLM,
} from "./index.js";

const ENV_KEYS = ["HOSTED_LLM_PROVIDER", "HOSTED_LLM_API_KEY", "HOSTED_LLM_BASE_URL", "HOSTED_LLM_QUALITY_MODEL", "HOSTED_LLM_BULK_MODEL",
  "HOSTED_LLM_DAILY_TOKEN_CAP", "LOCAL_ONLY", "ANTHROPIC_API_KEY", "OPENAI_COMPAT_BASE_URL", "LLM_PROVIDER"];
let saved: Record<string, string | undefined>;
let db: Db;
let userId: string;
let server: Server;
let baseUrl: string;
/** Usage the fake provider reports per call; `null` sends none, so the client has to estimate. */
let reported: { prompt_tokens: number; completion_tokens: number } | null = { prompt_tokens: 100, completion_tokens: 50 };
let calls = 0;

beforeAll(async () => {
  db = await openTestDb();
  userId = (await ensureDefaultUser(db, "usage@example.com")).id;
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      calls++;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content: "ready" } }], ...(reported ? { usage: reported } : {}) }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/v1`;
}, 60_000);
afterAll(() => new Promise<void>((r) => server.close(() => r())));

beforeEach(async () => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.HOSTED_LLM_PROVIDER = "openai-compatible";
  process.env.HOSTED_LLM_BASE_URL = baseUrl;
  process.env.HOSTED_LLM_API_KEY = "hosted-key";
  process.env.HOSTED_LLM_QUALITY_MODEL = "big";
  process.env.HOSTED_LLM_BULK_MODEL = "small";
  reported = { prompt_tokens: 100, completion_tokens: 50 };
  calls = 0;
  await db.delete(llmUsage);
  await db.delete(userCredentials);
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

describe("daily token cap", () => {
  it("reads the cap from env: default, number, off", () => {
    expect(dailyTokenCap()).toBe(300_000);
    process.env.HOSTED_LLM_DAILY_TOKEN_CAP = "12000";
    expect(dailyTokenCap()).toBe(12_000);
    process.env.HOSTED_LLM_DAILY_TOKEN_CAP = "0";
    expect(dailyTokenCap()).toBeNull();
    process.env.HOSTED_LLM_DAILY_TOKEN_CAP = "off";
    expect(dailyTokenCap()).toBeNull();
    process.env.HOSTED_LLM_DAILY_TOKEN_CAP = "nonsense";
    expect(dailyTokenCap()).toBe(300_000);
  });

  it("counts what the provider reports and refuses the shared key once the cap is reached", async () => {
    process.env.HOSTED_LLM_DAILY_TOKEN_CAP = "250";
    await withUserLLM(db, userId, async () => {
      const llm = getLLM("quality");
      expect([llm.model, llm.available]).toEqual(["big", true]);
      expect(await llm.text({ system: "s", prompt: "p" })).toBe("ready");
      expect(await usageToday(db, userId)).toMatchObject({ promptTokens: 100, completionTokens: 50, totalTokens: 150, calls: 1 });
      // 150 < 250: one more call is allowed and takes the total past the cap
      expect(await llm.text({ system: "s", prompt: "p" })).toBe("ready");
      expect((await usageToday(db, userId)).totalTokens).toBe(300);
      // now refused before any request leaves the server
      const before = calls;
      await expect(llm.text({ system: "s", prompt: "p" })).rejects.toBeInstanceOf(LLMCapExceededError);
      await expect(getLLM("bulk").json({ name: "x", system: "s", prompt: "p", schema: (await import("zod")).z.object({}) })).rejects.toThrow(/allowance used up/);
      expect(calls).toBe(before);
      // withFallback turns the refusal into the heuristic path, so a pipeline keeps going
      const r = await withFallback(() => llm.text({ system: "s", prompt: "p" }), () => "rules", "test");
      expect(r).toEqual({ value: "rules", usedLLM: false });
    });
    const view = await usageView(db, userId, "hosted");
    expect(view).toMatchObject({ shared: true, capTokens: 250, totalTokens: 300, remainingTokens: 0, exhausted: true });
    expect(new Date(view.resetsAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("estimates tokens when the provider sends no usage", async () => {
    reported = null;
    await withUserLLM(db, userId, async () => {
      await getLLM("quality").text({ system: "x".repeat(300), prompt: "y".repeat(300) });
    });
    const u = await usageToday(db, userId);
    expect(u.calls).toBe(1);
    expect(u.promptTokens).toBeGreaterThanOrEqual(200); // 600 chars / 3
    expect(u.completionTokens).toBeGreaterThan(0);
  });

  it("no cap at all with HOSTED_LLM_DAILY_TOKEN_CAP=0", async () => {
    process.env.HOSTED_LLM_DAILY_TOKEN_CAP = "0";
    await addUsage(db, userId, { promptTokens: 5_000_000, completionTokens: 0, calls: 1 });
    await withUserLLM(db, userId, async () => {
      expect(await getLLM("quality").text({ system: "s", prompt: "p" })).toBe("ready");
    });
    expect((await usageView(db, userId, "hosted")).capTokens).toBeNull();
  });

  it("an own key is counted but never capped", async () => {
    process.env.HOSTED_LLM_DAILY_TOKEN_CAP = "10";
    await addUsage(db, userId, { promptTokens: 1000, completionTokens: 0, calls: 1 });
    const meter = meterForUser(db, userId, "own");
    await expect(Promise.resolve(meter.before?.())).resolves.toBeUndefined();
    const fake: LLM = {
      provider: "openai-compatible", model: "mine", available: true, mode: "openai-compatible",
      async text() { recordUsage({ model: "mine", promptTokens: 7, completionTokens: 3 }); return "ok"; },
      async json() { throw new Error("unused"); },
    };
    expect(await meteredLLM(fake, meter).text({ system: "s", prompt: "p" })).toBe("ok");
    expect(await usageToday(db, userId)).toMatchObject({ totalTokens: 1010, calls: 2 });
    const view = await usageView(db, userId, "own");
    expect(view).toMatchObject({ shared: false, capTokens: null, exhausted: false });
  });

  it("usage is recorded even when the call fails after the provider answered", async () => {
    const meter = meterForUser(db, userId, "hosted");
    const fake: LLM = {
      provider: "openai-compatible", model: "m", available: true, mode: "openai-compatible",
      async text() { recordUsage({ model: "m", promptTokens: 40, completionTokens: 2 }); throw new Error("did not validate"); },
      async json() { throw new Error("unused"); },
    };
    await expect(meteredLLM(fake, meter).text({ system: "s", prompt: "p" })).rejects.toThrow(/validate/);
    expect((await usageToday(db, userId)).totalTokens).toBe(42);
  });

  it("nested collectors each see their own share, and the outer one the whole run", async () => {
    const outer = newUsage();
    const { usage: inner } = await runCollectingUsage(outer, () => withUsage(async () => {
      recordUsage({ model: "m", promptTokens: 10, completionTokens: 5 });
    }));
    recordUsage({ model: "m", promptTokens: 1, completionTokens: 1 }); // outside any collector: ignored
    await runCollectingUsage(outer, async () => { recordUsage({ model: "m", promptTokens: 100, completionTokens: 0 }); });
    expect(inner).toMatchObject({ totalTokens: 15, calls: 1 });
    expect(outer).toMatchObject({ totalTokens: 115, calls: 2, model: "m" });
  });

  it("upserts one row per user and day", async () => {
    await addUsage(db, userId, { promptTokens: 1, completionTokens: 2, calls: 1 }, "2026-01-01");
    await addUsage(db, userId, { promptTokens: 3, completionTokens: 4, calls: 2 }, "2026-01-01");
    await addUsage(db, userId, { promptTokens: 9, completionTokens: 9, calls: 1 }, "2026-01-02");
    expect(await usageToday(db, userId, "2026-01-01")).toEqual({ promptTokens: 4, completionTokens: 6, totalTokens: 10, calls: 3 });
    expect(await usageToday(db, userId, "2026-01-02")).toMatchObject({ totalTokens: 18 });
    expect(await usageToday(db, userId, "2026-01-03")).toMatchObject({ totalTokens: 0, calls: 0 });
  });

  it("settings include today's usage on the shared key", async () => {
    process.env.HOSTED_LLM_DAILY_TOKEN_CAP = "1000";
    await addUsage(db, userId, { promptTokens: 300, completionTokens: 100, calls: 2 });
    const s = await modelSettings(db, userId);
    expect(s.source).toBe("hosted");
    expect(s.usage).toMatchObject({ shared: true, totalTokens: 400, capTokens: 1000, remainingTokens: 600, exhausted: false });
  });
});
