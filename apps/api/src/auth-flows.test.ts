import { beforeAll, describe, expect, it } from "vitest";
import { openTestDb, issueAuthToken, type Db } from "@jobgraph/core";
import { eq } from "drizzle-orm";
import { authTokens } from "@jobgraph/core";
import { createApp } from "./app.js";
import type { Mail } from "./mailer.js";
import { describeDevice } from "./http.js";

let db: Db;
let app: ReturnType<typeof createApp>;
const outbox: Mail[] = [];

type Res = { status: number; json: any; cookie: string | null };
async function call(method: string, url: string, body?: unknown, cookie?: string, ua?: string): Promise<Res> {
  const res = await app.request(url, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(ua ? { "user-agent": ua } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = text; }
  const set = res.headers.get("set-cookie");
  return { status: res.status, json, cookie: set ? set.split(";")[0] : null };
}
const tokenIn = (m: Mail) => new URL(m.text.match(/https?:\/\/\S+/)![0]).searchParams.get("token")!;
const lastMail = () => outbox[outbox.length - 1];

beforeAll(async () => {
  db = await openTestDb();
  app = createApp(db, { mcp: false, defaultUserEmail: null, rateLimit: false, webUrl: "https://nori.test", mailer: async (m) => { outbox.push(m); } });
});

describe("email verification", () => {
  it("emails a link at signup and verifies the address once", async () => {
    const signup = await call("POST", "/api/auth/signup", { email: "Verify.Me@Example.com", password: "first-password" });
    expect(signup.status).toBe(201);
    expect(signup.json.user.emailVerifiedAt).toBeNull();
    await vi_waitFor(() => outbox.length > 0);
    const mail = lastMail();
    expect(mail.to).toBe("verify.me@example.com");
    expect(mail.text).toContain("https://nori.test/verify-email?token=");
    expect(mail.html).toContain("Confirm my email");

    const token = tokenIn(mail);
    const ok = await call("POST", "/api/auth/verify-email", { token });
    expect(ok.status).toBe(200);
    const me = await call("GET", "/api/auth/session", undefined, signup.cookie!);
    expect(me.json.user.emailVerifiedAt).toBeTruthy();

    const again = await call("POST", "/api/auth/verify-email", { token });
    expect(again.status).toBe(400);
    expect((await call("POST", "/api/auth/verify-email", { token: "not-a-real-token-value" })).status).toBe(400);
  });

  it("sends a fresh link on request, retires the old one, and stops once verified", async () => {
    const signup = await call("POST", "/api/auth/signup", { email: "later@example.com", password: "first-password" });
    await vi_waitFor(() => outbox.some((m) => m.to === "later@example.com"));
    const first = tokenIn(outbox.filter((m) => m.to === "later@example.com").at(-1)!);
    const before = outbox.length;
    const resend = await call("POST", "/api/auth/resend-verification", {}, signup.cookie!);
    expect(resend.json).toEqual({ ok: true, verified: false });
    expect(outbox.length).toBe(before + 1);
    expect((await call("POST", "/api/auth/verify-email", { token: first })).status).toBe(400); // superseded
    expect((await call("POST", "/api/auth/verify-email", { token: tokenIn(lastMail()) })).status).toBe(200);

    const n = outbox.length;
    const after = await call("POST", "/api/auth/resend-verification", {}, signup.cookie!);
    expect(after.json).toEqual({ ok: true, verified: true });
    expect(outbox.length).toBe(n); // nothing to send
    expect((await call("POST", "/api/auth/resend-verification", {})).status).toBe(401);
  });

  it("rejects an expired link", async () => {
    const signup = await call("POST", "/api/auth/signup", { email: "slow@example.com", password: "first-password" });
    const id = signup.json.user.id as string;
    const token = await issueAuthToken(db, id, "verify");
    await db.update(authTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(authTokens.userId, id));
    expect((await call("POST", "/api/auth/verify-email", { token })).status).toBe(400);
  });
});

describe("password reset", () => {
  it("answers the same for unknown and known addresses, and only emails the real one", async () => {
    await call("POST", "/api/auth/signup", { email: "forgetful@example.com", password: "old-password-1" });
    const before = outbox.length;
    const unknown = await call("POST", "/api/auth/forgot-password", { email: "nobody@example.com" });
    const known = await call("POST", "/api/auth/forgot-password", { email: "forgetful@example.com" });
    expect(unknown).toMatchObject({ status: 200, json: { ok: true } });
    expect(known).toMatchObject({ status: 200, json: { ok: true } });
    await vi_waitFor(() => outbox.some((m, i) => i >= before && m.subject.includes("Reset")));
    expect(outbox.slice(before).filter((m) => m.subject.includes("Reset")).map((m) => m.to)).toEqual(["forgetful@example.com"]);
    expect((await call("POST", "/api/auth/forgot-password", { email: "not-an-email" })).status).toBe(400);
  });

  it("sets a new password once, signs every old session out, and refuses the link a second time", async () => {
    const signup = await call("POST", "/api/auth/signup", { email: "reset@example.com", password: "old-password-1" });
    const oldSession = signup.cookie!;
    await call("POST", "/api/auth/forgot-password", { email: "reset@example.com" });
    await vi_waitFor(() => outbox.some((m) => m.to === "reset@example.com" && m.subject.includes("Reset")));
    const token = tokenIn(outbox.filter((m) => m.to === "reset@example.com" && m.subject.includes("Reset")).at(-1)!);

    expect((await call("POST", "/api/auth/reset-password", { token, password: "short" })).status).toBe(400);
    const reset = await call("POST", "/api/auth/reset-password", { token, password: "brand-new-password" });
    expect(reset.status).toBe(200);

    expect((await call("GET", "/api/auth/session", undefined, oldSession)).status).toBe(401);
    expect((await call("POST", "/api/auth/login", { email: "reset@example.com", password: "old-password-1" })).status).toBe(401);
    expect((await call("POST", "/api/auth/login", { email: "reset@example.com", password: "brand-new-password" })).status).toBe(200);
    expect((await call("POST", "/api/auth/reset-password", { token, password: "another-password-9" })).status).toBe(400);
  });

  it("a reset link is useless as a verification link, and the other way round", async () => {
    const signup = await call("POST", "/api/auth/signup", { email: "kinds@example.com", password: "old-password-1" });
    const reset = await issueAuthToken(db, signup.json.user.id, "reset");
    expect((await call("POST", "/api/auth/verify-email", { token: reset })).status).toBe(400);
    const verify = await issueAuthToken(db, signup.json.user.id, "verify");
    expect((await call("POST", "/api/auth/reset-password", { token: verify, password: "whatever-password" })).status).toBe(400);
  });
});

describe("change password and sessions", () => {
  it("changes the password, keeps this session, and signs the other devices out", async () => {
    const a = await call("POST", "/api/auth/signup", { email: "devices@example.com", password: "old-password-1" }, undefined, "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36");
    const b = await call("POST", "/api/auth/login", { email: "devices@example.com", password: "old-password-1" }, undefined, "Mozilla/5.0 (iPhone; CPU iPhone OS 17) Safari/604.1");

    const list = await call("GET", "/api/auth/sessions", undefined, a.cookie!);
    expect(list.json).toHaveLength(2);
    expect(list.json.filter((s: any) => s.current)).toHaveLength(1);
    expect(list.json.map((s: any) => s.device).sort()).toEqual(["Chrome on Windows", "Safari on iOS"]);
    expect(JSON.stringify(list.json)).not.toMatch(/Mozilla|tokenHash/);

    expect((await call("POST", "/api/auth/change-password", { current: "wrong-password", next: "new-password-22" }, a.cookie!)).status).toBe(400);
    expect((await call("POST", "/api/auth/change-password", { current: "old-password-1", next: "old-password-1" }, a.cookie!)).status).toBe(400);
    expect((await call("POST", "/api/auth/change-password", { current: "old-password-1", next: "short" }, a.cookie!)).status).toBe(400);
    expect((await call("POST", "/api/auth/change-password", { current: "old-password-1", next: "new-password-22" })).status).toBe(401);
    const ok = await call("POST", "/api/auth/change-password", { current: "old-password-1", next: "new-password-22" }, a.cookie!);
    expect(ok.status).toBe(200);

    expect((await call("GET", "/api/auth/session", undefined, a.cookie!)).status).toBe(200);
    expect((await call("GET", "/api/auth/session", undefined, b.cookie!)).status).toBe(401);
    expect((await call("POST", "/api/auth/login", { email: "devices@example.com", password: "new-password-22" })).status).toBe(200);
    expect((await call("POST", "/api/auth/login", { email: "devices@example.com", password: "old-password-1" })).status).toBe(401);
  });

  it("revokes one session, refuses to revoke the current one here, and can sign out everywhere else", async () => {
    const a = await call("POST", "/api/auth/signup", { email: "revoke@example.com", password: "old-password-1" });
    const b = await call("POST", "/api/auth/login", { email: "revoke@example.com", password: "old-password-1" });
    const c = await call("POST", "/api/auth/login", { email: "revoke@example.com", password: "old-password-1" });

    const list = (await call("GET", "/api/auth/sessions", undefined, a.cookie!)).json as { id: string; current: boolean }[];
    expect(list).toHaveLength(3);
    const current = list.find((s) => s.current)!;
    expect((await call("DELETE", `/api/auth/sessions/${current.id}`, undefined, a.cookie!)).status).toBe(400);
    expect((await call("DELETE", "/api/auth/sessions/not-a-uuid", undefined, a.cookie!)).status).toBe(404);

    const other = list.find((s) => !s.current)!;
    expect((await call("DELETE", `/api/auth/sessions/${other.id}`, undefined, a.cookie!)).status).toBe(204);
    const dead = [b, c];
    const statuses = await Promise.all(dead.map(async (x) => (await call("GET", "/api/auth/session", undefined, x.cookie!)).status));
    expect(statuses.sort()).toEqual([200, 401]);

    const out = await call("POST", "/api/auth/sessions/revoke-others", {}, a.cookie!);
    expect(out.json.revoked).toBe(1);
    expect((await call("GET", "/api/auth/session", undefined, a.cookie!)).status).toBe(200);
    expect((await call("GET", "/api/auth/sessions", undefined, a.cookie!)).json).toHaveLength(1);
  });

  it("cannot see or revoke another person's sessions", async () => {
    const mine = await call("POST", "/api/auth/signup", { email: "mine@example.com", password: "old-password-1" });
    const theirs = await call("POST", "/api/auth/signup", { email: "theirs@example.com", password: "old-password-1" });
    const theirId = (await call("GET", "/api/auth/sessions", undefined, theirs.cookie!)).json[0].id as string;
    expect((await call("DELETE", `/api/auth/sessions/${theirId}`, undefined, mine.cookie!)).status).toBe(404);
    expect((await call("GET", "/api/auth/session", undefined, theirs.cookie!)).status).toBe(200);
  });
});

describe("describeDevice", () => {
  it("names the browser and system, never the raw user agent", () => {
    expect(describeDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit Version/17 Safari/605.1")).toBe("Safari on macOS");
    expect(describeDevice("Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0")).toBe("Firefox on Linux");
    expect(describeDevice("Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537 Edg/120")).toBe("Edge on Windows");
    expect(describeDevice(null)).toBe("Unknown device");
    expect(describeDevice("curl/8.0")).toBe("Unknown device");
  });
});

/** Mail is sent in the background; wait for it instead of sleeping a fixed time. */
async function vi_waitFor(cond: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out waiting for background work");
    await new Promise((r) => setTimeout(r, 20));
  }
}
