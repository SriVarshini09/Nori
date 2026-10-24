import { readFile } from "node:fs/promises";
import type { ChannelAdapter, InboundMessage, OutboundMessage } from "@jobgraph/core";

const MAX_LEN = 4000;

/** Split text into chunks of at most `max` chars, preferring paragraph, line, then word boundaries. */
export function chunkText(text: string, max = MAX_LEN): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"), window.lastIndexOf(" "));
    if (cut < max * 0.5) cut = max;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).replace(/^\s+/, "");
  }
  if (rest) out.push(rest);
  return out.filter((c) => c.length > 0);
}

type TgUpdate = {
  update_id: number;
  message?: { message_id: number; text?: string; caption?: string; chat: { id: number | string; type?: string }; from?: { id: number; username?: string; first_name?: string; is_bot?: boolean } };
};

/** Turn a getUpdates response into inbound messages plus the next offset. Non-text updates are skipped. */
export function parseTelegramUpdates(json: unknown): { messages: InboundMessage[]; nextOffset?: number } {
  const body = json as { ok?: boolean; result?: TgUpdate[] };
  const messages: InboundMessage[] = [];
  let nextOffset: number | undefined;
  if (!body?.ok || !Array.isArray(body.result)) return { messages };
  for (const u of body.result) {
    if (typeof u.update_id === "number") nextOffset = Math.max(nextOffset ?? 0, u.update_id + 1);
    const m = u.message;
    const text = m?.text ?? m?.caption;
    if (!m || !text || m.from?.is_bot) continue;
    messages.push({
      channel: "telegram",
      address: String(m.chat.id),
      text,
      externalId: String(u.update_id),
      meta: { messageId: m.message_id, username: m.from?.username, firstName: m.from?.first_name, chatType: m.chat.type },
    });
  }
  return { messages, nextOffset };
}

/** Where the listener keeps the next update id to ask for, so a restart does not hand old updates out again. */
export type OffsetStore = { load(): Promise<number | undefined>; save(offset: number): Promise<void> };

export class TelegramChannel implements ChannelAdapter {
  kind = "telegram" as const;
  private tokenOverride?: string;
  private offsets?: OffsetStore;
  constructor(opts: { token?: string; offsets?: OffsetStore } = {}) { this.tokenOverride = opts.token; this.offsets = opts.offsets; }

  private get token(): string | undefined { return this.tokenOverride ?? process.env.TELEGRAM_BOT_TOKEN; }
  get available(): boolean { return Boolean(this.token); }

  private async call(method: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> {
    const token = this.token;
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
    let res: Response;
    try {
      res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { ...init, signal });
    } catch (err) {
      if ((err as Error).name === "AbortError") throw err;
      throw new Error(`Telegram ${method} request failed: ${redact((err as Error).message, token)}`);
    }
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    if (!res.ok || json.ok === false) throw new Error(`Telegram ${method} failed (${res.status}): ${json.description ?? "unknown error"}`);
    return json;
  }

  async send(address: string, msg: OutboundMessage): Promise<void> {
    if (msg.text) {
      for (const chunk of chunkText(msg.text)) {
        await this.call("sendMessage", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: address, text: chunk }),
        });
      }
    }
    for (const att of msg.attachments ?? []) {
      const bytes = await readFile(att.path);
      const form = new FormData();
      form.append("chat_id", address);
      form.append("document", new Blob([new Uint8Array(bytes)]), att.filename);
      await this.call("sendDocument", { method: "POST", body: form });
    }
  }

  async listen(handler: (msg: InboundMessage) => Promise<void>): Promise<() => void> {
    if (!this.available) { console.warn("[telegram] TELEGRAM_BOT_TOKEN not set; not listening"); return () => {}; }
    const ctl = new AbortController();
    // Telegram re-delivers every update after the last acknowledged offset. Kept only in memory, a crash or restart
    // re-ran the last batch ("approve" twice). The offset is saved before the messages are handled: after a crash a
    // message may be lost (the person sends it again), but a command never runs twice.
    let offset: number | undefined = await this.offsets?.load().catch(() => undefined);
    const loop = async () => {
      while (!ctl.signal.aborted) {
        try {
          const json = await this.call("getUpdates", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ timeout: 30, allowed_updates: ["message"], ...(offset !== undefined ? { offset } : {}) }),
          }, ctl.signal);
          const { messages, nextOffset } = parseTelegramUpdates(json);
          if (nextOffset !== undefined) {
            offset = nextOffset;
            await this.offsets?.save(nextOffset).catch((e) => console.warn("[telegram] could not save offset:", (e as Error).message));
          }
          for (const m of messages) {
            try { await handler(m); } catch (err) { console.warn("[telegram] handler error:", (err as Error).message); }
          }
        } catch (err) {
          if (ctl.signal.aborted) break;
          console.warn("[telegram] getUpdates error:", (err as Error).message);
          await sleep(5000, ctl.signal);
        }
      }
    };
    void loop();
    return () => ctl.abort();
  }
}

let botInfo: { username: string | null; token: string; at: number } | null = null;

/**
 * The bot's @username from getMe, cached per token (a failed lookup is retried after a minute). Null when there is no
 * token, the lookup fails, or under tests without an explicit token.
 */
export async function telegramBotUsername(opts: { token?: string } = {}): Promise<string | null> {
  const token = opts.token ?? process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  if (process.env.VITEST && !opts.token) return null;
  if (botInfo && botInfo.token === token && (botInfo.username || Date.now() - botInfo.at < 60_000)) return botInfo.username;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(8000) });
    const json = (await res.json()) as { ok?: boolean; result?: { username?: string } };
    botInfo = { username: json.ok && json.result?.username ? json.result.username : null, token, at: Date.now() };
  } catch {
    botInfo = { username: null, token, at: Date.now() };
  }
  return botInfo.username;
}

function redact(s: string, secret: string) { return s.split(secret).join("***"); }

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() { clearTimeout(t); signal.removeEventListener("abort", done); resolve(); }
    signal.addEventListener("abort", done);
  });
}
