import { AsyncLocalStorage } from "node:async_hooks";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

/**
 * One LLM interface, two wire protocols:
 *  - anthropic: Claude via the official SDK.
 *  - openai-compatible: any /chat/completions endpoint. Used for open-weight models through
 *    Cline (api.cline.bot), OpenRouter, Groq, or a local Ollama (http://localhost:11434/v1).
 *
 * Two tiers: "quality" for writing (bullets, answers, chat) and "bulk" for extraction and classification.
 * Which model serves a tier is decided per user (credentials.ts: own key > hosted env > local Ollama > none);
 * entry points (API requests, agent ticks, runner steps) bind the user's models with `withUserLLM`, and
 * library code just calls `getLLM(tier)`.
 * Callers must handle `LLMUnavailableError` with a heuristic fallback so the pipeline runs offline.
 */
export type Provider = "anthropic" | "openai-compatible" | "none";
export type Tier = "quality" | "bulk";
export const TIERS: readonly Tier[] = ["quality", "bulk"];
/** What actually serves a tier, as shown in settings and /api/health. */
export type LLMMode = "cline" | "openai-compatible" | "anthropic" | "ollama" | "heuristic";

export class LLMUnavailableError extends Error {
  constructor(msg = "No LLM provider configured") { super(msg); this.name = "LLMUnavailableError"; }
}

export type JsonCall<T> = {
  name: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
  /** Give up after this long and let the caller fall back. Defaults to llmTimeoutMs(). */
  timeoutMs?: number;
};
export type TextCall = { system: string; prompt: string; maxTokens?: number; timeoutMs?: number };

export interface LLM {
  provider: Provider;
  model: string;
  available: boolean;
  /** Finer label than provider (cline / ollama are both openai-compatible on the wire). */
  mode?: LLMMode;
  json<T>(call: JsonCall<T>): Promise<T>;
  text(call: TextCall): Promise<string>;
}

/** A concrete endpoint + model. `apiKey` never leaves the process. */
export type LLMSpec = {
  mode: Exclude<LLMMode, "heuristic">;
  model: string;
  baseUrl?: string;
  apiKey?: string;
};

export const CLINE_BASE_URL = "https://api.cline.bot/api/v1";
export const CLINE_DEFAULT_MODELS: Record<Tier, string> = { quality: "deepseek/deepseek-v4-pro", bulk: "qwen/qwen3.7-plus" };
export const ollamaBaseUrl = () => (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1").replace(/\/$/, "");
/**
 * How long one LLM call may take before it is abandoned (the heuristic fallback then runs). A slow local model must
 * not freeze ingestion, tailoring or the scheduler. LLM_TIMEOUT_MS overrides; default 3 minutes.
 */
export const llmTimeoutMs = () => {
  const n = Number(process.env.LLM_TIMEOUT_MS);
  return Number.isFinite(n) && n >= 1000 ? n : 180_000;
};
const isTimeout = (e: unknown) => e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError" || /timed? ?out|aborted/i.test(e.message));
const timeoutError = (model: string, ms: number) => new Error(`The model (${model}) did not answer within ${Math.round(ms / 1000)} s`);
export const localOnly = () => process.env.LOCAL_ONLY === "1" || process.env.LOCAL_ONLY === "true";

/** Hosts that count as local for LOCAL_ONLY. */
export function isLocalUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const h = new URL(url).hostname.replace(/^\[|\]$/g, "");
    return h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".localhost") || h === "host.docker.internal";
  } catch { return false; }
}

// ---------- local Ollama probe ----------

type OllamaState = { reachable: boolean; models: string[]; checkedAt: number; pending: Promise<boolean> | null };
const ollamaState: OllamaState = { reachable: false, models: [], checkedAt: 0, pending: null };
const PROBE_TTL_MS = 60_000;

/**
 * Is a local Ollama answering at OLLAMA_BASE_URL (default http://localhost:11434/v1)? One 2 s probe of
 * GET /models, cached for a minute. Skipped under tests unless OLLAMA_BASE_URL is set explicitly.
 */
export function probeOllama(opts: { force?: boolean } = {}): Promise<boolean> {
  if (process.env.VITEST && !process.env.OLLAMA_BASE_URL) return Promise.resolve(false);
  if (!opts.force && ollamaState.checkedAt && Date.now() - ollamaState.checkedAt < PROBE_TTL_MS) return Promise.resolve(ollamaState.reachable);
  if (ollamaState.pending) return ollamaState.pending;
  ollamaState.pending = (async () => {
    try {
      const res = await fetch(`${ollamaBaseUrl()}/models`, { signal: AbortSignal.timeout(2000) });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json().catch(() => ({}))) as { data?: { id: string }[] };
      ollamaState.models = (data.data ?? []).map((m) => m.id);
      ollamaState.reachable = true;
    } catch {
      ollamaState.reachable = false;
      ollamaState.models = [];
    } finally {
      ollamaState.checkedAt = Date.now();
      ollamaState.pending = null;
    }
    return ollamaState.reachable;
  })();
  return ollamaState.pending;
}
export const ollamaReachable = () => ollamaState.reachable;

/** The Ollama model for a tier: explicit, else OLLAMA_{QUALITY,BULK}_MODEL, else OLLAMA_MODEL, else the first installed model. */
export function ollamaSpec(tier: Tier, model?: string | null, baseUrl?: string | null): LLMSpec {
  const want = model || (tier === "quality" ? process.env.OLLAMA_QUALITY_MODEL : process.env.OLLAMA_BULK_MODEL) || process.env.OLLAMA_MODEL;
  return { mode: "ollama", baseUrl: (baseUrl || ollamaBaseUrl()).replace(/\/$/, ""), model: want || ollamaState.models[0] || "qwen3:8b", apiKey: "ollama" };
}

/** Probe Ollama once at startup so the process default can use it. */
export async function warmLLM(): Promise<void> { await probeOllama(); }

// ---------- process-level defaults (env) ----------

/** HOSTED_LLM_* env (an operator-paid key shared by every user without their own), else the legacy env. */
export function hostedSpec(tier: Tier): LLMSpec | null {
  if (localOnly()) return null;
  const hp = process.env.HOSTED_LLM_PROVIDER as LLMSpec["mode"] | undefined;
  if (hp || process.env.HOSTED_LLM_API_KEY) {
    const mode: LLMSpec["mode"] = hp ?? "openai-compatible";
    const baseUrl = process.env.HOSTED_LLM_BASE_URL ?? (mode === "cline" ? CLINE_BASE_URL : mode === "ollama" ? ollamaBaseUrl() : undefined);
    const model = (tier === "quality" ? process.env.HOSTED_LLM_QUALITY_MODEL : process.env.HOSTED_LLM_BULK_MODEL)
      ?? (tier === "quality" ? process.env.HOSTED_LLM_BULK_MODEL : process.env.HOSTED_LLM_QUALITY_MODEL)
      ?? (mode === "cline" ? CLINE_DEFAULT_MODELS[tier] : mode === "anthropic" ? "claude-opus-5-5" : "qwen3:8b");
    return { mode, model, baseUrl, apiKey: process.env.HOSTED_LLM_API_KEY };
  }
  const forced = process.env.LLM_PROVIDER as Provider | undefined;
  if (forced === "none") return null;
  if (forced === "anthropic" || (!forced && process.env.ANTHROPIC_API_KEY)) {
    return { mode: "anthropic", model: process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5", apiKey: process.env.ANTHROPIC_API_KEY };
  }
  if (forced === "openai-compatible" || process.env.OPENAI_COMPAT_BASE_URL) {
    const baseUrl = (process.env.OPENAI_COMPAT_BASE_URL ?? ollamaBaseUrl()).replace(/\/$/, "");
    const mode: LLMSpec["mode"] = baseUrl.startsWith(CLINE_BASE_URL) ? "cline" : isLocalUrl(baseUrl) ? "ollama" : "openai-compatible";
    return { mode, baseUrl, model: process.env.OPENAI_COMPAT_MODEL ?? "qwen3:8b", apiKey: process.env.OPENAI_COMPAT_API_KEY ?? process.env.CLINE_API_KEY ?? "ollama" };
  }
  return null;
}

/** Legacy single-provider view of the process default. */
export function resolveProvider(): Provider {
  return processLLM("quality").provider;
}

// ---------- building LLMs ----------

const built = new Map<string, LLM>();
/** One LLM per distinct endpoint/model/key (cached). */
export function llmFromSpec(spec: LLMSpec): LLM {
  const key = JSON.stringify([spec.mode, spec.baseUrl ?? "", spec.model, spec.apiKey ?? ""]);
  let llm = built.get(key);
  if (!llm) {
    llm = spec.mode === "anthropic" ? anthropicLLM(spec) : openAICompatLLM(spec);
    if (built.size > 200) built.clear();
    built.set(key, llm);
  }
  return llm;
}

export const NONE_LLM: LLM = {
  provider: "none", model: "none", available: false, mode: "heuristic",
  async json() { throw new LLMUnavailableError(); },
  async text() { throw new LLMUnavailableError(); },
};

/** Process default for a tier: hosted/legacy env, else a reachable local Ollama (as last probed), else none. */
export function processLLM(tier: Tier): LLM {
  if (localOnly()) return ollamaState.reachable ? llmFromSpec(ollamaSpec(tier)) : NONE_LLM;
  const spec = hostedSpec(tier);
  if (spec) return llmFromSpec(spec);
  return ollamaState.reachable ? llmFromSpec(ollamaSpec(tier)) : NONE_LLM;
}

/** Mode of an LLM for display. */
export const modeOf = (llm: LLM): LLMMode => (!llm.available ? "heuristic" : llm.mode ?? (llm.provider === "anthropic" ? "anthropic" : "openai-compatible"));

// ---------- per-user binding ----------

export type UserModels = { userId: string; quality: LLM; bulk: LLM };
const context = new AsyncLocalStorage<UserModels>();
const userCache = new Map<string, UserModels>();
let override: LLM | null = null;

/**
 * The LLM for a tier. Order: test override (setLLM) > models bound for the current user (withUserLLM) >
 * models last resolved for `opts.userId` > process default.
 */
export function getLLM(tier: Tier = "quality", opts: { userId?: string } = {}): LLM {
  if (override) return override;
  const bound = context.getStore();
  if (bound && (!opts.userId || opts.userId === bound.userId)) return bound[tier];
  if (opts.userId) {
    const cached = userCache.get(opts.userId);
    if (cached) return cached[tier];
  }
  return processLLM(tier);
}
/** Tests swap providers (for every tier and user); null restores normal resolution. */
export function setLLM(llm: LLM | null) { override = llm; }
export const llmOverridden = () => override !== null;

/** Run `fn` with `models` as the user's LLMs for every getLLM() call inside it (async-context scoped). */
export function runWithModels<T>(models: UserModels, fn: () => Promise<T>): Promise<T> {
  userCache.set(models.userId, models);
  return context.run(models, fn);
}
export const boundUserId = () => context.getStore()?.userId ?? null;
/** Forget cached models (after the user changes settings). */
export function forgetUserModels(userId?: string) {
  if (userId) userCache.delete(userId); else userCache.clear();
}

// ---------- providers ----------

function anthropicLLM(spec: LLMSpec): LLM {
  const client = new Anthropic(spec.apiKey ? { apiKey: spec.apiKey, ...(spec.baseUrl ? { baseURL: spec.baseUrl } : {}) } : {});
  const model = spec.model;
  return {
    provider: "anthropic", model, available: true, mode: "anthropic",
    async json<T>(call: JsonCall<T>): Promise<T> {
      const res = await client.messages.parse({
        model,
        max_tokens: call.maxTokens ?? 16000,
        system: call.system,
        output_config: { format: zodOutputFormat(call.schema as z.ZodType), effort: call.effort ?? "medium" },
        messages: [{ role: "user", content: call.prompt }],
      }, { timeout: call.timeoutMs ?? llmTimeoutMs() }).catch((e: unknown) => { throw isTimeout(e) ? timeoutError(model, call.timeoutMs ?? llmTimeoutMs()) : e; });
      if (res.stop_reason === "refusal") throw new Error(`Model refused (${res.stop_details?.category ?? "unknown"})`);
      if (res.parsed_output == null) throw new Error("Structured output failed to parse");
      return call.schema.parse(res.parsed_output);
    },
    async text(call) {
      const res = await client.messages.create({
        model, max_tokens: call.maxTokens ?? 8000, system: call.system,
        messages: [{ role: "user", content: call.prompt }],
      }, { timeout: call.timeoutMs ?? llmTimeoutMs(), ...(call.timeoutMs ? { maxRetries: 0 } : {}) });
      return res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    },
  };
}

// ---------- local model context window ----------

const ctxCache = new Map<string, { ctx: number | null; at: number }>();
/**
 * Context window of the model Ollama has loaded (GET /api/ps), or null when unknown. Ollama's default is only 4096
 * tokens and silently cuts longer prompts, which makes the model answer with junk. OLLAMA_NUM_CTX overrides.
 */
async function ollamaContext(baseUrl: string, model: string): Promise<number | null> {
  const forced = Number(process.env.OLLAMA_NUM_CTX);
  if (Number.isFinite(forced) && forced > 0) return forced;
  if (process.env.VITEST) return null;
  const key = `${baseUrl}|${model}`;
  const hit = ctxCache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.ctx;
  let ctx: number | null = null;
  try {
    const res = await fetch(`${baseUrl.replace(/\/v1$/, "")}/api/ps`, { signal: AbortSignal.timeout(1500) });
    const data = (await res.json()) as { models?: { name?: string; model?: string; context_length?: number }[] };
    ctx = data.models?.find((m) => m.name === model || m.model === model)?.context_length ?? null;
  } catch { ctx = null; }
  ctxCache.set(key, { ctx, at: Date.now() });
  return ctx;
}

/** Rough token count: three characters per token is conservative for English and JSON. */
export const estimateTokens = (messages: { content: string }[]) => Math.ceil(messages.reduce((n, m) => n + m.content.length, 0) / 3);

function openAICompatLLM(spec: LLMSpec): LLM {
  const baseUrl = (spec.baseUrl ?? ollamaBaseUrl()).replace(/\/$/, "");
  const apiKey = spec.apiKey || "ollama";
  const model = spec.model;

  /**
   * Thinking models served by Ollama (qwen3.5, deepseek-r1, ...) spend most of their time reasoning, which makes a
   * structured extraction 10x slower for no gain. Turn reasoning off for extraction and down for drafting.
   */
  const reasoning = (effort?: "low" | "medium" | "high") =>
    spec.mode === "ollama" ? { reasoning_effort: effort === "high" ? "medium" : effort === "medium" ? "low" : "none" } : {};

  async function chat(messages: { role: string; content: string }[], json: boolean, maxTokens: number, signal: AbortSignal, effort?: "low" | "medium" | "high"): Promise<string> {
    if (spec.mode === "ollama") {
      // Room for the answer matters as much as the prompt: a JSON reply that runs out of window is cut off mid-object.
      const need = estimateTokens(messages) + Math.min(maxTokens, 2000);
      const ctx = await ollamaContext(baseUrl, model);
      if (ctx && need > ctx) {
        throw new Error(`The prompt needs about ${need} tokens but ${model} runs with a ${ctx}-token context, so it would be cut off. Start Ollama with OLLAMA_CONTEXT_LENGTH=16384 (or set OLLAMA_NUM_CTX if you already did).`);
      }
    }
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model, messages, temperature: 0.2,
        // Reasoning models (DeepSeek V4 Pro, Kimi K3) spend tokens thinking first; a tiny cap yields empty content
        // and Cline answers 500. Only send a cap when it is large enough to hold a real answer.
        ...(maxTokens >= 256 ? { max_tokens: maxTokens } : {}),
        ...(json ? { response_format: { type: "json_object" } } : {}),
        ...reasoning(effort),
      }),
      signal,
    });
    if (!res.ok) throw new Error(`LLM ${res.status}: ${scrub((await res.text()).slice(0, 300), apiKey)}`);
    type Completion = { choices?: { message?: { content?: string } }[]; error?: { message?: string } | string };
    const raw = (await res.json()) as Completion & { data?: Completion };
    // Cline's gateway wraps the OpenAI-shaped body in { data: {...} }; plain OpenAI-compatible servers do not.
    const data = raw.data?.choices ? raw.data : raw;
    if (!data.choices && data.error) {
      const msg = typeof data.error === "string" ? data.error : data.error.message ?? "unknown";
      throw new Error(`LLM error: ${scrub(msg, apiKey)}`);
    }
    return data.choices?.[0]?.message?.content ?? "";
  }

  return {
    provider: "openai-compatible", model, available: true, mode: spec.mode,
    async json(call) {
      const jsonSchema = JSON.stringify(z.toJSONSchema(call.schema as z.ZodType));
      const system = `${call.system}\n\nRespond with a single JSON object and nothing else. It must validate against this JSON Schema:\n${jsonSchema}`;
      let messages = [{ role: "system", content: system }, { role: "user", content: call.prompt }];
      let lastErr = "";
      // one deadline for the whole call, retries included, so a stalled model cannot hold the caller for minutes
      const ms = call.timeoutMs ?? llmTimeoutMs();
      const signal = AbortSignal.timeout(ms);
      for (let attempt = 0; attempt < 2; attempt++) {
        const raw = await chat(messages, true, call.maxTokens ?? 8000, signal, call.effort).catch((e: unknown) => { throw isTimeout(e) ? timeoutError(model, ms) : e; });
        const parsed = tryParseJson(raw);
        const result = parsed === undefined ? null : call.schema.safeParse(parsed);
        if (result?.success) return result.data;
        lastErr = result ? JSON.stringify(result.error.issues.slice(0, 5)) : "not valid JSON";
        messages = [...messages, { role: "assistant", content: raw }, { role: "user", content: `That did not validate: ${lastErr}. Return only the corrected JSON object.` }];
      }
      throw new Error(`LLM JSON did not validate: ${lastErr}`);
    },
    async text(call) {
      const ms = call.timeoutMs ?? llmTimeoutMs();
      return chat([{ role: "system", content: call.system }, { role: "user", content: call.prompt }], false, call.maxTokens ?? 4000, AbortSignal.timeout(ms))
        .catch((e: unknown) => { throw isTimeout(e) ? timeoutError(model, ms) : e; });
    },
  };
}

/** Remove a secret from text that may be shown to a user or logged. */
export function scrub(text: string, secret: string | null | undefined): string {
  if (!secret || secret.length < 6) return text;
  return text.split(secret).join("***");
}

function tryParseJson(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try { return JSON.parse(trimmed); } catch { /* fall through */ }
  const start = trimmed.indexOf("{"), end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) { try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { /* no */ } }
  return undefined;
}

/**
 * Run an LLM call, falling back to a heuristic when no provider serves `tier` or the call fails.
 * The call should use getLLM(tier) so both agree on the model.
 */
export async function withFallback<T>(call: () => Promise<T>, fallback: () => T | Promise<T>, label: string, tier: Tier = "quality"): Promise<{ value: T; usedLLM: boolean }> {
  const llm = getLLM(tier);
  if (!llm.available) return { value: await fallback(), usedLLM: false };
  try {
    return { value: await call(), usedLLM: true };
  } catch (err) {
    console.warn(`[llm] ${label} failed, using heuristic:`, (err as Error).message);
    return { value: await fallback(), usedLLM: false };
  }
}

export * from "./credentials.js";
