import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TelegramChannel, chunkText, parseTelegramUpdates } from "./telegram.js";

const okJson = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("telegram", () => {
  beforeEach(() => { vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:SECRET"); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("is available only with a token", () => {
    expect(new TelegramChannel().available).toBe(true);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    expect(new TelegramChannel().available).toBe(false);
  });

  it("chunks text over 4000 chars on boundaries", () => {
    const text = Array.from({ length: 900 }, (_, i) => `line ${i}`).join("\n");
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 4000)).toBe(true);
    expect(chunks.join(" ").replace(/\s+/g, " ")).toBe(text.replace(/\s+/g, " "));
    expect(chunkText("short")).toEqual(["short"]);
  });

  it("sends long messages as multiple sendMessage calls with no parse_mode", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => okJson({ ok: true, result: {} }));
    vi.stubGlobal("fetch", fetchMock);
    await new TelegramChannel().send("42", { text: "x".repeat(9000) });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/bot123:SECRET/sendMessage");
    const body = JSON.parse(init.body as string);
    expect(body.chat_id).toBe("42");
    expect(body.parse_mode).toBeUndefined();
    expect(body.text.length).toBeLessThanOrEqual(4000);
  });

  it("does not leak the token in errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("connect failed https://api.telegram.org/bot123:SECRET/sendMessage"); }));
    const err = await new TelegramChannel().send("1", { text: "hi" }).catch((e: Error) => e);
    expect((err as Error).message).toContain("***");
    expect((err as Error).message).not.toContain("SECRET");
  });

  it("parses getUpdates and tracks the offset", () => {
    const { messages, nextOffset } = parseTelegramUpdates({
      ok: true,
      result: [
        { update_id: 10, message: { message_id: 1, text: "hello", chat: { id: 555, type: "private" }, from: { id: 9, username: "sri" } } },
        { update_id: 11, message: { message_id: 2, chat: { id: 555 } } },
        { update_id: 12, edited_message: {} },
      ],
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ channel: "telegram", address: "555", text: "hello", externalId: "10" });
    expect(nextOffset).toBe(13);
  });

  it("listen long-polls with offset and stops cleanly", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      if (bodies.length === 1) {
        return Promise.resolve(okJson({ ok: true, result: [{ update_id: 7, message: { message_id: 1, text: "apply to #2", chat: { id: 1 } } }] }));
      }
      return new Promise((_res, rej) => init.signal!.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    }));
    const got: string[] = [];
    const stop = await new TelegramChannel().listen(async (m) => { got.push(m.text); });
    await vi.waitFor(() => expect(bodies.length).toBeGreaterThanOrEqual(2));
    expect(got).toEqual(["apply to #2"]);
    expect(bodies[0]).toMatchObject({ timeout: 30 });
    expect(bodies[0].offset).toBeUndefined();
    expect(bodies[1].offset).toBe(8);
    stop();
    await new Promise((r) => setTimeout(r, 20));
    expect(bodies.length).toBe(2);
  });
});
