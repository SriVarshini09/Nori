import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { channels, consumeChannelLinkCode, ensureDefaultUser, openTestDb, type Db } from "@jobgraph/core";
import { createApp } from "./app.js";

let db: Db;
let app: ReturnType<typeof createApp>;
let userId: string;

async function call(method: string, url: string, body?: unknown) {
  const res = await app.request(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, text, json: (text ? JSON.parse(text) : null) as any };
}

beforeAll(async () => {
  db = await openTestDb();
  app = createApp(db, { mcp: false, defaultUserEmail: "me@example.com", notify: async () => undefined });
  userId = (await ensureDefaultUser(db, "me@example.com")).id;
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => vi.unstubAllEnvs());

describe("linking a Telegram chat", () => {
  it("refuses a code when the bot is not set up", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    expect((await call("GET", "/api/channels/telegram")).json).toEqual({ configured: false, botUsername: null, linked: false });
    expect((await call("POST", "/api/channels/telegram/link")).status).toBe(503);
  });

  it("issues a code for this account that the router can spend", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:test-token");
    const info = await call("GET", "/api/channels/telegram");
    expect(info.json).toMatchObject({ configured: true, linked: false }); // botUsername is null under tests (no network)
    const r = await call("POST", "/api/channels/telegram/link");
    expect(r.status).toBe(200);
    expect(r.json.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(new Date(r.json.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(r.json.link).toBeNull();
    expect(await consumeChannelLinkCode(db, r.json.code)).toBe(userId);
    // once a chat is linked, the info endpoint says so
    await db.insert(channels).values({ userId, kind: "telegram", address: "4242" });
    expect((await call("GET", "/api/channels/telegram")).json.linked).toBe(true);
  });
});
