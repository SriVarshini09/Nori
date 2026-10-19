/**
 * Thin client for Parallel (https://api.parallel.ai): Search, Extract and Task APIs.
 * Auth is the x-api-key header from PARALLEL_API_KEY. The key is never logged or put in errors.
 */
const BASE = "https://api.parallel.ai";

export function parallelAvailable(): boolean {
  return Boolean(process.env.PARALLEL_API_KEY);
}

function apiKey(): string {
  const key = process.env.PARALLEL_API_KEY;
  if (!key) throw new Error("PARALLEL_API_KEY is not set; Parallel search/extract/research is unavailable");
  return key;
}

async function call(method: "GET" | "POST", path: string, body?: unknown, timeoutMs = 60_000): Promise<Response> {
  const key = apiKey();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(`${BASE}${path}`, {
      method,
      signal: ctrl.signal,
      headers: { "x-api-key": key, "content-type": "application/json", accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw new Error(`Parallel ${method} ${path} timed out after ${timeoutMs}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function failure(res: Response, what: string): Promise<Error> {
  const text = (await res.text().catch(() => "")).slice(0, 300);
  return new Error(`Parallel ${what} failed: ${res.status} ${text}`);
}

// ---------- search ----------
export type ParallelSearchInput = {
  objective: string;
  search_queries: string[];
  mode?: "turbo" | "fast" | "basic" | "advanced";
  include_domains?: string[];
  max_results?: number;
};
export type ParallelSearchResult = { url: string; title?: string | null; excerpts: string[] };

export async function parallelSearch(input: ParallelSearchInput): Promise<ParallelSearchResult[]> {
  const advanced_settings: Record<string, unknown> = {};
  if (input.max_results != null) advanced_settings.max_results = input.max_results;
  if (input.include_domains?.length) advanced_settings.source_policy = { include_domains: input.include_domains };
  const body: Record<string, unknown> = { objective: input.objective, search_queries: input.search_queries };
  if (input.mode) body.mode = input.mode;
  if (Object.keys(advanced_settings).length) body.advanced_settings = advanced_settings;
  const res = await call("POST", "/v1/search", body);
  if (!res.ok) throw await failure(res, "search");
  const data = (await res.json()) as { results?: { url: string; title?: string | null; excerpts?: string[] }[] };
  return (data.results ?? []).map((r) => ({ url: r.url, title: r.title ?? null, excerpts: r.excerpts ?? [] }));
}

// ---------- extract ----------
export type ParallelExtractResult = { url: string; title?: string | null; content: string; markdown: string };

export async function parallelExtract(urls: string[], objective?: string): Promise<ParallelExtractResult[]> {
  const body: Record<string, unknown> = { urls, advanced_settings: { full_content: true } };
  if (objective) body.objective = objective;
  const res = await call("POST", "/v1/extract", body);
  if (!res.ok) throw await failure(res, "extract");
  const data = (await res.json()) as {
    results?: { url: string; title?: string | null; full_content?: string; content?: string; markdown?: string; excerpts?: string[] }[];
  };
  return (data.results ?? []).map((r) => {
    const content = r.full_content ?? r.markdown ?? r.content ?? (r.excerpts ?? []).join("\n\n");
    return { url: r.url, title: r.title ?? null, content, markdown: content };
  });
}

// ---------- task ----------
export type ParallelBasis = {
  field: string;
  citations: { url: string; title?: string | null }[];
  reasoning?: string;
  confidence?: string;
};
export type ParallelTaskResult<T = Record<string, unknown>> = { content: T; basis: ParallelBasis[] };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function parallelTaskRun<T = Record<string, unknown>>(
  input: string | Record<string, unknown>,
  outputJsonSchema: Record<string, unknown>,
  processor = "core",
): Promise<ParallelTaskResult<T>> {
  const created = await call("POST", "/v1/tasks/runs", {
    input,
    processor,
    task_spec: { output_schema: { type: "json", json_schema: outputJsonSchema } },
  });
  if (!created.ok) throw await failure(created, "task create");
  const run = (await created.json()) as { run_id?: string };
  if (!run.run_id) throw new Error("Parallel task create returned no run_id");

  for (let attempt = 0; attempt < 12; attempt++) {
    const res = await call("GET", `/v1/tasks/runs/${encodeURIComponent(run.run_id)}/result?timeout=300`, undefined, 330_000);
    if (res.status === 408) { await sleep(500); continue; }
    if (!res.ok) throw await failure(res, "task result");
    const data = (await res.json()) as {
      output?: { content?: unknown; basis?: { field?: string; citations?: { url: string; title?: string | null }[]; reasoning?: string; confidence?: string }[] };
    };
    const content = data.output?.content;
    const parsed = typeof content === "string" ? safeJson(content) : content;
    return {
      content: (parsed ?? {}) as T,
      basis: (data.output?.basis ?? []).map((b) => ({
        field: b.field ?? "",
        citations: (b.citations ?? []).map((c) => ({ url: c.url, title: c.title ?? null })),
        reasoning: b.reasoning,
        confidence: b.confidence,
      })),
    };
  }
  throw new Error("Parallel task did not complete before retries were exhausted");
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return undefined; }
}
