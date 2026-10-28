import { afterEach, describe, expect, it, vi } from "vitest";
import { FEED_USER_AGENT, MAX_RETRY_AFTER_MS, RateLimitedError, backoffMs, fetchWithRetry, getJson, parseRetryAfter } from "./http.js";

const URL_ = "https://boards-api.greenhouse.io/v1/boards/acme/jobs";
const res = (status: number, headers: Record<string, string> = {}, body: unknown = {}) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status, headers });

function mockFetch(...responses: (Response | Error)[]) {
  const fn = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const next = responses.shift();
    if (!next) throw new Error("fetch called more times than expected");
    if (next instanceof Error) throw next;
    return next;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("parseRetryAfter", () => {
  it("reads delta-seconds", () => {
    expect(parseRetryAfter("2")).toBe(2000);
    expect(parseRetryAfter(" 0 ")).toBe(0);
    expect(parseRetryAfter("1.5")).toBe(1500);
  });
  it("reads an HTTP date relative to now", () => {
    const now = Date.parse("2026-10-28T12:00:00Z");
    expect(parseRetryAfter("Wed, 28 Oct 2026 12:00:07 GMT", now)).toBe(7000);
    expect(parseRetryAfter("Wed, 28 Oct 2026 11:59:00 GMT", now)).toBe(0); // already past
  });
  it("caps at 60 seconds", () => {
    expect(parseRetryAfter("3600")).toBe(MAX_RETRY_AFTER_MS);
    const now = Date.parse("2026-10-28T12:00:00Z");
    expect(parseRetryAfter("Wed, 28 Oct 2026 13:00:00 GMT", now)).toBe(60_000);
  });
  it("returns null when absent or unreadable", () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("")).toBeNull();
    expect(parseRetryAfter("soon")).toBeNull();
  });
});

describe("backoffMs", () => {
  it("doubles from 1 s with up to 25% jitter", () => {
    expect(backoffMs(1, () => 0)).toBe(1000);
    expect(backoffMs(2, () => 0)).toBe(2000);
    expect(backoffMs(3, () => 0)).toBe(4000);
    expect(backoffMs(1, () => 1)).toBe(1250);
    expect(backoffMs(2, () => 0.5)).toBe(2250);
  });
});

describe("fetchWithRetry", () => {
  it("sends the Nori User-Agent and keeps caller headers", async () => {
    const f = mockFetch(res(200));
    await fetchWithRetry(URL_, { headers: { "x-test": "1" } });
    const init = f.mock.calls[0][1] as RequestInit;
    expect(init.headers).toMatchObject({ "user-agent": FEED_USER_AGENT, accept: "application/json", "x-test": "1" });
    expect(FEED_USER_AGENT).toBe("NoriJobAgent/1.0 (+https://norinote.xyz; open-source job agent)");
  });

  it("honours Retry-After seconds on 429, then succeeds", async () => {
    const f = mockFetch(res(429, { "retry-after": "3" }), res(200, {}, { ok: true }));
    const sleep = vi.fn(async () => {});
    const r = await fetchWithRetry(URL_, {}, { sleep });
    expect(r.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(3000);
  });

  it("honours a Retry-After HTTP date on 503", async () => {
    const now = Date.parse("2026-10-28T12:00:00Z");
    mockFetch(res(503, { "retry-after": "Wed, 28 Oct 2026 12:00:05 GMT" }), res(200));
    const sleep = vi.fn(async () => {});
    await fetchWithRetry(URL_, {}, { sleep, now: () => now });
    expect(sleep).toHaveBeenCalledExactlyOnceWith(5000);
  });

  it("caps an excessive Retry-After at 60 s", async () => {
    mockFetch(res(429, { "retry-after": "86400" }), res(200));
    const sleep = vi.fn(async () => {});
    await fetchWithRetry(URL_, {}, { sleep });
    expect(sleep).toHaveBeenCalledExactlyOnceWith(60_000);
  });

  it("falls back to exponential backoff with jitter, three attempts in all, then a clear error", async () => {
    const f = mockFetch(res(503), res(503), res(503));
    const sleep = vi.fn(async () => {});
    const err = await fetchWithRetry(URL_, {}, { sleep, random: () => 0 }).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitedError);
    expect(err.message).toMatch(/503.*all 3 attempts/);
    expect(err).toMatchObject({ status: 503, attempts: 3, host: "boards-api.greenhouse.io" });
    expect(f).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c: unknown[]) => c[0])).toEqual([1000, 2000]);
  });

  it("recovers when the second try succeeds after a 429 without Retry-After", async () => {
    mockFetch(res(429), res(200, {}, { jobs: [] }));
    const sleep = vi.fn(async () => {});
    const out = await getJson<{ jobs: unknown[] }>(URL_, {}, 5000, { sleep, random: () => 0.4 });
    expect(out).toEqual({ jobs: [] });
    expect(sleep).toHaveBeenCalledExactlyOnceWith(1100);
  });

  it("never retries other 4xx (or 5xx)", async () => {
    for (const status of [400, 401, 403, 404, 410, 500, 502]) {
      const f = mockFetch(res(status));
      const sleep = vi.fn(async () => {});
      const r = await fetchWithRetry(URL_, {}, { sleep });
      expect(r.status).toBe(status);
      expect(f).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    }
  });

  it("does not retry a network error", async () => {
    const f = mockFetch(new TypeError("fetch failed"));
    await expect(fetchWithRetry(URL_, {}, { sleep: async () => {} })).rejects.toThrow("fetch failed");
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("getJson", () => {
  it("returns null on 404 and throws on other non-2xx without retrying", async () => {
    const f = mockFetch(res(404));
    expect(await getJson(URL_)).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
    mockFetch(res(500));
    await expect(getJson(URL_)).rejects.toThrow(/failed: 500/);
  });

  it("keeps its timeout, per attempt", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_u: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    })));
    const p = getJson(URL_, {}, 1000).catch((e) => e);
    await vi.advanceTimersByTimeAsync(1001);
    expect(((await p) as Error).message).toMatch(/timed out after 1000ms/);
  });
});
