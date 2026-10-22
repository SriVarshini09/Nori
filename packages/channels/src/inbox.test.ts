import { beforeAll, describe, expect, it, vi } from "vitest";
import { applications, jobs, inboxMessages, openTestDb, setLLM, ensureDefaultUser, type Db, type RawEmail } from "@jobgraph/core";
import { eq } from "drizzle-orm";
import { classifyEmail, extractCode, guessCompany, nextStatus, parseGmailMessage, syncInbox, waitForVerificationCode } from "./inbox.js";

const mail = (over: Partial<RawEmail>): RawEmail => ({ externalId: "m1", from: "Recruiter <jane@acme.com>", subject: "", text: "", receivedAt: new Date(), ...over });

beforeAll(() => { setLLM({ provider: "none", model: "none", available: false, json: async () => { throw new Error("no"); }, text: async () => { throw new Error("no"); } }); });

describe("classifyEmail heuristics", () => {
  it("extracts verification codes", async () => {
    const r = await classifyEmail(mail({ from: "no-reply@greenhouse.io", subject: "Security code for your application", text: "Your verification code is 482913. It expires in 10 minutes. Sent 2026." }));
    expect(r).toMatchObject({ kind: "verification_code", code: "482913" });
  });
  it("prefers digits near the word code", () => {
    expect(extractCode("Order 99887766 placed. Enter this code: 4455 to continue")).toBe("4455");
    expect(extractCode("your code is 123-456")).toBe("123456");
  });
  it("does not call plain numbers codes", async () => {
    const r = await classifyEmail(mail({ from: "news@x.com", subject: "Weekly digest", text: "We have 12345 readers." }));
    expect(r.kind).toBe("other");
  });
  it("interview", async () => expect((await classifyEmail(mail({ subject: "Next steps", text: "Could you share your availability for an interview?" }))).kind).toBe("interview"));
  it("rejection beats interview wording", async () => expect((await classifyEmail(mail({ subject: "Update", text: "Unfortunately we are not moving forward after the interview." }))).kind).toBe("rejection"));
  it("offer", async () => expect((await classifyEmail(mail({ subject: "Offer letter", text: "We are pleased to offer you the role." }))).kind).toBe("offer"));
  it("confirmation", async () => expect((await classifyEmail(mail({ from: "no-reply@lever.co", subject: "Thank you for applying", text: "We received it." }))).kind).toBe("confirmation"));
  it("recruiter reply from a person, not noreply", async () => {
    const r = await classifyEmail(mail({ subject: "Quick question", text: "I saw your profile and have a role on our team you might like." }));
    expect(r).toMatchObject({ kind: "recruiter_reply", companyGuess: "Acme" });
    expect((await classifyEmail(mail({ from: "no-reply@acme.com", subject: "Hi", text: "A role on our team." }))).kind).toBe("other");
  });
  it("guesses company from sender domain", () => {
    expect(guessCompany("Jane <jane@gmail.com>")).toBeUndefined();
    expect(guessCompany("jobs@mail.stripe.com")).toBe("Stripe");
    expect(guessCompany("Acme Recruiting via Greenhouse <no-reply@us.greenhouse-mail.io>")).toBe("Acme");
    expect(guessCompany("hr@foo.co.uk")).toBe("Foo");
  });
  it("only moves status forward from submitted", () => {
    expect(nextStatus("submitted", "interview")).toBe("interview");
    expect(nextStatus("interview", "recruiter_reply")).toBeNull();
    expect(nextStatus("filling", "rejection")).toBeNull();
    expect(nextStatus("offer", "rejection")).toBeNull();
    expect(nextStatus("replied", "rejection")).toBe("rejected");
  });
});

describe("gmail parsing", () => {
  it("handles snippet and payload shapes", () => {
    const a = parseGmailMessage({ messageId: "a1", sender: "x@y.com", subject: "S", messageText: "body", messageTimestamp: "2026-10-01T10:00:00Z" });
    expect(a).toMatchObject({ externalId: "a1", from: "x@y.com", text: "body" });
    const data = Buffer.from("hello <b>world</b>").toString("base64url");
    const b = parseGmailMessage({ id: "b1", internalDate: "1760000000000", payload: { headers: [{ name: "From", value: "z@w.com" }, { name: "Subject", value: "Hi" }], parts: [{ mimeType: "text/html", body: { data } }] } });
    expect(b).toMatchObject({ externalId: "b1", from: "z@w.com", subject: "Hi", text: "hello world" });
    expect(parseGmailMessage({ preview: { subject: "P", body: "pb" }, messageId: "c" })?.text).toBe("pb");
    expect(parseGmailMessage({})).toBeNull();
  });
});

describe("syncInbox", () => {
  let db: Db;
  async function seed() {
    db = await openTestDb();
    const user = await ensureDefaultUser(db);
    const [job] = await db.insert(jobs).values({ companyName: "Acme Inc", atsType: "greenhouse", externalId: "1", title: "Frontend Engineer", descriptionText: "x", applyUrl: "https://x" }).returning();
    const [app] = await db.insert(applications).values({ userId: user.id, jobId: job.id, status: "submitted" }).returning();
    return { user, app };
  }

  it("links by company name, advances status, and is idempotent", async () => {
    const { user, app } = await seed();
    const fetchEmails = vi.fn(async () => [
      mail({ externalId: "e1", from: "Jane <jane@acme.com>", subject: "Interview with Acme", text: "Please share your availability for an interview." }),
      mail({ externalId: "e2", from: "news@unrelated.org", subject: "Digest", text: "nothing" }),
    ]);
    const r1 = await syncInbox(db, user.id, { fetchEmails });
    expect(r1.imported).toBe(2);
    const rows = await db.select().from(inboxMessages).where(eq(inboxMessages.userId, user.id));
    expect(rows.find((r) => r.externalId === "e1")).toMatchObject({ kind: "interview", applicationId: app.id });
    expect(rows.find((r) => r.externalId === "e2")?.applicationId).toBeNull();
    // Mail that is not about the job search is not kept: only an empty marker so it is not read again.
    expect(rows.find((r) => r.externalId === "e2")).toMatchObject({ kind: "other", fromAddress: "", subject: "", bodyText: "" });
    const [a] = await db.select().from(applications).where(eq(applications.id, app.id));
    expect(a.status).toBe("interview");
    expect((await syncInbox(db, user.id, { fetchEmails })).imported).toBe(0);
  });

  it("never moves backward", async () => {
    const { user, app } = await seed();
    await db.update(applications).set({ status: "interview" }).where(eq(applications.id, app.id));
    await syncInbox(db, user.id, { fetchEmails: async () => [mail({ externalId: "r1", from: "jane@acme.com", subject: "Hi", text: "I have a role for you" })] });
    const [a] = await db.select().from(applications).where(eq(applications.id, app.id));
    expect(a.status).toBe("interview");
  });

  it("waitForVerificationCode returns the newest unread code and marks it read", async () => {
    const { user } = await seed();
    let calls = 0;
    const sync = async () => {
      if (++calls === 2) {
        await syncInbox(db, user.id, { fetchEmails: async () => [mail({ externalId: "c1", from: "no-reply@acme.com", subject: "Acme verification code", text: "Your verification code is 482913" })] });
      }
      return { imported: 0 };
    };
    const code = await waitForVerificationCode(db, user.id, "acme", 5000, { intervalMs: 5, sync });
    expect(code).toBe("482913");
    const [row] = await db.select().from(inboxMessages).where(eq(inboxMessages.externalId, "c1"));
    expect(row.read).toBe(true);
    expect(await waitForVerificationCode(db, user.id, "acme", 30, { intervalMs: 5, sync: async () => ({ imported: 0 }) })).toBeNull();
  });
});

describe("mail from someone who is not the company", () => {
  it("cannot change an application's status, plant a code, or put a link in a draft", async () => {
    const { senderSpeaksFor, safeDraft, fromAts } = await import("./inbox.js");
    expect(senderSpeaksFor("Jane <jane@acme.com>", "Acme Inc")).toBe(true);
    expect(senderSpeaksFor("Acme Recruiting <no-reply@greenhouse-mail.io>", "Acme")).toBe(true);
    expect(senderSpeaksFor("Acme HR <acme.hr.team@gmail.com>", "Acme")).toBe(false);
    expect(senderSpeaksFor("Unfortunately <news@phish.example>", "Acme")).toBe(false);
    expect(fromAts("Lever <no-reply@hire.lever.co>")).toBe(true);
    expect(safeDraft("Thanks! Book here: https://evil.example/x and talk soon")).toBe("Thanks! Book here:  and talk soon");
  });
});
