import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { ChannelAdapter, InboundMessage, OutboundMessage } from "@jobgraph/core";
import { chunkText } from "./telegram.js";

const GRAPH = "https://graph.facebook.com/v21.0";

type WaMessage = {
  id?: string; from?: string; type?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
};

/** Parse a Meta WhatsApp Cloud API webhook body into inbound text messages. */
export function parseWhatsAppWebhook(body: unknown): InboundMessage[] {
  const out: InboundMessage[] = [];
  const entries = (body as { entry?: unknown[] })?.entry;
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    const changes = ((entry as { changes?: unknown[] }).changes ?? []) as { value?: { messages?: WaMessage[]; contacts?: { profile?: { name?: string } }[] } }[];
    for (const change of changes) {
      const name = change.value?.contacts?.[0]?.profile?.name;
      for (const m of change.value?.messages ?? []) {
        const text = m.type === "text" ? m.text?.body : m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title;
        if (!text || typeof m.from !== "string") continue;
        out.push({ channel: "whatsapp", address: m.from, text, externalId: m.id, meta: { name } });
      }
    }
  }
  return out;
}

/**
 * Meta signs every webhook POST with the app secret: `X-Hub-Signature-256: sha256=<hex HMAC of the raw body>`.
 * Without this check anyone who knows a linked phone number could post a forged message and drive that person's agent.
 * No secret configured means no inbound messages at all (fail closed).
 */
export function verifyWhatsAppSignature(rawBody: string, header: string | undefined, secret = process.env.WHATSAPP_APP_SECRET): boolean {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  let got: Buffer;
  try { got = Buffer.from(header.slice(7), "hex"); } catch { return false; }
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** WhatsApp Cloud API. Inbound needs a public webhook: wire POST to `handleWebhook(body)` and GET to `verifyWebhook(query)`. */
export class WhatsAppChannel implements ChannelAdapter {
  kind = "whatsapp" as const;
  private handler: ((msg: InboundMessage) => Promise<void>) | null = null;
  /** Message ids already handled: Meta retries deliveries, and a replayed signed body must not run a command twice. */
  private seen = new Set<string>();

  get available(): boolean { return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID); }

  private async api(path: string, init: RequestInit): Promise<{ id?: string }> {
    const res = await fetch(`${GRAPH}/${process.env.WHATSAPP_PHONE_ID}/${path}`, {
      ...init,
      headers: { authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, ...(init.headers ?? {}) },
    });
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string }; id?: string };
    if (!res.ok) throw new Error(`WhatsApp ${path} failed (${res.status}): ${json.error?.message ?? "unknown error"}`);
    return json;
  }

  private post(payload: Record<string, unknown>) {
    return this.api("messages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", ...payload }) });
  }

  async send(address: string, msg: OutboundMessage): Promise<void> {
    if (!this.available) throw new Error("WHATSAPP_TOKEN and WHATSAPP_PHONE_ID are required");
    const to = address.replace(/[^\d]/g, "");
    if (msg.text) for (const chunk of chunkText(msg.text, 4000)) await this.post({ to, type: "text", text: { body: chunk } });
    for (const att of msg.attachments ?? []) {
      const bytes = await readFile(att.path);
      const form = new FormData();
      form.append("messaging_product", "whatsapp");
      form.append("file", new Blob([new Uint8Array(bytes)], { type: "application/pdf" }), att.filename);
      form.append("type", "application/pdf");
      const media = await this.api("media", { method: "POST", body: form });
      if (!media.id) throw new Error("WhatsApp media upload returned no id");
      await this.post({ to, type: "document", document: { id: media.id, filename: att.filename } });
    }
  }

  /** Registers the handler; messages arrive via handleWebhook. */
  async listen(handler: (msg: InboundMessage) => Promise<void>): Promise<() => void> {
    this.handler = handler;
    return () => { if (this.handler === handler) this.handler = null; };
  }

  /** Call from the POST webhook route. Returns the parsed messages after dispatching them to the listener. */
  async handleWebhook(body: unknown): Promise<InboundMessage[]> {
    const msgs = parseWhatsAppWebhook(body).filter((m) => {
      if (!m.externalId) return true;
      if (this.seen.has(m.externalId)) return false;
      this.seen.add(m.externalId);
      if (this.seen.size > 5000) this.seen.delete(this.seen.values().next().value as string);
      return true;
    });
    for (const m of msgs) {
      try { await this.handler?.(m); } catch (err) { console.warn("[whatsapp] handler error:", (err as Error).message); }
    }
    return msgs;
  }

  /** GET webhook verification: returns the challenge to echo, or null if the token does not match. */
  verifyWebhook(query: Record<string, string | undefined>): string | null {
    const expected = process.env.WHATSAPP_VERIFY_TOKEN;
    if (query["hub.mode"] === "subscribe" && expected && query["hub.verify_token"] === expected) return query["hub.challenge"] ?? "";
    return null;
  }
}
