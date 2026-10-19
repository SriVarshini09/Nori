import type { OutboundMessage } from "../contracts.js";
import type { ApplicationStatus, CompanyResearch, InboxKind, PendingQuestion, Receipt, ResumeChange } from "../db/schema.js";
import type { PendingRef } from "./pending.js";

/**
 * Every message the agent sends, in plain everyday language. Builders are pure so the loop, the chat
 * handler and tests all render the same text.
 */
type AppLike = { id: string; status: ApplicationStatus; receipt?: Receipt | null; pendingQuestions?: PendingQuestion[]; error?: string | null };
type JobLike = { id?: string; title: string; companyName: string; location?: string | null };
type ResumeLike = { changes: ResumeChange[]; atsScore?: number | null; keywordCoverage?: number | null; pdfPath?: string | null; version?: number } | null | undefined;

export const agentWebUrl = () => (process.env.WEB_URL ?? "http://localhost:3000").replace(/\/$/, "");
export const appLink = (id: string, base = agentWebUrl()) => `${base}/applications/${id}`;
const pct = (s: number) => `${Math.round(s * 100)}%`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const at = (job: JobLike) => `${job.title} at ${job.companyName}`;

export type ReviewOptions = { ref: number; webUrl?: string; attach?: boolean };

/**
 * A chat message plus its long form. Chat (Telegram, WhatsApp, console) gets `text`: at most four short lines
 * plus numbered references, so it reads on a phone. The web activity feed keeps `long` in agent_events.data.
 */
export type ChatMessage = OutboundMessage & { long?: string };
/** Split a ChatMessage into what is sent and the long form kept for the timeline. */
export function splitLong(msg: ChatMessage): { out: OutboundMessage; long: string } {
  const { long, ...out } = msg;
  return { out, long: long ?? out.text };
}

/** Resume or form ready for the user's go-ahead. */
export function reviewRequest(application: AppLike, job: JobLike, resume: ResumeLike, opts: ReviewOptions): ChatMessage {
  const link = appLink(application.id, opts.webUrl);
  const n = opts.ref;
  if (application.status === "form_review") {
    const fields = application.receipt?.fields.length ?? 0;
    const written = Object.keys(application.receipt?.autoAnswers ?? {}).length;
    return {
      text: [
        `Application filled for ${at(job)}.`,
        `${plural(fields, "field")}${written ? `, ${written} written by me` : ""}. Nothing is sent until you say so.`,
        `Reply 'approve ${n}' to submit or 'skip ${n}'.`,
        link,
      ].join("\n"),
      long: `Application filled for ${at(job)}. ${plural(fields, "field")}${written ? `, ${written} written by me from your graph` : ""}. ` +
        `Nothing is sent until you say so. Reply 'approve ${n}' to submit or 'skip ${n}'. Open: ${link}`,
    };
  }
  const changes = resume?.changes ?? [];
  const traced = changes.filter((c) => c.nodeIds?.length).length;
  const trace = !changes.length ? "no wording changes needed" : traced === changes.length ? "all traced to your graph" : `${traced} of ${changes.length} traced to your graph`;
  const parts = [`${plural(changes.length, "change")}`, resume?.atsScore != null ? `ATS ${resume.atsScore}` : null, trace].filter(Boolean);
  const attachments = opts.attach && resume?.pdfPath ? [{ path: resume.pdfPath, filename: `resume-v${resume.version ?? 1}.pdf` }] : undefined;
  return {
    text: [`Resume ready for ${at(job)}.`, `${parts.join(", ")}.`, `Reply 'approve ${n}' or 'skip ${n}'.`, link].join("\n"),
    long: `Resume ready for ${at(job)}. ${parts.join(", ")}. Reply 'approve ${n}' or 'skip ${n}'. Open: ${link}`,
    attachments,
  };
}

export function submittedNote(application: AppLike, job: JobLike): OutboundMessage {
  if (application.receipt?.dryRun) {
    return { text: `Filled ${at(job)} as a dry run; nothing was sent because real submits are off. Open: ${appLink(application.id)}` };
  }
  return { text: `Submitted ${at(job)}. I'll watch your inbox and tell you when they reply.` };
}

const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

export function needsUserNote(application: AppLike, job: JobLike, opts: { ref?: number; webUrl?: string } = {}): ChatMessage {
  const qs = application.pendingQuestions ?? [];
  const link = appLink(application.id, opts.webUrl);
  const long = [`${at(job)} has ${plural(qs.length, "question")} I can't answer from your profile:`];
  qs.slice(0, 8).forEach((q, i) => long.push(`${i + 1}) ${q.label}${q.options?.length ? ` (${q.options.slice(0, 5).join(" / ")})` : ""}`));
  long.push(`Answer them here: ${link}${opts.ref ? ` or reply 'skip ${opts.ref}' to drop it.` : ""}`);
  const short = [`${at(job)} has ${plural(qs.length, "question")} I can't answer from your profile:`];
  qs.slice(0, 5).forEach((q, i) => short.push(`${i + 1}) ${clip(q.label, 70)}`));
  if (qs.length > 5) short.push(`(+${qs.length - 5} more)`);
  short.push(`Answer here: ${link}`);
  if (opts.ref) short.push(`Or reply 'skip ${opts.ref}'.`);
  return { text: short.join("\n"), long: long.join("\n") };
}

export type InboxLike = { kind: InboxKind; fromAddress: string; subject: string; draftReply?: string | null; applicationId?: string | null };

export function replyNote(msg: InboxLike, job?: JobLike | null): OutboundMessage {
  const who = job ? job.companyName : msg.fromAddress.replace(/<.*>/, "").trim() || msg.fromAddress;
  const about = job ? ` about ${job.title}` : "";
  const head: Record<InboxKind, string> = {
    interview: `Interview request from ${who}${about}`,
    offer: `Offer from ${who}${about}. Congratulations`,
    rejection: `${who} passed${about}. On to the next one`,
    recruiter_reply: `${who} replied${about}`,
    confirmation: `${who} confirmed they received your application${about}`,
    verification_code: `Verification code from ${who}`,
    other: `New email from ${who}`,
  };
  const lines = [`${head[msg.kind]}: "${msg.subject}"`];
  if (msg.draftReply) lines.push(`I drafted a reply:\n${msg.draftReply}`);
  if (msg.applicationId) lines.push(`Open: ${appLink(msg.applicationId)}`);
  return { text: lines.join("\n") };
}

export type BriefSummary = {
  discovered: number;
  scored: number;
  queued: number;
  submitted: number;
  skipped: number;
  topMatches: { title: string; company: string; score: number }[];
  waiting: PendingRef[];
};

const WAIT_LABEL: Partial<Record<ApplicationStatus, string>> = {
  resume_review: "resume to approve", form_review: "application to approve before sending", needs_user: "questions to answer",
};
const WAIT_SHORT: Partial<Record<ApplicationStatus, string>> = { resume_review: "resume", form_review: "send?", needs_user: "questions" };

export function morningBrief(s: BriefSummary): ChatMessage {
  const counts = `${plural(s.discovered, "new job")}, ${s.queued} started, ${s.submitted} submitted${s.skipped ? `, ${s.skipped} skipped` : ""}`;
  const short = [`Good morning. Since yesterday: ${counts}.`];
  const best = s.topMatches[0];
  if (best) short.push(`Best new: ${best.title} at ${best.company} (${pct(best.score)})`);
  if (s.waiting.length) {
    short.push("Waiting on you:");
    for (const w of s.waiting.slice(0, 9)) short.push(`${w.n}. ${clip(`${w.title} at ${w.company}`, 60)}: ${WAIT_SHORT[w.status] ?? w.status}`);
    short.push(`Reply 'approve ${s.waiting[0].n}' or 'skip ${s.waiting[0].n}'.`);
  } else {
    short.push("Nothing is waiting on you.");
  }

  const lines = ["Good morning. Since yesterday:"];
  lines.push(`${plural(s.discovered, "new job")} found, ${s.scored} scored, ${s.queued} started, ${s.submitted} submitted${s.skipped ? `, ${s.skipped} skipped as not a fit` : ""}.`);
  if (s.topMatches.length) {
    lines.push("", "Best new matches:");
    for (const m of s.topMatches.slice(0, 3)) lines.push(`- ${m.title} at ${m.company} (${pct(m.score)})`);
  }
  if (s.waiting.length) {
    lines.push("", "Waiting on you:");
    for (const w of s.waiting) lines.push(`${w.n}. ${w.title} at ${w.company}: ${WAIT_LABEL[w.status] ?? w.status}`);
    lines.push(`Reply 'approve ${s.waiting[0].n}' or 'skip ${s.waiting[0].n}'.`);
  } else {
    lines.push("", "Nothing is waiting on you.");
  }
  return { text: short.join("\n"), long: lines.join("\n") };
}

export type WeeklyStats = {
  started: number;
  submitted: number;
  replies: number;
  interviews: number;
  offers: number;
  rejections: number;
  skipped: number;
  topSkipReasons: { reason: string; count: number }[];
};

export function weeklySummary(w: WeeklyStats): OutboundMessage {
  const lines = ["Your week in job search:"];
  lines.push(`${w.started} started, ${w.submitted} submitted, ${plural(w.replies, "reply", "replies")}, ${plural(w.interviews, "interview")}, ${plural(w.offers, "offer")}, ${plural(w.rejections, "rejection")}.`);
  if (w.skipped) {
    lines.push(`I passed on ${plural(w.skipped, "job")}${w.topSkipReasons.length ? `, mostly: ${w.topSkipReasons.slice(0, 3).map((r) => `${r.reason.toLowerCase()} (${r.count})`).join("; ")}` : ""}.`);
  }
  if (!w.started && !w.submitted) lines.push("Quiet week. Say 'set daily cap 3' to let me apply more, or 'find <role>' to widen the search.");
  return { text: lines.join("\n") };
}

// ---------- chat tool results ----------

export const HELP_TEXT = [
  "Commands:",
  "find <what you want>  e.g. find senior frontend roles, remote",
  "apply <n>  tailor a resume for shortlist item n",
  "approve <n> / skip <n>  act on item n waiting for you (or 'skip the Stripe one, apply to the rest')",
  "approve resume / approve form  pass the latest review",
  "status  what is in flight",
  "missing <n>  skills the job wants that your graph lacks",
  "research <n>  company research with sources",
  "set daily cap 3 / set min score 70 / auto-approve on / review before submit off",
  "fact: <text>  or any sentence starting with \"I \" to add to your career graph",
].join("\n");

export function shortlistMessage(items: { job: JobLike; score: number | null }[]): OutboundMessage {
  const lines = items.map((r, i) => `${i + 1}. ${r.job.title} - ${r.job.companyName} (${r.score == null ? "n/a" : pct(r.score)})${r.job.location ? `, ${r.job.location}` : ""}`);
  return { text: `${lines.join("\n")}\n\nReply "apply <n>", "missing <n>" or "research <n>".` };
}

export function noJobsNote(query: string): OutboundMessage {
  return { text: `No jobs found for "${query}".` };
}

export function startedNote(job: JobLike): OutboundMessage {
  return { text: `Started: ${at(job)} (queued). I'll send the tailored resume when it's ready.` };
}

export function approvedNote(items: { job: JobLike; stage: "resume" | "form" | "other"; status?: string }[]): OutboundMessage {
  if (!items.length) return { text: "Nothing is waiting for approval." };
  return {
    text: items.map(({ job, stage, status }) =>
      stage === "resume" ? `Approved the resume for ${at(job)}. Filling the application now.`
        : stage === "form" ? `Approved ${at(job)}. Submitting now (only if real submits are on).`
        : `${at(job)} is ${status ?? "not waiting"}; nothing to approve.`).join("\n"),
  };
}

export function skippedNote(jobs: JobLike[]): OutboundMessage {
  if (!jobs.length) return { text: "Nothing to skip." };
  return { text: `Skipped ${jobs.map(at).join(", ")}. I won't apply there.` };
}

export function unknownRefNote(ref: string, pending: PendingRef[]): OutboundMessage {
  const list = pending.length ? ` Waiting now: ${pending.map((p) => `${p.n} ${p.company}`).join(", ")}.` : " Nothing is waiting on you right now.";
  return { text: `I couldn't match "${ref}".${list}` };
}

export function statusMessage(counts: Record<string, number>, inflight: { job: JobLike; label: string; ref?: number }[]): OutboundMessage {
  const entries = Object.entries(counts);
  if (!entries.length) return { text: "No applications yet." };
  const lines = [entries.map(([s, n]) => `${s}: ${n}`).join(", ")];
  for (const a of inflight.slice(0, 10)) lines.push(`- ${a.ref ? `${a.ref}. ` : ""}${at(a.job)}: ${a.label}`);
  return { text: lines.join("\n") };
}

export function researchNote(companyName: string, r: CompanyResearch): OutboundMessage {
  const facts = [r.stage && `Stage: ${r.stage}`, r.funding && `Funding: ${r.funding}`, r.headcount && `Headcount: ${r.headcount}`,
    r.sponsorshipSignals && `Sponsorship: ${r.sponsorshipSignals}`, r.interviewProcess && `Interviews: ${r.interviewProcess}`].filter(Boolean) as string[];
  const cites = [...new Set(r.citations.map((c) => c.url))].slice(0, 5).map((u, i) => `[${i + 1}] ${u}`);
  return { text: [`${companyName}: ${r.summary}`, ...facts, ...(cites.length ? ["Sources:", ...cites] : [])].join("\n") };
}

export function gapsNote(job: JobLike, gaps: { requirement: string; required: boolean }[]): OutboundMessage {
  if (!gaps.length) return { text: `Your graph covers every listed requirement for ${at(job)}.` };
  return { text: `Missing for ${at(job)}:\n${gaps.map((g) => `- ${g.requirement}${g.required ? " (required)" : ""}`).join("\n")}\nIf you have these, tell me with "I ..." and I'll add them.` };
}

export function factNote(res: { nodesCreated: number; summary: string }): OutboundMessage {
  return { text: res.nodesCreated ? `Added to your graph: ${res.summary}` : res.summary || "I could not find anything to add from that." };
}

export function settingNote(label: string, value: string): OutboundMessage {
  return { text: `Done: ${label} is now ${value}.` };
}

export function noItemNote(n: number): OutboundMessage {
  return { text: `No item ${n} in your last shortlist. Send "find <what you want>" first.` };
}

/** Join several tool results into one reply. */
export function combine(msgs: OutboundMessage[]): OutboundMessage {
  const attachments = msgs.flatMap((m) => m.attachments ?? []);
  return { text: msgs.map((m) => m.text).filter(Boolean).join("\n\n"), attachments: attachments.length ? attachments : undefined };
}
