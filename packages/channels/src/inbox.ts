import { and, desc, eq, gte, lt } from "drizzle-orm";
import { z } from "zod";
import {
  applications, getLLM, inboxMessages, jobs, withFallback,
  type ApplicationStatus, type ClassifiedEmail, type Db, type InboxKind, type RawEmail,
} from "@jobgraph/core";
import { ComposioNotConfiguredError, composioAvailable, executeTool } from "./composio.js";

// ---------- fetching ----------

type AnyRec = Record<string, unknown>;
const asRec = (v: unknown): AnyRec | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as AnyRec) : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length ? v : undefined);

/** Find the messages array wherever Composio nested it. */
function findMessages(data: unknown, depth = 0): AnyRec[] {
  if (depth > 4) return [];
  const rec = asRec(data);
  if (!rec) return [];
  if (Array.isArray(rec.messages)) return rec.messages.filter((m): m is AnyRec => !!asRec(m));
  for (const key of ["data", "response_data", "result"]) {
    const found = findMessages(rec[key], depth + 1);
    if (found.length) return found;
  }
  return [];
}

function b64urlDecode(s: string): string {
  try { return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"); } catch { return ""; }
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>|<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

/** Walk a Gmail API payload and return the best text body (plain first, then stripped html). */
function bodyFromPayload(payload: unknown): string | undefined {
  let plain = "", html = "";
  const walk = (part: unknown, depth = 0) => {
    const p = asRec(part);
    if (!p || depth > 8) return;
    const mime = str(p.mimeType) ?? "";
    const data = str(asRec(p.body)?.data);
    if (data) {
      if (mime.startsWith("text/plain")) plain += b64urlDecode(data);
      else if (mime.startsWith("text/html")) html += b64urlDecode(data);
      else if (!mime && !plain) plain += b64urlDecode(data);
    }
    if (Array.isArray(p.parts)) for (const c of p.parts) walk(c, depth + 1);
  };
  walk(payload);
  if (plain.trim()) return plain.trim();
  if (html.trim()) return htmlToText(html);
  return undefined;
}

function headerFromPayload(payload: unknown, name: string): string | undefined {
  const headers = asRec(payload)?.headers;
  if (!Array.isArray(headers)) return undefined;
  for (const h of headers) {
    const r = asRec(h);
    if (str(r?.name)?.toLowerCase() === name.toLowerCase()) return str(r?.value);
  }
  return undefined;
}

function parseDate(m: AnyRec): Date {
  const ts = m.messageTimestamp ?? m.internalDate ?? m.date ?? headerFromPayload(m.payload, "Date");
  if (typeof ts === "number" || (typeof ts === "string" && /^\d{10,13}$/.test(ts))) {
    const n = Number(ts);
    return new Date(n < 1e12 ? n * 1000 : n);
  }
  if (typeof ts === "string") { const d = new Date(ts); if (!isNaN(d.getTime())) return d; }
  return new Date();
}

/** Normalize one Composio Gmail message (snippet shape or payload shape) into a RawEmail. */
export function parseGmailMessage(m: AnyRec): RawEmail | null {
  const externalId = str(m.messageId) ?? str(m.message_id) ?? str(m.id);
  if (!externalId) return null;
  const preview = m.preview;
  const previewBody = typeof preview === "string" ? preview : str(asRec(preview)?.body);
  const text = str(m.messageText) ?? str(m.message_text) ?? bodyFromPayload(m.payload) ?? str(m.body) ?? previewBody ?? str(m.snippet) ?? "";
  return {
    externalId,
    from: str(m.sender) ?? str(m.from) ?? headerFromPayload(m.payload, "From") ?? "",
    subject: str(m.subject) ?? str(asRec(preview)?.subject) ?? headerFromPayload(m.payload, "Subject") ?? "(no subject)",
    text: /<\/?[a-z][\s\S]*>/i.test(text) ? htmlToText(text) : text,
    receivedAt: parseDate(m),
  };
}

export async function fetchRecentEmails(userId: string, opts: { sinceMinutes?: number; max?: number } = {}): Promise<RawEmail[]> {
  const sinceMinutes = opts.sinceMinutes ?? 1440;
  const max = opts.max ?? 25;
  const afterEpoch = Math.floor((Date.now() - sinceMinutes * 60_000) / 1000);
  const data = await executeTool(userId, "GMAIL_FETCH_EMAILS", {
    query: `after:${afterEpoch} -from:me`,
    max_results: max,
    include_payload: true,
    verbose: true,
  });
  const out: RawEmail[] = [];
  for (const m of findMessages(data)) {
    const e = parseGmailMessage(m);
    if (e) out.push(e);
  }
  return out;
}

// ---------- classification ----------

const CODE_CONTEXT = /(verification|security|one[- ]time|confirmation)\s*code|your code is|enter (the|this) code/i;
const INTERVIEW = /interview|schedule a call|availability/i;
const REJECTION = /unfortunately|not moving forward|other candidates|decided not to/i;
const OFFER = /offer letter|pleased to offer/i;
const CONFIRMATION = /thank you for applying|application (received|submitted)/i;
const NOREPLY = /no[-_.]?reply|do[-_.]?not[-_.]?reply|notifications?@|mailer-daemon|automated@/i;
const RECRUITER_HINT = /\b(role|position|opportunity|recruiter|recruiting|talent|hiring|candidate|company|team)\b/i;

/** Extract a 4 to 8 digit code, preferring digits right next to the word "code". */
export function extractCode(text: string): string | undefined {
  const near = [
    /code[^\d]{0,40}?(\d{4,8})\b/i,
    /\b(\d{4,8})\b\W{0,20}(?:is|as)\W{0,20}(?:your|the)\W{0,20}(?:\w+\s+){0,2}code/i,
    /code[^\d]{0,40}?\b(\d{3})[- ](\d{3})\b/i,
  ];
  for (const re of near) {
    const m = text.match(re);
    if (m) return m.slice(1).join("");
  }
  const all = [...text.matchAll(/\b\d{4,8}\b/g)].map((m) => m[0]);
  const nonYear = all.filter((d) => !/^(19|20)\d{2}$/.test(d));
  return nonYear[0] ?? all[0];
}

const MAIL_PROVIDERS = new Set(["gmail", "googlemail", "yahoo", "outlook", "hotmail", "live", "msn", "icloud", "me", "aol", "proton", "protonmail", "pm", "gmx", "mail", "zoho", "fastmail", "hey"]);
const ATS_DOMAINS = new Set(["greenhouse", "greenhouse-mail", "lever", "ashbyhq", "myworkday", "myworkdayjobs", "workday", "smartrecruiters", "workable", "icims", "jobvite", "bamboohr", "recruitee", "breezy", "teamtailor", "applytojob", "successfactors", "taleo", "rippling", "gem", "hire", "eightfold", "dover"]);
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "ac", "gov", "edu"]);

function capitalize(s: string) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

/** Guess the company from a From header. Mail providers yield undefined; ATS senders fall back to the display name. */
export function guessCompany(from: string): string | undefined {
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  const display = (m?.[1] ?? "").trim();
  const addr = (m?.[2] ?? from).trim();
  const domain = addr.split("@")[1]?.toLowerCase().replace(/[>\s].*$/, "");
  if (!domain) return undefined;
  const labels = domain.split(".");
  const tld = labels.length > 2 && SECOND_LEVEL.has(labels[labels.length - 2]) ? 3 : 2;
  const base = labels.length >= tld ? labels[labels.length - tld] : labels[0];
  if (MAIL_PROVIDERS.has(base)) return undefined;
  if (ATS_DOMAINS.has(base)) {
    const cleaned = display.replace(/\s+via\s+.*$/i, "").replace(/\b(recruiting|recruitment|careers|talent|hiring|jobs|team|notifications?|no-?reply)\b/gi, "").replace(/\s+/g, " ").trim();
    return cleaned || undefined;
  }
  return capitalize(base);
}

/** The sender's registrable domain label ("acme" for jobs@mail.acme.co.uk), lowercased, or "". */
export function senderBase(from: string): string {
  const addr = (from.match(/<([^>]+)>/)?.[1] ?? from).trim();
  const domain = addr.split("@")[1]?.toLowerCase().replace(/[>\s].*$/, "");
  if (!domain) return "";
  const labels = domain.split(".");
  const tld = labels.length > 2 && SECOND_LEVEL.has(labels[labels.length - 2]) ? 3 : 2;
  return labels.length >= tld ? labels[labels.length - tld] : labels[0];
}

/** Mail sent by an applicant-tracking system (greenhouse-mail.io, lever.co, ...). */
export function fromAts(from: string): boolean {
  return ATS_DOMAINS.has(senderBase(from));
}

/**
 * Whether this sender may speak for the company: its own domain, or an ATS whose display name names the company.
 * Anyone can write "Acme" in a subject line, so a status change (rejected, offer, interview) needs this.
 */
export function senderSpeaksFor(from: string, companyName: string): boolean {
  const company = norm(companyName);
  if (company.length < 2) return false;
  const base = norm(senderBase(from));
  if (base && !MAIL_PROVIDERS.has(base) && (base === company || (base.length >= 4 && (company.includes(base) || base.includes(company))))) return true;
  if (fromAts(from)) {
    const display = norm(from.match(/^\s*"?([^"<]*?)"?\s*</)?.[1] ?? "");
    return display.length >= 2 && display.includes(company);
  }
  return false;
}

/** A model-written draft reply comes from an email anyone could send: no links, and short. */
export function safeDraft(draft: string | null | undefined): string | undefined {
  const d = (draft ?? "").replace(/\bhttps?:\/\/\S+|\bwww\.\S+/gi, "").replace(/\s+\n/g, "\n").trim().slice(0, 600);
  return d || undefined;
}

export function classifyHeuristic(email: RawEmail): ClassifiedEmail {
  const hay = `${email.subject}\n${email.text}`;
  const companyGuess = guessCompany(email.from);
  const jobTitleGuess = hay.match(/(?:for|as) (?:the |an? )?([A-Z][\w/&+.-]*(?: [A-Za-z][\w/&+.-]*){0,5}?) (?:role|position)\b/)?.[1];
  const base: Pick<ClassifiedEmail, "companyGuess" | "jobTitleGuess"> = { companyGuess, jobTitleGuess };

  if (CODE_CONTEXT.test(hay)) {
    const code = extractCode(hay);
    if (code) return { kind: "verification_code", code, ...base };
  }
  const kind: InboxKind =
    OFFER.test(hay) ? "offer"
    : REJECTION.test(hay) ? "rejection"
    : INTERVIEW.test(hay) ? "interview"
    : CONFIRMATION.test(hay) ? "confirmation"
    : !NOREPLY.test(email.from) && RECRUITER_HINT.test(hay) ? "recruiter_reply"
    : "other";
  return { kind, ...base };
}

const classifySchema = z.object({
  kind: z.enum(["verification_code", "recruiter_reply", "interview", "rejection", "offer", "confirmation", "other"]),
  code: z.string().nullish(),
  companyGuess: z.string().nullish(),
  jobTitleGuess: z.string().nullish(),
  interviewAt: z.string().nullish().describe("ISO 8601 datetime if the email proposes a specific interview time"),
  draftReply: z.string().nullish().describe("A short, polite reply the candidate could send; only for recruiter_reply and interview"),
});

export async function classifyEmail(email: RawEmail): Promise<ClassifiedEmail> {
  const heuristic = () => classifyHeuristic(email);
  const { value } = await withFallback<ClassifiedEmail>(async () => {
    const out = await getLLM("bulk").json({
      name: "classify_email",
      system: "You classify emails in a job seeker's inbox. kind is one of: verification_code (an OTP or login/verification code from a job site), recruiter_reply (a human recruiter or hiring manager writing about a role), interview (scheduling or inviting to an interview or call), rejection, offer, confirmation (automatic application received), other. Extract the numeric code for verification_code emails. Never invent values; omit what the email does not state.",
      prompt: `From: ${email.from}\nSubject: ${email.subject}\n\n${email.text.slice(0, 6000)}`,
      schema: classifySchema,
      effort: "low",
      maxTokens: 1500,
    });
    const h = classifyHeuristic(email);
    const code = out.kind === "verification_code" ? (out.code ?? h.code ?? extractCode(`${email.subject}\n${email.text}`)) : undefined;
    if (out.kind === "verification_code" && !code) return h;
    return {
      kind: out.kind,
      code: code ?? undefined,
      companyGuess: out.companyGuess ?? h.companyGuess,
      jobTitleGuess: out.jobTitleGuess ?? h.jobTitleGuess,
      interviewAt: out.interviewAt ?? undefined,
      draftReply: safeDraft(out.draftReply),
    };
  }, heuristic, "classifyEmail", "bulk");
  return value;
}

// ---------- sync ----------

const norm = (s: string) => s.toLowerCase().replace(/\b(inc|llc|ltd|corp|corporation|co|company|gmbh)\b\.?/g, "").replace(/[^a-z0-9]/g, "");

/** Tracker progression. Only applications already submitted (or beyond) move; never backward. */
const STAGE_FOR_KIND: Partial<Record<InboxKind, ApplicationStatus>> = {
  recruiter_reply: "replied", interview: "interview", offer: "offer", rejection: "rejected",
};
const FORWARD_RANK: Partial<Record<ApplicationStatus, number>> = { submitted: 0, viewed: 1, replied: 2, interview: 3, offer: 4 };

export function nextStatus(current: ApplicationStatus, kind: InboxKind): ApplicationStatus | null {
  const target = STAGE_FOR_KIND[kind];
  if (!target) return null;
  const curRank = FORWARD_RANK[current];
  if (curRank === undefined) return null; // not submitted yet, or already rejected/failed/skipped
  if (target === "rejected") return current === "offer" ? null : "rejected";
  const tRank = FORWARD_RANK[target]!;
  return tRank > curRank ? target : null;
}

type AppRow = { id: string; status: ApplicationStatus; companyName: string; title: string; createdAt: Date };

function linkApplication(rows: AppRow[], email: RawEmail, c: ClassifiedEmail): AppRow | undefined {
  const hay = norm(`${email.subject} ${email.from}`);
  const guess = c.companyGuess ? norm(c.companyGuess) : "";
  const matches = (r: AppRow) => {
    const n = norm(r.companyName);
    if (n.length < 2) return false;
    return (guess && (n === guess || (guess.length >= 4 && (n.includes(guess) || guess.includes(n))))) || (n.length >= 3 && hay.includes(n));
  };
  const cands = rows.filter(matches);
  if (!cands.length) return undefined;
  const text = `${email.subject} ${email.text}`.toLowerCase();
  const byTitle = cands.find((r) => r.title && text.includes(r.title.toLowerCase()));
  return byTitle ?? cands.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
}

export type SyncDeps = {
  fetchEmails?: (userId: string, opts: { sinceMinutes: number; max: number }) => Promise<RawEmail[]>;
  classify?: (email: RawEmail) => Promise<ClassifiedEmail>;
  sinceMinutes?: number;
  max?: number;
};

export async function syncInbox(db: Db, userId: string, deps: SyncDeps = {}): Promise<{ imported: number }> {
  const fetchEmails = deps.fetchEmails ?? fetchRecentEmails;
  const classify = deps.classify ?? classifyEmail;
  const emails = await fetchEmails(userId, { sinceMinutes: deps.sinceMinutes ?? 4320, max: deps.max ?? 50 });
  if (!emails.length) return { imported: 0 };

  const existing = new Set(
    (await db.select({ externalId: inboxMessages.externalId }).from(inboxMessages).where(eq(inboxMessages.userId, userId)))
      .map((r) => r.externalId),
  );
  const appRows: AppRow[] = await db
    .select({ id: applications.id, status: applications.status, companyName: jobs.companyName, title: jobs.title, createdAt: applications.createdAt })
    .from(applications).innerJoin(jobs, eq(applications.jobId, jobs.id))
    .where(eq(applications.userId, userId));

  let imported = 0;
  for (const email of emails) {
    if (existing.has(email.externalId)) continue;
    const c = await classify(email);
    const app = linkApplication(appRows, email, c);
    // Only mail about the job search is kept. Everything else (bank, medical, personal) is recorded as an empty marker so
    // it is not read again on the next sync, and the marker is pruned after a week (pruneInbox).
    const keep = c.kind !== "other" || Boolean(app);
    const inserted = await db.insert(inboxMessages).values({
      userId, applicationId: app?.id ?? null, externalId: email.externalId,
      fromAddress: keep ? email.from : "", subject: keep ? email.subject : "", bodyText: keep ? email.text.slice(0, INBOX_BODY_MAX) : "",
      receivedAt: email.receivedAt,
      kind: c.kind, code: c.code ?? null, draftReply: keep ? c.draftReply ?? null : null, source: "composio_gmail",
    }).onConflictDoNothing().returning();
    if (!inserted.length) continue;
    imported++;
    existing.add(email.externalId);
    // The tracker only moves on mail the company (or its ATS) sent. A message that merely mentions the company stays
    // linked for the person to read, but cannot mark the application rejected or as an offer.
    if (app && senderSpeaksFor(email.from, app.companyName)) {
      const next = nextStatus(app.status, c.kind);
      if (next) {
        await db.update(applications).set({ status: next, updatedAt: new Date() }).where(eq(applications.id, app.id));
        app.status = next;
      }
    }
  }
  return { imported };
}

/** Longest stored body of a job email. */
export const INBOX_BODY_MAX = 20_000;

/** Drop the empty markers for non-job mail once they are older than the sync window. */
export async function pruneInbox(db: Db, olderThanDays = 7): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);
  const gone = await db.delete(inboxMessages)
    .where(and(eq(inboxMessages.kind, "other"), eq(inboxMessages.bodyText, ""), lt(inboxMessages.receivedAt, cutoff))).returning();
  return gone.length;
}

export type WaitOpts = { intervalMs?: number; sync?: (db: Db, userId: string) => Promise<{ imported: number }> };

/**
 * Poll the inbox until a fresh unread verification code arrives. Prefers a message mentioning `hint`
 * (company or site name); marks the returned message read. Returns null on timeout.
 */
export async function waitForVerificationCode(db: Db, userId: string, hint: string, timeoutMs = 180_000, opts: WaitOpts = {}): Promise<string | null> {
  const started = Date.now();
  const since = new Date(started - 5 * 60_000);
  const intervalMs = opts.intervalMs ?? 10_000;
  const sync = opts.sync ?? ((d, u) => syncInbox(d, u));
  const needle = hint.trim().toLowerCase();
  let warned = false;
  for (;;) {
    try {
      await sync(db, userId);
    } catch (err) {
      if (err instanceof ComposioNotConfiguredError || (!opts.sync && !composioAvailable())) {
        console.warn("[inbox] cannot read mail:", (err as Error).message);
        return null;
      }
      if (!warned) { console.warn("[inbox] sync failed, will retry:", (err as Error).message.slice(0, 200)); warned = true; }
    }
    const rows = await db.select().from(inboxMessages)
      .where(and(eq(inboxMessages.userId, userId), eq(inboxMessages.kind, "verification_code"), eq(inboxMessages.read, false), gte(inboxMessages.receivedAt, since)))
      .orderBy(desc(inboxMessages.receivedAt));
    const usable = rows.filter((r) => r.code);
    // The code is typed into a real application, so it must come from the site that asked for it: the sender or the
    // subject names it, or an ATS sent it. A newest-code fallback would type a code planted by anyone who emails you.
    const named = (r: (typeof usable)[number]) => !!needle && `${r.fromAddress} ${r.subject}`.toLowerCase().includes(needle);
    const pick = usable.find(named) ?? usable.find((r) => fromAts(r.fromAddress)) ?? (needle ? undefined : usable[0]);
    if (pick?.code) {
      await db.update(inboxMessages).set({ read: true }).where(eq(inboxMessages.id, pick.id));
      return pick.code;
    }
    if (Date.now() + intervalMs - started > timeoutMs) return null;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
