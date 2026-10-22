import type { LlmProviderId } from "../db/schema.js";
import { UnsafeUrlError, assertPublicUrl } from "../feeds/ssrf.js";

/**
 * Model providers people can pick in Settings. A preset is only a convenience over what is stored
 * (a provider kind plus a base URL): the server and the app share this one list.
 */
export type ModelPreset = {
  id: string;
  label: string;
  line: string;
  /** How it is stored and spoken to. */
  provider: LlmProviderId;
  baseUrl: string | null;
  /** The base URL is typed by the person (custom endpoints, local servers on another port). */
  editableUrl: boolean;
  needsKey: boolean;
  /** Runs on the person's own machine: not reachable from a shared hosted server. */
  local: boolean;
  /** Where to create a key. */
  keyUrl?: string;
  /** Suggested model ids (only where the id is stable); everything else is picked from the provider's own list. */
  defaults?: { quality?: string; bulk?: string };
};

export const MODEL_PRESETS: ModelPreset[] = [
  { id: "openai", label: "OpenAI", line: "GPT models with your OpenAI API key", provider: "openai-compatible", baseUrl: "https://api.openai.com/v1", editableUrl: false, needsKey: true, local: false, keyUrl: "https://platform.openai.com/api-keys" },
  { id: "anthropic", label: "Anthropic", line: "Claude models with your API key", provider: "anthropic", baseUrl: null, editableUrl: false, needsKey: true, local: false, keyUrl: "https://console.anthropic.com/settings/keys", defaults: { quality: "claude-opus-5-5", bulk: "claude-haiku-5-5" } },
  { id: "gemini", label: "Google Gemini", line: "Gemini models with a Google AI Studio key", provider: "openai-compatible", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", editableUrl: false, needsKey: true, local: false, keyUrl: "https://aistudio.google.com/apikey" },
  { id: "openrouter", label: "OpenRouter", line: "One key for hundreds of models", provider: "openai-compatible", baseUrl: "https://openrouter.ai/api/v1", editableUrl: false, needsKey: true, local: false, keyUrl: "https://openrouter.ai/keys" },
  { id: "groq", label: "Groq", line: "Very fast open models", provider: "openai-compatible", baseUrl: "https://api.groq.com/openai/v1", editableUrl: false, needsKey: true, local: false, keyUrl: "https://console.groq.com/keys" },
  { id: "deepseek", label: "DeepSeek", line: "Low-cost reasoning models", provider: "openai-compatible", baseUrl: "https://api.deepseek.com/v1", editableUrl: false, needsKey: true, local: false, keyUrl: "https://platform.deepseek.com/api_keys" },
  { id: "together", label: "Together AI", line: "Open models, pay as you go", provider: "openai-compatible", baseUrl: "https://api.together.xyz/v1", editableUrl: false, needsKey: true, local: false, keyUrl: "https://api.together.ai/settings/api-keys" },
  { id: "mistral", label: "Mistral", line: "Mistral models with your key", provider: "openai-compatible", baseUrl: "https://api.mistral.ai/v1", editableUrl: false, needsKey: true, local: false, keyUrl: "https://console.mistral.ai/api-keys" },
  { id: "cline", label: "Cline", line: "Open models through your Cline credits", provider: "cline", baseUrl: "https://api.cline.bot/api/v1", editableUrl: false, needsKey: true, local: false, keyUrl: "https://cline.bot", defaults: { quality: "deepseek/deepseek-v4-pro", bulk: "qwen/qwen3.7-plus" } },
  { id: "ollama", label: "Ollama (on this computer)", line: "Runs on your machine, no key, nothing leaves it", provider: "ollama", baseUrl: "http://localhost:11434", editableUrl: true, needsKey: false, local: true, defaults: { quality: "qwen3:14b", bulk: "qwen3:4b" } },
  { id: "lmstudio", label: "LM Studio (on this computer)", line: "Local server on port 1234, no key", provider: "openai-compatible", baseUrl: "http://localhost:1234/v1", editableUrl: true, needsKey: false, local: true },
  { id: "custom", label: "Other OpenAI-compatible endpoint", line: "Your own gateway, vLLM, LiteLLM or another provider", provider: "openai-compatible", baseUrl: null, editableUrl: true, needsKey: true, local: false },
];

/** The preset a stored (provider, baseUrl) pair corresponds to; "custom" for an unknown URL. */
export function presetIdFor(provider: LlmProviderId | null, baseUrl: string | null): string | null {
  if (!provider) return null;
  const norm = (u: string | null) => (u ?? "").replace(/\/+$/, "").toLowerCase();
  const exact = MODEL_PRESETS.find((p) => p.provider === provider && norm(p.baseUrl) === norm(baseUrl));
  if (exact) return exact.id;
  if (provider === "anthropic") return "anthropic";
  if (provider === "ollama") return "ollama";
  if (provider === "cline") return "cline";
  return "custom";
}

// ---------- where model endpoints may point ----------

/**
 * On a shared, hosted server (NODE_ENV=production) a model URL a person typed must be a public address: otherwise
 * "http://169.254.169.254/..." or an internal service would be reachable through the model settings. Someone running
 * their own copy for themselves can set ALLOW_PRIVATE_MODEL_URLS=1 to use Ollama or LM Studio on the same host.
 */
export const strictModelUrls = () => process.env.NODE_ENV === "production" && process.env.ALLOW_PRIVATE_MODEL_URLS !== "1";

export const MODEL_URL_REFUSED = "This server can only call public model endpoints. To use a model on your own computer (Ollama, LM Studio), run Nori on that computer, or add a hosted provider's key instead.";

/** Throws UnsafeUrlError with a plain explanation when the policy forbids calling this URL. */
export async function assertModelUrlAllowed(url: string | null | undefined): Promise<void> {
  if (!url || !strictModelUrls()) return;
  try { await assertPublicUrl(url); } catch (e) {
    if (e instanceof UnsafeUrlError) throw new UnsafeUrlError(MODEL_URL_REFUSED);
    throw e;
  }
}

// ---------- the provider's own model list ----------

export type ListModelsInput = { provider: LlmProviderId; baseUrl: string | null; apiKey: string | null };

/** Model ids the provider says it serves, sorted, at most 400. Throws a readable Error on a bad key, URL or answer. */
export async function listProviderModels(input: ListModelsInput): Promise<string[]> {
  const { provider, apiKey } = input;
  const base = (input.baseUrl ?? (provider === "anthropic" ? "https://api.anthropic.com" : "")).replace(/\/+$/, "");
  if (!base) throw new Error("Enter the endpoint's base URL first.");
  await assertModelUrlAllowed(base);
  const url = provider === "anthropic" ? `${base}/v1/models?limit=200` : provider === "ollama" ? `${base.replace(/\/v1$/, "")}/v1/models` : `${base}/models`;
  const headers: Record<string, string> = { accept: "application/json" };
  if (provider === "anthropic") { if (apiKey) headers["x-api-key"] = apiKey; headers["anthropic-version"] = "2023-06-01"; }
  else if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  let res: Response;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000), redirect: "manual" });
  } catch (e) {
    const code = (e as { cause?: { code?: string } }).cause?.code;
    throw new Error(code === "ECONNREFUSED" ? "Nothing is listening at that address. Is the server running?" : "Could not reach that address.");
  }
  if (res.status === 401 || res.status === 403) throw new Error("The provider rejected the API key.");
  if (!res.ok) throw new Error(`The provider answered HTTP ${res.status} when listing models. You can still type a model name yourself.`);
  const j = (await res.json().catch(() => null)) as { data?: { id?: string }[]; models?: { name?: string; id?: string }[] } | null;
  const ids = (j?.data ?? j?.models ?? []).map((m: { id?: string; name?: string }) => (m.id ?? m.name ?? "").replace(/^models\//, "")).filter(Boolean);
  if (!ids.length) throw new Error("The provider returned no models. You can still type a model name yourself.");
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b)).slice(0, 400);
}
