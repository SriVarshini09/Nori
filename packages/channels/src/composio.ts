import { Composio } from "@composio/core";

/**
 * Composio access (Gmail, Sheets, Calendar, Slack). Uses the official SDK (@composio/core),
 * one tool-router session per user id. Every entry point throws a clear error when
 * COMPOSIO_API_KEY is missing so callers can surface "connect Composio" instead of a stack trace.
 */
export const TOOLKITS = ["gmail", "googlesheets", "googlecalendar", "slack"] as const;
export type ToolkitSlug = (typeof TOOLKITS)[number];

export class ComposioNotConfiguredError extends Error {
  constructor() {
    super("COMPOSIO_API_KEY is not set. Add it to .env to use Gmail, Sheets, Calendar and Slack integrations.");
    this.name = "ComposioNotConfiguredError";
  }
}

export function composioAvailable(): boolean {
  return Boolean(process.env.COMPOSIO_API_KEY);
}

type Session = Awaited<ReturnType<Composio["create"]>>;

let client: Composio | null = null;
const sessions = new Map<string, Promise<Session>>();

export function getComposio(): Composio {
  if (!composioAvailable()) throw new ComposioNotConfiguredError();
  if (!client) client = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
  return client;
}

export function getSession(userId: string): Promise<Session> {
  const composio = getComposio();
  let s = sessions.get(userId);
  if (!s) {
    s = composio.create(userId);
    // do not cache failures
    s.catch(() => sessions.delete(userId));
    sessions.set(userId, s);
  }
  return s;
}

/** Test hook: drop cached client and sessions. */
export function resetComposioCache() {
  client = null;
  sessions.clear();
}

/** Execute a Composio tool for a user and return its `data`. Throws on a tool-level error. */
export async function executeTool(userId: string, slug: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const session = await getSession(userId);
  const res = await session.execute(slug, args);
  if (res.error) throw new Error(`Composio ${slug} failed: ${String(res.error).slice(0, 500)}`);
  const data = (res.data ?? {}) as Record<string, unknown>;
  // Some tools wrap failures as { successful: false, error }.
  if (data && data.successful === false && data.error) throw new Error(`Composio ${slug} failed: ${String(data.error).slice(0, 500)}`);
  return data;
}

/** Ask Composio which tool slugs fit a use case (fallback discovery for slugs we have not confirmed). */
export async function searchToolSlugs(userId: string, useCase: string, toolkits?: string[]): Promise<string[]> {
  const session = await getSession(userId);
  const res = await session.search({ query: useCase, ...(toolkits ? { toolkits } : {}) });
  const out: string[] = [];
  for (const r of res.results ?? []) out.push(...(r.primaryToolSlugs ?? []), ...(r.relatedToolSlugs ?? []));
  return [...new Set(out)];
}

/** Start OAuth for a toolkit. The caller redirects the user to `redirectUrl`. */
export async function connectToolkit(userId: string, toolkit: string, callbackUrl: string): Promise<{ redirectUrl: string }> {
  const session = await getSession(userId);
  const req = await session.authorize(toolkit, { callbackUrl });
  if (!req.redirectUrl) throw new Error(`Composio returned no redirect URL for ${toolkit}`);
  return { redirectUrl: req.redirectUrl };
}

export async function listConnections(userId: string): Promise<{ toolkit: string; connected: boolean }[]> {
  const session = await getSession(userId);
  const res = await session.toolkits({ toolkits: [...TOOLKITS] });
  const byslug = new Map(res.items.map((i) => [i.slug.toLowerCase(), Boolean(i.connection?.isActive)]));
  return TOOLKITS.map((toolkit) => ({ toolkit, connected: byslug.get(toolkit) ?? false }));
}

/** Depth-first search for the first string/number value under any of `keys` (case-insensitive). */
export function findDeepString(obj: unknown, keys: string[], depth = 0): string | undefined {
  if (obj == null || depth > 6) return undefined;
  const wanted = keys.map((k) => k.toLowerCase());
  if (Array.isArray(obj)) {
    for (const v of obj) { const r = findDeepString(v, keys, depth + 1); if (r) return r; }
    return undefined;
  }
  if (typeof obj === "object") {
    const rec = obj as Record<string, unknown>;
    for (const [k, v] of Object.entries(rec)) {
      if (wanted.includes(k.toLowerCase()) && (typeof v === "string" || typeof v === "number") && String(v)) return String(v);
    }
    for (const v of Object.values(rec)) { const r = findDeepString(v, keys, depth + 1); if (r) return r; }
  }
  return undefined;
}
