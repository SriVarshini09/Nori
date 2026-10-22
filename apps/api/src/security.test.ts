import { beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { openTestDb, type Db } from "@jobgraph/core";
import { createApp } from "./app.js";
import { clientIp, rateLimit, securityHeaders } from "./security.js";

let db: Db;
beforeAll(async () => { db = await openTestDb(); });

describe("security headers", () => {
  it("are set on every API response, HSTS only when asked", async () => {
    const app = createApp(db, { mcp: false, defaultUserEmail: null });
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("permissions-policy")).toContain("camera=()");
    expect(res.headers.get("strict-transport-security")).toBeNull();

    const missing = await app.request("/api/nope");
    expect(missing.status).toBe(401); // auth runs first; the headers still apply
    expect(missing.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("add HSTS when enabled", async () => {
    const a = new Hono();
    a.use("*", securityHeaders({ hsts: true }));
    a.get("/", (c) => c.text("ok"));
    const res = await a.request("/");
    expect(res.headers.get("strict-transport-security")).toContain("max-age=63072000");
  });
});

describe("rate limiting", () => {
  it("counts per client, replies 429 with Retry-After, and recovers after the window", async () => {
    let t = 1_000_000;
    const limiter = rateLimit([{ name: "t", windowMs: 10_000, max: 3, match: () => true }], () => t);
    const a = new Hono();
    a.use("*", limiter);
    a.onError((err, c) => (err instanceof HTTPException ? c.json({ error: err.message }, err.status) : c.json({ error: "x" }, 500)));
    a.get("/", (c) => c.text("ok"));
    const hit = (ip: string) => a.request("/", { headers: { "x-forwarded-for": ip } });

    for (let i = 0; i < 3; i++) expect((await hit("1.1.1.1")).status).toBe(200);
    const blocked = await hit("1.1.1.1");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await blocked.json()).error).toMatch(/too many/i);
    expect((await hit("2.2.2.2")).status).toBe(200); // another client is unaffected
    t += 10_001;
    expect((await hit("1.1.1.1")).status).toBe(200);
  });

  it("limits sign-in attempts on the real app and leaves other routes alone", async () => {
    const app = createApp(db, { mcp: false, defaultUserEmail: null, rateLimit: true });
    const login = () => app.request("/api/auth/login", {
      method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" },
      body: JSON.stringify({ email: "nobody@example.com", password: "wrong-password" }),
    });
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await login()).status);
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
    expect((await app.request("/api/health", { headers: { "x-forwarded-for": "9.9.9.9" } })).status).toBe(200);
  });

  it("reads the client address from proxy headers", async () => {
    const a = new Hono();
    a.get("/", (c) => c.text(clientIp(c)));
    // The first hop is whatever the client wrote; the nearest proxy's entry (last) or Fly's own header is what counts.
    expect(await (await a.request("/", { headers: { "x-forwarded-for": "3.3.3.3, 10.0.0.1" } })).text()).toBe("10.0.0.1");
    expect(await (await a.request("/", { headers: { "fly-client-ip": "4.4.4.4", "x-forwarded-for": "6.6.6.6" } })).text()).toBe("4.4.4.4");
    expect(await (await a.request("/")).text()).toBe("local");
  });

  it("trusts a forwarded address only when the web proxy signed it", async () => {
    const a = new Hono();
    a.get("/", (c) => c.text(clientIp(c, "proxy-secret")));
    const via = (sig: string) => a.request("/", { headers: { "x-nori-proxy": sig, "x-nori-client-ip": "5.5.5.5", "fly-client-ip": "7.7.7.7" } });
    expect(await (await via("proxy-secret")).text()).toBe("5.5.5.5");
    expect(await (await via("guess")).text()).toBe("7.7.7.7");
  });
});
