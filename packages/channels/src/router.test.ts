import { afterEach, describe, expect, it, vi } from "vitest";
import { channels, conversations, openTestDb, type ChannelAdapter, type InboundMessage, type OutboundMessage } from "@jobgraph/core";
import { eq } from "drizzle-orm";
import { createChannelRouter, sendToUser } from "./router.js";

function fakeTelegram() {
  const sent: { address: string; msg: OutboundMessage }[] = [];
  let handler: ((m: InboundMessage) => Promise<void>) | null = null;
  const adapter: ChannelAdapter = {
    kind: "telegram", available: true,
    async send(address, msg) { sent.push({ address, msg }); },
    async listen(h) { handler = h; return () => { handler = null; }; },
  };
  return { adapter, sent, emit: (m: InboundMessage) => handler!(m) };
}

describe("channel router", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("auto-links unknown telegram chats to the default user, stores turns and replies", async () => {
    vi.stubEnv("TELEGRAM_AUTOLINK", "true");
    vi.stubEnv("DEFAULT_USER_EMAIL", "me@example.com");
    const db = await openTestDb();
    const tg = fakeTelegram();
    const onMessage = vi.fn(async (_u: string, m: InboundMessage) => ({ text: `echo: ${m.text}` }));
    const router = createChannelRouter(db, { onMessage }, { adapters: [tg.adapter] });
    const stop = await router.start();
    await tg.emit({ channel: "telegram", address: "777", text: "find jobs" });

    const [ch] = await db.select().from(channels);
    expect(ch).toMatchObject({ kind: "telegram", address: "777" });
    expect(onMessage).toHaveBeenCalledWith(ch.userId, expect.objectContaining({ text: "find jobs" }));
    const turns = await db.select().from(conversations).where(eq(conversations.channelId, ch.id));
    expect(turns.map((t) => `${t.role}:${t.content}`).sort()).toEqual(["assistant:echo: find jobs", "user:find jobs"]);
    expect(tg.sent).toEqual([{ address: "777", msg: { text: "echo: find jobs" } }]);

    await tg.emit({ channel: "telegram", address: "777", text: "again" });
    expect(await db.select().from(channels)).toHaveLength(1);
    stop();
  });

  it("does not link unknown chats without TELEGRAM_AUTOLINK", async () => {
    vi.stubEnv("TELEGRAM_AUTOLINK", "false");
    const db = await openTestDb();
    const tg = fakeTelegram();
    const onMessage = vi.fn(async () => ({ text: "x" }));
    const router = createChannelRouter(db, { onMessage }, { adapters: [tg.adapter] });
    await router.start();
    await tg.emit({ channel: "telegram", address: "1", text: "hi" });
    expect(onMessage).not.toHaveBeenCalled();
    expect(await db.select().from(channels)).toHaveLength(0);
    expect(tg.sent[0].msg.text).toMatch(/not linked/);
  });

  it("sendToUser sends on every linked channel", async () => {
    vi.stubEnv("TELEGRAM_AUTOLINK", "true");
    const db = await openTestDb();
    const tg = fakeTelegram();
    const router = createChannelRouter(db, { onMessage: async () => ({ text: "ok" }) }, { adapters: [tg.adapter] });
    await router.start();
    await tg.emit({ channel: "telegram", address: "5", text: "hi" });
    tg.sent.length = 0;
    const [ch] = await db.select().from(channels);
    const res = await sendToUser(db, ch.userId, { text: "digest" }, { adapters: [tg.adapter] });
    expect(res.sent).toBe(1);
    expect(tg.sent).toEqual([{ address: "5", msg: { text: "digest" } }]);
  });
});
