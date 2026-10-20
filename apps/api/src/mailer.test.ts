import { createServer, type Server } from "node:net";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultMailer, mailerState, resetEmail, smtpMailer, verifyEmail } from "./mailer.js";

/** A just-enough SMTP server: it accepts one message and keeps what it was sent. */
let server: Server;
let port: number;
const received: string[] = [];
/** What a mail client would show: undo quoted-printable soft line breaks and =XX escapes. */
const decoded = (raw: string) => raw.replace(/=\n/g, "").replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

beforeAll(async () => {
  server = createServer((sock) => {
    let inData = false;
    let buf = "";
    let data = "";
    const say = (s: string) => sock.write(`${s}\r\n`);
    say("220 test ESMTP");
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      for (;;) {
        const nl = buf.indexOf("\r\n");
        if (nl < 0) return;
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        if (inData) {
          if (line === ".") { inData = false; received.push(data); data = ""; say("250 queued"); } else data += `${line}\n`;
        } else if (/^EHLO|^HELO/i.test(line)) say("250 test");
        else if (/^MAIL FROM|^RCPT TO/i.test(line)) say("250 ok");
        else if (/^DATA/i.test(line)) { inData = true; say("354 go ahead"); }
        else if (/^QUIT/i.test(line)) { say("221 bye"); sock.end(); }
        else say("250 ok");
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("mailerState", () => {
  it("picks Resend, then SMTP, else the console, and says what is missing", () => {
    expect(mailerState({})).toMatchObject({ mode: "console", blockedBy: "RESEND_API_KEY or SMTP_URL" });
    expect(mailerState({ RESEND_API_KEY: "k", EMAIL_FROM: "a@b.c" })).toMatchObject({ mode: "resend", blockedBy: null });
    expect(mailerState({ SMTP_URL: "smtp://h", EMAIL_FROM: "a@b.c" })).toMatchObject({ mode: "smtp", blockedBy: null });
    expect(mailerState({ SMTP_URL: "smtp://h" })).toMatchObject({ mode: "smtp", blockedBy: "EMAIL_FROM" });
    expect(mailerState({ RESEND_API_KEY: "k", SMTP_URL: "smtp://h", EMAIL_FROM: "a@b.c" }).mode).toBe("resend");
  });

  it("only sends for real when the sender address is set", () => {
    const saved = { ...process.env };
    try {
      delete process.env.RESEND_API_KEY; delete process.env.EMAIL_FROM;
      process.env.SMTP_URL = `smtp://127.0.0.1:${port}`;
      expect(mailerState().blockedBy).toBe("EMAIL_FROM");
    } finally { process.env = saved; }
  });
});

describe("smtpMailer", () => {
  it("delivers the reset and confirmation emails through an SMTP server", async () => {
    const send = smtpMailer(`smtp://127.0.0.1:${port}`, "Nori <hello@nori.test>");
    await send({ to: "maya@example.com", ...resetEmail("https://nori.test/reset-password?token=abc123") });
    await send({ to: "maya@example.com", ...verifyEmail("https://nori.test/verify-email?token=xyz789") });
    expect(received).toHaveLength(2);
    const [reset, verify] = received.map(decoded);
    expect(reset).toContain("To: maya@example.com");
    expect(reset).toContain("Subject: Reset your Nori password");
    expect(reset).toContain("https://nori.test/reset-password?token=abc123");
    expect(verify).toContain("https://nori.test/verify-email?token=xyz789");
    expect(reset).toContain("From: Nori <hello@nori.test>");
  });

  it("fails loudly when the server is unreachable, so the caller can log it", async () => {
    const send = smtpMailer("smtp://127.0.0.1:9", "a@b.c");
    await expect(send({ to: "x@y.z", subject: "s", text: "t" })).rejects.toThrow();
  });

  it("is what defaultMailer returns when SMTP_URL and EMAIL_FROM are set", async () => {
    const saved = { ...process.env };
    try {
      delete process.env.RESEND_API_KEY;
      process.env.SMTP_URL = `smtp://127.0.0.1:${port}`; process.env.EMAIL_FROM = "hello@nori.test";
      const before = received.length;
      await defaultMailer()({ to: "q@example.com", subject: "hello", text: "body" });
      expect(received.length).toBe(before + 1);
    } finally { process.env = saved; }
  });
});
