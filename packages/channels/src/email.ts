import type { ChannelAdapter, InboundMessage, OutboundMessage } from "@jobgraph/core";
import { composioAvailable, executeTool } from "./composio.js";

/** Outbound email through the user's Gmail (Composio). Send only; inbound mail goes through inbox.ts. */
export class EmailChannel implements ChannelAdapter {
  kind = "email" as const;
  constructor(private opts: { userId?: string } = {}) {}

  get available(): boolean { return composioAvailable(); }

  async send(address: string, msg: OutboundMessage): Promise<void> {
    const userId = this.opts.userId ?? process.env.COMPOSIO_USER_ID;
    if (!userId) throw new Error("EmailChannel needs a userId (or COMPOSIO_USER_ID) to reach Composio");
    const firstLine = msg.text.split("\n").find((l) => l.trim()) ?? "jobgraph update";
    const subject = firstLine.trim().slice(0, 78);
    const base = { recipient_email: address, subject, body: msg.text };
    const attachment = msg.attachments?.[0]?.path;
    if (attachment) {
      try {
        await executeTool(userId, "GMAIL_SEND_EMAIL", { ...base, attachment });
        return;
      } catch (err) {
        console.warn("[email] send with attachment failed, retrying without:", (err as Error).message.slice(0, 200));
      }
    }
    await executeTool(userId, "GMAIL_SEND_EMAIL", base);
  }

  async listen(_handler: (msg: InboundMessage) => Promise<void>): Promise<() => void> {
    return () => {};
  }
}
