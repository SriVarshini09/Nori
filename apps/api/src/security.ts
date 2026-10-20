import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";

/**
 * Response headers every API reply carries. No CSP here: the API also serves resume HTML and PDFs that the
 * dashboard shows in a same-origin frame, and the dashboard sets its own CSP.
 */
export function securityHeaders(opts: { hsts?: boolean } = {}): MiddlewareHandler {
  return async (c, next) => {
    await next();
    const h = c.res.headers;
    h.set("X-Content-Type-Options", "nosniff");
    h.set("X-Frame-Options", "SAMEORIGIN");
    h.set("Referrer-Policy", "strict-origin-when-cross-origin");
    h.set("X-Permitted-Cross-Domain-Policies", "none");
    h.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    if (opts.hsts) h.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  };
}

/** Best-effort client address behind Fly and Vercel proxies: first X-Forwarded-For hop, else Fly-Client-IP. */
export function clientIp(c: Context): string {
  const xff = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  return xff || c.req.header("fly-client-ip") || c.req.header("x-real-ip") || "local";
}

export type RateRule = {
  /** Bucket name; one counter per (name, key). */
  name: string;
  windowMs: number;
  max: number;
  /** Which requests the rule covers. */
  match: (c: Context) => boolean;
  /** Counter key, default the client address. */
  key?: (c: Context) => string | Promise<string>;
  message?: string;
};

type Bucket = { count: number; resetAt: number };

/**
 * Fixed-window in-memory rate limiter. One process owns the API (see docs/deploy.md), so memory is enough.
 * Replies 429 with Retry-After and RateLimit-* headers.
 */
export function rateLimit(rules: RateRule[], now: () => number = Date.now): MiddlewareHandler & { reset: () => void } {
  const buckets = new Map<string, Bucket>();
  let lastSweep = now();
  const mw: MiddlewareHandler = async (c, next) => {
    const t = now();
    if (t - lastSweep > 60_000) {
      lastSweep = t;
      for (const [k, b] of buckets) if (b.resetAt <= t) buckets.delete(k);
    }
    for (const r of rules) {
      if (!r.match(c)) continue;
      const k = `${r.name}:${r.key ? await r.key(c) : clientIp(c)}`;
      let b = buckets.get(k);
      if (!b || b.resetAt <= t) { b = { count: 0, resetAt: t + r.windowMs }; buckets.set(k, b); }
      b.count += 1;
      const remaining = Math.max(0, r.max - b.count);
      c.header("RateLimit-Limit", String(r.max));
      c.header("RateLimit-Remaining", String(remaining));
      c.header("RateLimit-Reset", String(Math.ceil((b.resetAt - t) / 1000)));
      if (b.count > r.max) {
        const retry = Math.max(1, Math.ceil((b.resetAt - t) / 1000));
        c.header("Retry-After", String(retry));
        throw new HTTPException(429, { message: r.message ?? `Too many requests. Try again in ${retry}s.` });
      }
    }
    return next();
  };
  return Object.assign(mw, { reset: () => buckets.clear() });
}

const isAuthWrite = (c: Context, p: string) => c.req.method === "POST" && c.req.path === p;

/** The limits the production API runs with. */
export function defaultRateRules(): RateRule[] {
  return [
    {
      name: "login", windowMs: 15 * 60_000, max: 10,
      match: (c) => isAuthWrite(c, "/api/auth/login"),
      message: "Too many sign-in attempts. Wait a few minutes and try again.",
    },
    {
      name: "signup", windowMs: 60 * 60_000, max: 8,
      match: (c) => isAuthWrite(c, "/api/auth/signup"),
      message: "Too many accounts created from this address. Try again later.",
    },
    {
      name: "password", windowMs: 60 * 60_000, max: 6,
      match: (c) => c.req.method === "POST" && /^\/api\/auth\/(forgot-password|reset-password|change-password|resend-verification)$/.test(c.req.path),
      message: "Too many password requests. Try again in an hour.",
    },
    {
      name: "chat", windowMs: 60_000, max: 30,
      match: (c) => c.req.method === "POST" && c.req.path === "/api/agent/chat",
    },
    {
      name: "heavy", windowMs: 60_000, max: 20,
      match: (c) => c.req.method === "POST" && /^\/api\/(jobs\/(discover|url|poll)|profile\/resume(-file)?|applications)$/.test(c.req.path),
    },
    {
      name: "api", windowMs: 60_000, max: 900,
      match: (c) => c.req.path.startsWith("/api/") && !c.req.path.endsWith("/events"),
    },
  ];
}
