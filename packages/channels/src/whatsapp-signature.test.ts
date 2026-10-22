import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { WhatsAppChannel, verifyWhatsAppSignature } from "./whatsapp.js";

const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id: "wamid.1", from: "15550001111", type: "text", text: { body: "approve all" } }] } }] }] });
const sign = (raw: string, secret: string) => `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;

describe("WhatsApp webhook signature", () => {
  it("accepts only a body signed with the app secret", () => {
    expect(verifyWhatsAppSignature(body, sign(body, "s3cret"), "s3cret")).toBe(true);
    expect(verifyWhatsAppSignature(body, sign(body, "other"), "s3cret")).toBe(false);
    expect(verifyWhatsAppSignature(body + " ", sign(body, "s3cret"), "s3cret")).toBe(false);
    expect(verifyWhatsAppSignature(body, undefined, "s3cret")).toBe(false);
    expect(verifyWhatsAppSignature(body, "sha256=zz", "s3cret")).toBe(false);
  });
  it("fails closed when no secret is configured", () => {
    expect(verifyWhatsAppSignature(body, sign(body, ""), "")).toBe(false);
  });
  it("runs a replayed message id once", async () => {
    const ch = new WhatsAppChannel();
    const got: string[] = [];
    await ch.listen(async (m) => { got.push(m.text); });
    await ch.handleWebhook(JSON.parse(body));
    await ch.handleWebhook(JSON.parse(body));
    expect(got).toEqual(["approve all"]);
  });
});
