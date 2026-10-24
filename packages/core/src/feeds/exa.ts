/**
 * Thin client for Exa search (https://exa.ai): neural web search with page text, used to find postings outside the
 * ATS feeds (X posts, Hacker News hiring threads, Wellfound, Y Combinator, public LinkedIn job pages, and the ATS
 * boards themselves). Auth is the x-api-key header from EXA_API_KEY; the key is never logged or put in errors.
 * EXA_BASE_URL overrides the endpoint for tests.
 */
const base = () => (process.env.EXA_BASE_URL ?? "https://api.exa.ai").replace(/\/$/, "");

export function exaAvailable(): boolean {
  return Boolean(process.env.EXA_API_KEY);
}

export type ExaSearchInput = {
  query: string;
  numResults?: number;
  includeDomains?: string[];
  /** Exa's result category; "tweet" narrows to X posts. */
  category?: "tweet" | "news" | "company" | "personal site";
  /** ISO date: only pages published after this. */
  startPublishedDate?: string;
  /** Characters of page text to return per result. */
  maxCharacters?: number;
};

export type ExaResult = { url: string; title: string | null; text: string; publishedDate: string | null; author: string | null };

export async function exaSearch(input: ExaSearchInput, timeoutMs = 45_000): Promise<ExaResult[]> {
  const key = process.env.EXA_API_KEY;
  if (!key) throw new Error("EXA_API_KEY is not set; Exa web search is not configured");
  const body: Record<string, unknown> = {
    query: input.query,
    type: "auto",
    numResults: input.numResults ?? 10,
    contents: { text: { maxCharacters: input.maxCharacters ?? 6000 } },
  };
  if (input.includeDomains?.length) body.includeDomains = input.includeDomains;
  if (input.category) body.category = input.category;
  if (input.startPublishedDate) body.startPublishedDate = input.startPublishedDate;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${base()}/search`, {
      method: "POST", signal: ctrl.signal,
      headers: { "x-api-key": key, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw new Error(`Exa search timed out after ${timeoutMs}ms`);
    throw new Error(`Exa search request failed: ${(err as Error).message.split(key).join("***")}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).slice(0, 300).split(key).join("***");
    throw new Error(`Exa search failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { results?: { url?: string; title?: string | null; text?: string | null; publishedDate?: string | null; author?: string | null }[] };
  return (data.results ?? []).filter((r) => typeof r.url === "string" && r.url).map((r) => ({
    url: r.url!, title: r.title ?? null, text: r.text ?? "", publishedDate: r.publishedDate ?? null, author: r.author ?? null,
  }));
}
