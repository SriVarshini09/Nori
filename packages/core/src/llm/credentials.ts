import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { Db } from "../db/client.js";
import {
  NONE_LLM, getLLM, hostedSpec, llmFromSpec, llmOverridden, localOnly, meteredLLM, modeOf, ollamaSpec, probeOllama, runWithModels,
  boundUserId, scrub, type LLM, type LLMMode, type LLMSpec, type Tier, type UserModels,
} from "./index.js";
import { meterForUser, usageView, type UsageView } from "./usage.js";

/**
 * Which model serves a user, and the encryption helpers for secrets stored on their behalf.
 * Nori runs every account on the operator's model (HOSTED_LLM_* env), a local Ollama when developing, or rules alone.
 * People do not bring their own keys: the product is a subscription, and the model is part of it.
 */

// ---------- encryption at rest ----------

let warnedDerived = false;
let cachedKey: { src: string; key: Buffer } | null = null;

/**
 * 32-byte AES key: CREDENTIALS_KEY (base64 of 32 bytes), else sha256 of APP_SECRET (warned once),
 * else sha256 of a fixed dev string (warned once; fine for a laptop, not for a shared server).
 */
export function credentialsKey(): Buffer {
  const raw = process.env.CREDENTIALS_KEY;
  const src = raw ? `k:${raw}` : `s:${process.env.APP_SECRET ?? ""}`;
  if (cachedKey?.src === src) return cachedKey.key;
  let key: Buffer;
  if (raw) {
    key = Buffer.from(raw, "base64");
    if (key.length !== 32) throw new Error("CREDENTIALS_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32)");
  } else {
    if (!warnedDerived) {
      warnedDerived = true;
      console.warn(process.env.APP_SECRET
        ? "[credentials] CREDENTIALS_KEY is not set; deriving the key-encryption key from APP_SECRET"
        : "[credentials] neither CREDENTIALS_KEY nor APP_SECRET is set; using a development key-encryption key (set CREDENTIALS_KEY in production)");
    }
    key = createHash("sha256").update(`jobgraph-credentials:${process.env.APP_SECRET ?? "jobgraph-dev-secret"}`).digest();
  }
  cachedKey = { src, key };
  return key;
}

/** AES-256-GCM; output "v1:iv:tag:ciphertext" in base64. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", credentialsKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

export function decryptSecret(blob: string): string {
  const [v, iv, tag, ct] = blob.split(":");
  if (v !== "v1" || !iv || !tag || ct === undefined) throw new Error("Unrecognised encrypted secret");
  const decipher = createDecipheriv("aes-256-gcm", credentialsKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8");
}

// ---------- resolution ----------

/** What serves a user: the operator's hosted key, a local Ollama, or nothing (rules only). */
export type ModelSource = "hosted" | "local" | "none";

export type ResolvedModels = UserModels & { source: ModelSource };

/**
 * Both tiers for a user. Order: HOSTED_LLM_* (or legacy) env > local Ollama if a 2 s probe succeeds > none (heuristics).
 * LOCAL_ONLY=1 skips the cloud option. Every call is counted per user and day (usage.ts); the hosted key is capped there.
 */
export async function resolveUserModels(db: Db, userId: string): Promise<ResolvedModels> {
  const metered = (q: LLMSpec, b: LLMSpec, source: ModelSource): ResolvedModels => {
    const meter = meterForUser(db, userId, source);
    return { userId, quality: meteredLLM(llmFromSpec(q), meter), bulk: meteredLLM(llmFromSpec(b), meter), source };
  };
  const hq = hostedSpec("quality"), hb = hostedSpec("bulk");
  if (hq && hb) return metered(hq, hb, "hosted");
  if (await probeOllama()) return metered(ollamaSpec("quality"), ollamaSpec("bulk"), "local");
  return { userId, quality: NONE_LLM, bulk: NONE_LLM, source: "none" };
}

/** The LLM serving `tier` for this user (see resolveUserModels for the order). */
export async function resolveUserLLM(db: Db, userId: string, tier: Tier): Promise<LLM> {
  if (llmOverridden()) return getLLM(tier);
  return (await resolveUserModels(db, userId))[tier];
}

/**
 * Run `fn` with the user's models bound, so every getLLM(tier) inside (tailoring, compose, extraction,
 * classification, chat) is metered for that user. Nested calls for the same user reuse the binding.
 */
export async function withUserLLM<T>(db: Db, userId: string, fn: () => Promise<T>): Promise<T> {
  if (llmOverridden() || boundUserId() === userId) return fn();
  let models: ResolvedModels;
  try {
    models = await resolveUserModels(db, userId);
  } catch (e) {
    console.warn(`[llm] could not resolve models for ${userId}: ${(e as Error).message}`);
    return fn();
  }
  return runWithModels(models, fn);
}

// ---------- settings view + connection test ----------

export type ModelSettings = {
  /** What serves the quality tier right now. */
  mode: LLMMode;
  source: ModelSource;
  tiers: Record<Tier, { mode: LLMMode; model: string | null }>;
  localOnly: boolean;
  /** Today's tokens and the daily allowance. */
  usage: UsageView;
};

export async function modelSettings(db: Db, userId: string): Promise<ModelSettings> {
  const m = await resolveUserModels(db, userId);
  const tier = (llm: LLM) => ({ mode: modeOf(llm), model: llm.available ? llm.model : null });
  return {
    mode: modeOf(m.quality),
    source: m.source,
    tiers: { quality: tier(m.quality), bulk: tier(m.bulk) },
    localOnly: localOnly(),
    usage: await usageView(db, userId, m.source),
  };
}

export type ModelTestResult = { ok: boolean; model: string | null; mode: LLMMode; latencyMs: number; sample: string; error?: string };

/** One tiny completion against the user's quality model (15 s timeout). Never includes the key. */
export async function testUserModel(db: Db, userId: string, opts: { timeoutMs?: number } = {}): Promise<ModelTestResult> {
  const m = await resolveUserModels(db, userId);
  const llm = m.quality;
  if (!llm.available) {
    return { ok: false, model: null, mode: "heuristic", latencyMs: 0, sample: "", error: "No model configured: set HOSTED_LLM_* env, or run Ollama locally" };
  }
  const started = Date.now();
  const hostedKey = process.env.HOSTED_LLM_API_KEY;
  try {
    const timeoutMs = opts.timeoutMs ?? 15_000;
    const out = await Promise.race([
      llm.text({ system: "You are a connectivity check.", prompt: "Reply with the single word ready", maxTokens: 16, timeoutMs }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`No answer within ${timeoutMs / 1000} s`)), timeoutMs + 500).unref()),
    ]);
    return { ok: true, model: llm.model, mode: modeOf(llm), latencyMs: Date.now() - started, sample: scrub(out.trim().slice(0, 80), hostedKey) };
  } catch (e) {
    const raw = e instanceof Error ? (e.name === "TimeoutError" || e.name === "AbortError" ? "Timed out after 15 s" : e.message) : String(e);
    const cause = (e as { cause?: { code?: string; message?: string } }).cause;
    let detail = raw === "fetch failed" && cause ? `Could not reach the endpoint (${cause.code ?? cause.message ?? "network error"})` : raw;
    const http = /^LLM (\d{3}): ?([\s\S]*)$/.exec(detail);
    if (http) {
      const [, code, bodyText] = http;
      let said = bodyText.trim();
      try {
        const j = JSON.parse(said) as { error?: string | { message?: string }; message?: string };
        said = (typeof j.error === "string" ? j.error : j.error?.message) ?? j.message ?? said;
      } catch { /* not JSON */ }
      const who = modeOf(llm);
      detail = code === "401" || code === "403" ? `The ${who} endpoint rejected the API key (HTTP ${code}): ${said}`
        : code === "404" ? `The ${who} endpoint does not know model "${llm.model}" (HTTP 404): ${said}`
        : `HTTP ${code} from the ${who} endpoint: ${said}`;
    }
    return { ok: false, model: llm.model, mode: modeOf(llm), latencyMs: Date.now() - started, sample: "", error: scrub(detail, hostedKey) };
  }
}
