import type { FeedSource, NormalizedJob } from "../contracts.js";

/** A FeedSource that can also fetch a single posting without listing the whole tenant. */
export interface FeedSourceExt extends FeedSource {
  fetchJob?(token: string, externalId: string): Promise<NormalizedJob | null>;
}

export const FETCH_TIMEOUT_MS = 15_000;

/**
 * GET JSON with a 15s timeout. Returns null on 404, throws on any other non-2xx.
 */
export async function getJson<T>(url: string, init: RequestInit = {}, timeoutMs = FETCH_TIMEOUT_MS): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, headers: { accept: "application/json", ...(init.headers ?? {}) } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  } catch (err) {
    if ((err as Error).name === "AbortError") throw new Error(`GET ${url} timed out after ${timeoutMs}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function prettifyToken(token: string): string {
  return token
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export const REMOTE_RE = /\bremote\b|anywhere|work from home/i;

export function parseDate(v: unknown): Date | undefined {
  if (v == null || v === "") return undefined;
  const d = typeof v === "number" ? new Date(v) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Parse a URL, tolerating a missing scheme. */
export function safeUrl(url: string): URL | null {
  try { return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`); } catch { return null; }
}
