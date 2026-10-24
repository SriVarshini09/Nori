import { and, eq } from "drizzle-orm";
import {
  channels, consumeChannelLinkCode, conversations, ensureDefaultUser, extractLinkCode, getState, setState,
  type ChannelAdapter, type ChannelKind, type Db, type InboundMessage, type OutboundMessage,
} from "@jobgraph/core";
import { EmailChannel } from "./email.js";
import { SlackChannel } from "./slack.js";
import { TelegramChannel } from "./telegram.js";
import { WhatsAppChannel } from "./whatsapp.js";

export type RouterHandlers = {
  onMessage: (userId: string, msg: InboundMessage) => Promise<OutboundMessage>;
};

export type RouterOptions = {
  /** Replace the default adapters (tests, custom wiring). */
  adapters?: ChannelAdapter[];
};

/** Where to link a chat from, for the notice an unknown chat gets back. */
const settingsPlace = () => (process.env.WEB_URL ? `${process.env.WEB_URL.replace(/\/$/, "")}/settings` : "Settings on the dashboard");
const UNLINKED: Record<string, () => string> = {
  telegram: () => `This chat is not linked to a Nori account yet. Open ${settingsPlace()}, press "Link Telegram", and send me the code it shows.`,
  whatsapp: () => `This number is not linked to a Nori account yet. Link it from ${settingsPlace()} (Channels).`,
};
const LINKED_TEXT = "Linked. This chat now reaches your Nori account. Say 'status' to see where things stand.";
const BAD_CODE_TEXT = "That code is not valid or has expired. Press \"Link Telegram\" in Settings, Channels for a new one and send it here.";

/** Adapter for sending as a given user. Slack and email go through that user's Composio connections. */
function adapterFor(kind: ChannelKind, userId: string, shared: ChannelAdapter[], overridden = false): ChannelAdapter | undefined {
  if (overridden) return shared.find((a) => a.kind === kind);
  if (kind === "slack") return new SlackChannel({ userId });
  if (kind === "email") return new EmailChannel({ userId });
  return shared.find((a) => a.kind === kind);
}

export function createChannelRouter(db: Db, handlers: RouterHandlers, options: RouterOptions = {}) {
  const whatsapp = new WhatsAppChannel();
  // Telegram's read position lives in the database, so a restart (or the other process taking over) carries on from it.
  const offsets = { load: () => getState<number>(db, "telegram:offset"), save: (n: number) => setState(db, "telegram:offset", n) };
  const shared: ChannelAdapter[] = options.adapters ?? [new TelegramChannel({ offsets }), whatsapp];

  async function resolveChannel(msg: InboundMessage) {
    const found = await db.query.channels.findFirst({ where: and(eq(channels.kind, msg.channel), eq(channels.address, msg.address)) });
    if (found) return found;
    if (msg.channel === "telegram" && process.env.TELEGRAM_AUTOLINK === "true") {
      const user = await ensureDefaultUser(db);
      const [row] = await db.insert(channels).values({
        userId: user.id, kind: "telegram", address: msg.address, meta: { autolinked: true, ...(msg.meta ?? {}) },
      }).onConflictDoNothing().returning();
      return row ?? (await db.query.channels.findFirst({ where: and(eq(channels.kind, "telegram"), eq(channels.address, msg.address)) }));
    }
    return undefined;
  }

  async function reply(msg: InboundMessage, userId: string, out: OutboundMessage) {
    const adapter = adapterFor(msg.channel, userId, shared, Boolean(options.adapters));
    if (!adapter?.available) return;
    await adapter.send(msg.address, out);
  }

  /** Handle one inbound message end to end. Returns the reply that was sent, or null if dropped. */
  async function handleInbound(msg: InboundMessage): Promise<OutboundMessage | null> {
    const channel = await resolveChannel(msg);
    if (!channel) {
      // A link code (alone, or as "/start CODE" from a t.me deep link) ties this chat to the account that issued it.
      const code = msg.channel === "telegram" ? extractLinkCode(msg.text) : null;
      if (code) {
        const userId = await consumeChannelLinkCode(db, code);
        let text = BAD_CODE_TEXT;
        if (userId) {
          const [row] = await db.insert(channels).values({ userId, kind: "telegram", address: msg.address, meta: { linkedWithCode: true, ...(msg.meta ?? {}) } })
            .onConflictDoNothing().returning();
          text = row ? LINKED_TEXT : "This chat is already linked to another Nori account.";
        }
        await reply(msg, userId ?? "", { text }).catch((e) => console.warn("[router] link reply failed:", (e as Error).message));
        return { text };
      }
      const note = UNLINKED[msg.channel]?.();
      if (note) await reply(msg, "", { text: note }).catch((e) => console.warn("[router] unlinked notice failed:", (e as Error).message));
      return null;
    }
    await db.insert(conversations).values({ channelId: channel.id, role: "user", content: msg.text });
    let out: OutboundMessage;
    try {
      out = await handlers.onMessage(channel.userId, msg);
    } catch (err) {
      console.warn("[router] onMessage failed:", (err as Error).message);
      out = { text: "Something went wrong handling that. Please try again." };
    }
    await db.insert(conversations).values({ channelId: channel.id, role: "assistant", content: out.text });
    try {
      await reply(msg, channel.userId, out);
    } catch (err) {
      console.warn(`[router] reply on ${msg.channel} failed:`, (err as Error).message);
    }
    return out;
  }

  /** Start every available adapter's listener. Returns a function that stops them all. */
  async function start(): Promise<() => void> {
    const stops: (() => void)[] = [];
    const onInbound = async (m: InboundMessage) => { await handleInbound(m); };
    for (const adapter of shared) {
      if (!adapter.available) continue;
      try { stops.push(await adapter.listen(onInbound)); } catch (err) { console.warn(`[router] ${adapter.kind} listen failed:`, (err as Error).message); }
    }
    if (!options.adapters) {
      // Slack triggers are per Composio user; listen for every user with a linked Slack channel.
      const slackRows = await db.select({ userId: channels.userId }).from(channels).where(eq(channels.kind, "slack"));
      for (const userId of new Set(slackRows.map((r) => r.userId))) {
        const slack = new SlackChannel({ userId });
        if (!slack.available) break;
        try { stops.push(await slack.listen(onInbound)); } catch (err) { console.warn("[router] slack listen failed:", (err as Error).message); }
      }
    }
    return () => stops.forEach((s) => s());
  }

  return {
    start, listen: start, handleInbound,
    /** Wire to the WhatsApp webhook routes. */
    whatsapp,
  };
}

export type ChannelRouter = ReturnType<typeof createChannelRouter>;

/** Send to every channel the user has linked. Never throws for a single failing channel. */
export async function sendToUser(db: Db, userId: string, msg: OutboundMessage, options: RouterOptions = {}): Promise<{ sent: number; failed: { kind: ChannelKind; error: string }[] }> {
  const rows = await db.select().from(channels).where(eq(channels.userId, userId));
  const shared = options.adapters ?? [new TelegramChannel(), new WhatsAppChannel()];
  let sent = 0;
  const failed: { kind: ChannelKind; error: string }[] = [];
  for (const row of rows) {
    const adapter = adapterFor(row.kind, userId, shared, Boolean(options.adapters));
    if (!adapter?.available) { failed.push({ kind: row.kind, error: "channel not available" }); continue; }
    try { await adapter.send(row.address, msg); sent++; } catch (err) { failed.push({ kind: row.kind, error: (err as Error).message }); }
  }
  return { sent, failed };
}
