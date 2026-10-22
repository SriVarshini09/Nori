import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { userCredentials, type LlmProviderId } from "../db/schema.js";
import { assertModelUrlAllowed } from "./presets.js";
import {
  CLINE_BASE_URL, CLINE_DEFAULT_MODELS, NONE_LLM, forgetUserModels, getLLM, hostedSpec, isLocalUrl, llmFromSpec, llmOverridden,
  localOnly, modeOf, ollamaSpec, probeOllama, runWithModels, boundUserId, scrub,
  type LLM, type LLMMode, type LLMSpec, type Tier, type UserModels,
} from "./index.js";

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

// ---------- storage ----------

export type UserCredentialsRow = typeof userCredentials.$inferSelect;
export type CredentialsInput = {
  provider: LlmProviderId;
  /** Omit to keep the stored key; "" clears it. */
  apiKey?: string;
  baseUrl?: string | null;
  qualityModel?: string | null;
  bulkModel?: string | null;
};

export async function getUserCredentials(db: Db, userId: string): Promise<UserCredentialsRow | null> {
  const [row] = await db.select().from(userCredentials).where(eq(userCredentials.userId, userId)).limit(1);
  return row ?? null;
}

const defaultBaseUrl = (p: LlmProviderId): string | null => (p === "cline" ? CLINE_BASE_URL : p === "ollama" ? null : null);

/** Upsert the user's model settings. The key is encrypted before it touches the database. */
export async function saveUserCredentials(db: Db, userId: string, input: CredentialsInput): Promise<UserCredentialsRow> {
  const current = await getUserCredentials(db, userId);
  const sameProvider = current?.provider === input.provider;
  const encryptedKey = input.apiKey === undefined ? (sameProvider ? current?.encryptedKey ?? null : null)
    : input.apiKey.trim() === "" ? null : encryptSecret(input.apiKey.trim());
  const pick = (v: string | null | undefined, keep: string | null | undefined) => (v === undefined ? (sameProvider ? keep ?? null : null) : v?.trim() || null);
  const values = {
    provider: input.provider,
    encryptedKey,
    baseUrl: pick(input.baseUrl, current?.baseUrl) ?? defaultBaseUrl(input.provider),
    qualityModel: pick(input.qualityModel, current?.qualityModel),
    bulkModel: pick(input.bulkModel, current?.bulkModel),
    updatedAt: new Date(),
  };
  const [row] = await db.insert(userCredentials).values({ userId, ...values })
    .onConflictDoUpdate({ target: userCredentials.userId, set: values }).returning();
  forgetUserModels(userId);
  return row;
}

export async function deleteUserCredentials(db: Db, userId: string): Promise<void> {
  await db.delete(userCredentials).where(eq(userCredentials.userId, userId));
  forgetUserModels(userId);
}

// ---------- resolution ----------

export type ModelSource = "own" | "hosted" | "local" | "none";

function decryptedKey(row: UserCredentialsRow): string | null {
  if (!row.encryptedKey) return null;
  try { return decryptSecret(row.encryptedKey); } catch (e) {
    console.warn(`[credentials] could not decrypt the stored key for user ${row.userId} (${(e as Error).message}); ignoring it`);
    return null;
  }
}

const isLocalRow = (row: UserCredentialsRow) => row.provider === "ollama" || isLocalUrl(row.baseUrl);

/** The user's own endpoint for a tier, or null when the row is unusable (no key for a cloud provider, LOCAL_ONLY). */
export function specFromCredentials(row: UserCredentialsRow, tier: Tier, apiKey: string | null): LLMSpec | null {
  const own = tier === "quality" ? row.qualityModel : row.bulkModel;
  // Cline has a default per tier; elsewhere one model id serves both tiers when only one is set.
  const model = own ?? (row.provider === "cline" ? null : tier === "quality" ? row.bulkModel : row.qualityModel);
  if (localOnly() && !isLocalRow(row)) return null;
  switch (row.provider) {
    case "ollama":
      return ollamaSpec(tier, model, row.baseUrl);
    case "cline":
      if (!apiKey) return null;
      return { mode: "cline", baseUrl: (row.baseUrl || CLINE_BASE_URL).replace(/\/$/, ""), model: model || CLINE_DEFAULT_MODELS[tier], apiKey };
    case "anthropic":
      if (!apiKey) return null;
      return { mode: "anthropic", model: model || (tier === "bulk" ? "claude-haiku-5-5" : "claude-opus-5-5"), apiKey, ...(row.baseUrl ? { baseUrl: row.baseUrl } : {}) };
    case "openai-compatible":
      if (!row.baseUrl || (!apiKey && !isLocalUrl(row.baseUrl))) return null;
      return { mode: isLocalUrl(row.baseUrl) ? "ollama" : "openai-compatible", baseUrl: row.baseUrl.replace(/\/$/, ""), model: model || "qwen3:8b", apiKey: apiKey ?? "none" };
    default:
      return null;
  }
}

export type ResolvedModels = UserModels & { source: ModelSource };

/**
 * Both tiers for a user. Order: own credentials > HOSTED_LLM_* (or legacy) env > local Ollama if a 2 s probe
 * succeeds > none (heuristics). LOCAL_ONLY=1 skips every cloud option.
 */
export async function resolveUserModels(db: Db, userId: string): Promise<ResolvedModels> {
  let row = await getUserCredentials(db, userId);
  // On a shared server a stored endpoint that points at an internal address is never called (see presets.ts).
  if (row?.baseUrl && !(await assertModelUrlAllowed(row.baseUrl).then(() => true, () => false))) {
    console.warn(`[credentials] ignoring the model endpoint saved by user ${userId}: this server only calls public addresses`);
    row = null;
  }
  if (row) {
    const key = decryptedKey(row);
    const q = specFromCredentials(row, "quality", key), b = specFromCredentials(row, "bulk", key);
    if (q && b) return { userId, quality: llmFromSpec(q), bulk: llmFromSpec(b), source: isLocalRow(row) ? "local" : "own" };
  }
  const hq = hostedSpec("quality"), hb = hostedSpec("bulk");
  if (hq && hb) return { userId, quality: llmFromSpec(hq), bulk: llmFromSpec(hb), source: "hosted" };
  if (await probeOllama()) return { userId, quality: llmFromSpec(ollamaSpec("quality")), bulk: llmFromSpec(ollamaSpec("bulk")), source: "local" };
  return { userId, quality: NONE_LLM, bulk: NONE_LLM, source: "none" };
}

/** The LLM serving `tier` for this user (see resolveUserModels for the order). */
export async function resolveUserLLM(db: Db, userId: string, tier: Tier): Promise<LLM> {
  if (llmOverridden()) return getLLM(tier);
  return (await resolveUserModels(db, userId))[tier];
}

/**
 * Run `fn` with the user's models bound, so every getLLM(tier) inside (tailoring, compose, extraction,
 * classification, chat) uses that user's credentials. Nested calls for the same user reuse the binding.
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
  provider: LlmProviderId | null;
  baseUrl: string | null;
  qualityModel: string | null;
  bulkModel: string | null;
  hasKey: boolean;
  /** What serves the quality tier right now. */
  mode: LLMMode;
  source: ModelSource;
  tiers: Record<Tier, { mode: LLMMode; model: string | null }>;
  localOnly: boolean;
};

export async function modelSettings(db: Db, userId: string): Promise<ModelSettings> {
  const row = await getUserCredentials(db, userId);
  const m = await resolveUserModels(db, userId);
  const tier = (llm: LLM) => ({ mode: modeOf(llm), model: llm.available ? llm.model : null });
  return {
    provider: row?.provider ?? null,
    baseUrl: row ? row.baseUrl ?? (row.provider === "cline" ? CLINE_BASE_URL : null) : null,
    qualityModel: row ? row.qualityModel ?? (row.provider === "cline" ? CLINE_DEFAULT_MODELS.quality : null) : null,
    bulkModel: row ? row.bulkModel ?? (row.provider === "cline" ? CLINE_DEFAULT_MODELS.bulk : null) : null,
    hasKey: Boolean(row?.encryptedKey),
    mode: modeOf(m.quality),
    source: m.source,
    tiers: { quality: tier(m.quality), bulk: tier(m.bulk) },
    localOnly: localOnly(),
  };
}

export type ModelTestResult = { ok: boolean; model: string | null; mode: LLMMode; latencyMs: number; sample: string; error?: string };

/** One tiny completion against the user's quality model (15 s timeout). Never includes the key. */
export async function testUserModel(db: Db, userId: string, opts: { timeoutMs?: number } = {}): Promise<ModelTestResult> {
  const row = await getUserCredentials(db, userId);
  const key = row ? decryptedKey(row) : null;
  if (row?.baseUrl) {
    const refused = await assertModelUrlAllowed(row.baseUrl).then(() => null, (e: Error) => e.message);
    if (refused) return { ok: false, model: null, mode: "heuristic", latencyMs: 0, sample: "", error: refused };
  }
  const m = await resolveUserModels(db, userId);
  const llm = m.quality;
  if (!llm.available) {
    const why = row && localOnly() && !isLocalRow(row) ? "LOCAL_ONLY is set, so cloud providers are refused; run Ollama locally"
      : row && !key && row.provider !== "ollama" ? `No API key saved for ${row.provider}`
      : "No model configured: add a Cline key, set HOSTED_LLM_* env, or run Ollama locally";
    return { ok: false, model: null, mode: "heuristic", latencyMs: 0, sample: "", error: why };
  }
  const started = Date.now();
  try {
    const timeoutMs = opts.timeoutMs ?? 15_000;
    const out = await Promise.race([
      llm.text({ system: "You are a connectivity check.", prompt: "Reply with the single word ready", maxTokens: 16, timeoutMs }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`No answer within ${timeoutMs / 1000} s`)), timeoutMs + 500).unref()),
    ]);
    return { ok: true, model: llm.model, mode: modeOf(llm), latencyMs: Date.now() - started, sample: scrub(out.trim().slice(0, 80), key) };
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
    return { ok: false, model: llm.model, mode: modeOf(llm), latencyMs: Date.now() - started, sample: "", error: scrub(scrub(detail, key), process.env.HOSTED_LLM_API_KEY) };
  }
}

/** The user's saved key, decrypted, for server-side calls made on their behalf (never sent to the browser). */
export async function savedApiKey(db: Db, userId: string): Promise<string | null> {
  const row = await getUserCredentials(db, userId);
  return row ? decryptedKey(row) : null;
}
