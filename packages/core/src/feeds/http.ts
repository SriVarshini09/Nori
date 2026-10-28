import type { FeedSource, NormalizedJob } from "../contracts.js";

/** A FeedSource that can also fetch a single posting without listing the whole tenant. */
export interface FeedSourceExt extends FeedSource {
  fetchJob?(token: string, externalId: string): Promise<NormalizedJob | null>;
}

export const FETCH_TIMEOUT_MS = 15_000;

/** Sent with every feed request, so the boards can see who is reading them and how to reach us. */
export const FEED_USER_AGENT = "NoriJobAgent/1.0 (+https://norinote.xyz; open-source job agent)";

/** Total tries for one request (the first plus retries) when a board answers 429 or 503. */
export const MAX_ATTEMPTS = 3;
/** A server's Retry-After is honoured up to this long; a longer wait is not worth stalling a poll cycle for. */
export const MAX_RETRY_AFTER_MS = 60_000;
const BACKOFF_BASE_MS = 1000;

/** A board kept answering 429/503 through every retry. The poller backs the whole host off when it sees several. */
export class RateLimitedError extends Error {
  constructor(readonly url: string, readonly status: number, readonly attempts: number) {
    super(`GET ${url} was refused with ${status} ${status === 429 ? "Too Many Requests" : "Service Unavailable"} on all ${attempts} attempts; giving up for now`);
    this.name = "RateLimitedError";
  }
  get host(): string { return new URL(this.url).hostname; }
}

/**
 * Parse a Retry-After header (delta-seconds or an HTTP date) into milliseconds, capped at MAX_RETRY_AFTER_MS.
 * Returns null when it is absent or unreadable, so the caller falls back to exponential backoff.
 */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | null {
  const v = value?.trim();
  if (!v) return null;
  let ms: number;
  if (/^\d+(\.\d+)?$/.test(v)) ms = Number(v) * 1000;
  else {
    const at = Date.parse(v);
    if (Number.isNaN(at)) return null;
    ms = at - now;
  }
  return Math.min(Math.max(ms, 0), MAX_RETRY_AFTER_MS);
}

/** Exponential backoff with jitter: about 1 s after the first refusal, 2 s after the second, 4 s after the third. */
export function backoffMs(failedAttempts: number, random: () => number = Math.random): number {
  return Math.round(BACKOFF_BASE_MS * 2 ** (failedAttempts - 1) * (1 + 0.25 * random()));
}

export type RetryOptions = {
  timeoutMs?: number;
  /** Test seams. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * fetch() with our User-Agent, a per-attempt timeout, and polite retries: a 429 or 503 is retried (honouring
 * Retry-After, else backing off 1 s, 2 s, 4 s with jitter) up to MAX_ATTEMPTS tries in all, then RateLimitedError.
 * Any other status, including every other 4xx, goes to `handle` at once. `handle` runs while the timeout is still
 * armed, so a body that stalls is cut off too.
 */
async function requestWithRetry<T>(url: string, init: RequestInit, opts: RetryOptions, handle: (res: Response) => Promise<T>): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
  const sleep = opts.sleep ?? defaultSleep;
  for (let attempt = 1; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let refused: { status: number; retryAfter: number | null } | null = null;
    try {
      const res = await fetch(url, {
        ...init,
        signal: ctrl.signal,
        headers: { accept: "application/json", "user-agent": FEED_USER_AGENT, ...(init.headers ?? {}) },
      });
      if (res.status === 429 || res.status === 503) {
        refused = { status: res.status, retryAfter: parseRetryAfter(res.headers.get("retry-after"), opts.now?.()) };
        void res.body?.cancel().catch(() => {});
      } else {
        return await handle(res);
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") throw new Error(`GET ${url} timed out after ${timeoutMs}ms`);
      throw err;
    } finally {
      clearTimeout(timer);
    }
    if (attempt >= MAX_ATTEMPTS) throw new RateLimitedError(url, refused.status, attempt);
    await sleep(refused.retryAfter ?? backoffMs(attempt, opts.random));
  }
}

/** fetch() with our User-Agent, a timeout and polite retries on 429/503 (see requestWithRetry). */
export function fetchWithRetry(url: string, init: RequestInit = {}, opts: RetryOptions = {}): Promise<Response> {
  return requestWithRetry(url, init, opts, async (res) => res);
}

/**
 * GET JSON with a 15s timeout and polite retries (see requestWithRetry). Returns null on 404, throws on any other non-2xx.
 */
export function getJson<T>(url: string, init: RequestInit = {}, timeoutMs = FETCH_TIMEOUT_MS, retry: Omit<RetryOptions, "timeoutMs"> = {}): Promise<T | null> {
  return requestWithRetry<T | null>(url, init, { ...retry, timeoutMs }, async (res) => {
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  });
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
