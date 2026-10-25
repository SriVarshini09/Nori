import { createHmac, timingSafeEqual } from "node:crypto";
import type { ChannelAdapter, InboundMessage, OutboundMessage } from "@jobgraph/core";
import { chunkText } from "./telegram.js";

/**
 * Stage 8: Two-way Twilio SMS channel adapter.
 *
 * Uses Twilio's REST Messages API (zero external SDK required) and validates inbound
 * webhook signatures (`X-Twilio-Signature`) using HMAC-SHA1 per Twilio's specification.
 */

export function twilioConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID?.trim() &&
    process.env.TWILIO_AUTH_TOKEN?.trim() &&
    (process.env.TWILIO_FROM_NUMBER?.trim() || process.env.TWILIO_MESSAGING_SERVICE_SID?.trim()),
  );
}

/**
 * Verify Twilio's `X-Twilio-Signature` header:
 * Concatenate the full webhook URL with sorted POST parameters (key + value), HMAC-SHA1 with TWILIO_AUTH_TOKEN, base64.
 */
export function verifyTwilioSignature(
  fullUrl: string,
  params: Record<string, string>,
  signatureHeader: string | undefined,
  authToken = process.env.TWILIO_AUTH_TOKEN,
): boolean {
  if (!authToken || !signatureHeader) return false;
  const sortedKeys = Object.keys(params).sort();
  let data = fullUrl;
  for (const k of sortedKeys) data += k + (params[k] ?? "");
  const expected = createHmac("sha1", authToken).update(data, "utf8").digest("base64");
  try {
    const a = Buffer.from(signatureHeader, "utf8");
    const b = Buffer.from(expected, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function parseTwilioWebhook(params: Record<string, string>): InboundMessage | null {
  const from = params.From?.trim();
  const body = params.Body?.trim();
  const sid = params.MessageSid?.trim();
  if (!from || !body) return null;
  return {
    channel: "sms",
    address: from,
    text: body,
    externalId: sid,
    meta: { provider: "twilio_sms", from },
  };
}

export class TwilioSmsChannel implements ChannelAdapter {
  kind = "sms" as const;

  get available(): boolean {
    return twilioConfigured();
  }

  async send(address: string, msg: OutboundMessage): Promise<void> {
    await sendTwilioSms(address, msg.text);
  }

  async listen(_handler: (msg: InboundMessage) => Promise<void>): Promise<() => void> {
    return () => {};
  }
}

export async function sendTwilioSms(to: string, text: string): Promise<{ sid?: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const from = process.env.TWILIO_FROM_NUMBER?.trim();
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim();
  if (!sid || !token || (!from && !messagingServiceSid)) {
    throw new Error("Twilio SMS is not configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER)");
  }

  const chunks = chunkText(text, 1500);
  let lastSid: string | undefined;
  for (const chunk of chunks) {
    const body = new URLSearchParams({ To: to, Body: chunk });
    if (messagingServiceSid) body.set("MessagingServiceSid", messagingServiceSid);
    else if (from) body.set("From", from);

    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Twilio SMS failed: ${res.status}`);
    const data = (await res.json()) as { sid?: string };
    lastSid = data.sid;
  }
  return { sid: lastSid };
}
