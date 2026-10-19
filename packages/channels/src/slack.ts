import type { ChannelAdapter, InboundMessage, OutboundMessage } from "@jobgraph/core";
import { composioAvailable, executeTool, getComposio } from "./composio.js";
import { chunkText } from "./telegram.js";

export const SLACK_MESSAGE_TRIGGER = "SLACK_RECEIVE_MESSAGE";

/** Parse a Composio Slack trigger payload into an inbound message; bot messages are skipped. */
export function parseSlackTrigger(payload: Record<string, unknown> | undefined): InboundMessage | null {
  if (!payload) return null;
  const ev = ((payload.event as Record<string, unknown> | undefined) ?? payload) as Record<string, unknown>;
  const text = typeof ev.text === "string" ? ev.text : undefined;
  const channel = typeof ev.channel === "string" ? ev.channel : undefined;
  if (!text || !channel) return null;
  if (ev.bot_id || ev.subtype === "bot_message") return null;
  return { channel: "slack", address: channel, text, externalId: typeof ev.ts === "string" ? ev.ts : undefined, meta: { user: ev.user, threadTs: ev.thread_ts } };
}

/** Slack over Composio. Address is the Slack channel id. `userId` is the Composio user id (the jobgraph user id). */
export class SlackChannel implements ChannelAdapter {
  kind = "slack" as const;
  constructor(private opts: { userId?: string } = {}) {}

  get available(): boolean { return composioAvailable(); }

  private get userId(): string {
    const id = this.opts.userId ?? process.env.COMPOSIO_USER_ID;
    if (!id) throw new Error("SlackChannel needs a userId (or COMPOSIO_USER_ID) to reach Composio");
    return id;
  }

  async send(address: string, msg: OutboundMessage): Promise<void> {
    const userId = this.userId;
    const names = (msg.attachments ?? []).map((a) => a.filename);
    const text = names.length ? `${msg.text}\n\n(Attachments not sent over Slack: ${names.join(", ")})` : msg.text;
    for (const chunk of chunkText(text, 3500)) {
      try {
        await executeTool(userId, "SLACK_SEND_MESSAGE", { channel: address, markdown_text: chunk });
      } catch (err) {
        // older tool versions take `text`
        if (!/markdown_text|unknown|invalid|argument/i.test((err as Error).message)) throw err;
        await executeTool(userId, "SLACK_SEND_MESSAGE", { channel: address, text: chunk });
      }
    }
  }

  async listen(handler: (msg: InboundMessage) => Promise<void>): Promise<() => void> {
    if (!this.available) { console.warn("[slack] COMPOSIO_API_KEY not set; Slack listener disabled"); return () => {}; }
    let stopped = false;
    try {
      const userId = this.userId;
      const composio = getComposio();
      try {
        await composio.triggers.create(userId, SLACK_MESSAGE_TRIGGER, { triggerConfig: {} });
      } catch (err) {
        console.warn("[slack] could not create trigger (may already exist):", (err as Error).message.slice(0, 200));
      }
      await composio.triggers.subscribe((data) => {
        if (stopped) return;
        const msg = parseSlackTrigger(data.payload);
        if (msg) handler(msg).catch((err) => console.warn("[slack] handler error:", (err as Error).message));
      }, { userId, triggerSlug: [SLACK_MESSAGE_TRIGGER] });
      return () => { stopped = true; composio.triggers.unsubscribe().catch(() => {}); };
    } catch (err) {
      console.warn("[slack] trigger listener unavailable, Slack is send-only:", (err as Error).message.slice(0, 200));
      return () => {};
    }
  }
}
