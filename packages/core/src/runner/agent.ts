import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { applications, channels, conversations, jobs, profiles, resumes, type ApplicationStatus } from "../db/schema.js";
import type { ChannelKind, InboundMessage, OutboundMessage } from "../contracts.js";
import { getLLM, withUserLLM } from "../llm/index.js";
import { discoverJobs } from "../feeds/discover.js";
import { ensureRequirements } from "../feeds/requirements.js";
import { addFact } from "../graph/facts.js";
import { skillGaps } from "../graph/query.js";
import { researchCompany } from "../research/company.js";
import { logAgentEvent } from "../agent/events.js";
import { loadPending, resolveRef, type PendingRef } from "../agent/pending.js";
import * as N from "../agent/notify.js";
import { findAndRank } from "./jobs.js";
import {
  approveForm, approveResume, createApplication, runApplication, skipApplication, ACTIVE_STATUSES, type Application, type RunnerDeps,
} from "./runner.js";

export const SETTING_KEYS = ["daily_cap", "min_score", "auto_approve", "review_before_submit"] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];
export const TOOLS = ["find_jobs", "apply", "approve", "skip", "status", "research", "gaps", "add_fact", "set_setting", "help"] as const;

/** One tool call. refs are pending-list numbers ("2"), company names ("Stripe"), or "rest" / "all". */
export type Action =
  | { tool: "find_jobs"; query: string }
  | { tool: "apply"; refs: string[] }
  | { tool: "approve"; refs: string[]; what?: "resume" | "form" }
  | { tool: "skip"; refs: string[] }
  | { tool: "status" }
  | { tool: "research"; ref: string }
  | { tool: "gaps"; ref: string }
  | { tool: "add_fact"; text: string }
  | { tool: "set_setting"; key: SettingKey; value: string }
  | { tool: "help" };

export type Intent =
  | { kind: "find"; objective: string }
  | { kind: "apply"; n: number }
  | { kind: "status" }
  | { kind: "approve"; n?: number; what?: "resume" | "form" }
  | { kind: "skip"; n: number }
  | { kind: "missing"; n: number }
  | { kind: "research"; n: number }
  | { kind: "fact"; text: string }
  | { kind: "set"; key: SettingKey; value: string }
  | { kind: "act"; actions: Action[] }
  | { kind: "help" };

const REST_RE = /^(?:the\s+)?(?:rest|others|other ones?|remaining(?: ones)?|everything else|all the rest)$/i;
const ALL_RE = /^(?:all|all of them|them all|everything|both|both of them|every one)$/i;

/** "skip the Stripe one, apply to the rest" -> [skip Stripe, approve rest]. Null unless every clause parses. */
function parseCompound(text: string): Action[] | null {
  const clauses = text.toLowerCase().replace(/[.!?]+$/, "").split(/\s*(?:,|;|\band then\b|\bthen\b|\band\b|&)\s*/).map((c) => c.trim()).filter(Boolean);
  if (!clauses.length) return null;
  const out: Action[] = [];
  let verb: "skip" | "approve" | null = null;
  for (const c of clauses) {
    const m = /^(?:please\s+)?(skip|pass on|drop|ignore|reject|approve|apply(?:\s+to)?|go ahead with|submit|send)\b\s*(.*)$/.exec(c);
    let target: string;
    if (m) {
      verb = /^(skip|pass on|drop|ignore|reject)$/.test(m[1]) ? "skip" : "approve";
      target = m[2].trim();
    } else if (verb) {
      target = c;
    } else {
      return null;
    }
    target = target.replace(/^(?:the|for)\s+/, "").replace(/\s+(?:one|ones|job|role|application)$/, "").replace(/^#/, "").trim();
    if (!target) return null;
    const ref = REST_RE.test(target) ? "rest" : ALL_RE.test(target) ? "all" : target;
    const last = out[out.length - 1];
    if (last && last.tool === verb) last.refs.push(ref);
    else out.push({ tool: verb, refs: [ref] } as Action);
  }
  return out;
}

function parseSetting(t: string): { key: SettingKey; value: string } | null {
  let m: RegExpMatchArray | null;
  if ((m = /^(?:set\s+)?(?:my\s+)?(?:daily\s+)?(?:application\s+)?cap\s+(?:to\s+|=\s*)?(\d+)(?:\s+a day|\s+per day)?$/.exec(t))) return { key: "daily_cap", value: m[1] };
  if ((m = /^(?:set\s+)?(?:my\s+)?min(?:imum)?\s+(?:match\s+)?score\s+(?:to\s+|=\s*)?(\d+(?:\.\d+)?)\s*%?$/.exec(t))) return { key: "min_score", value: m[1] };
  if ((m = /^(?:turn\s+|set\s+)?auto[- ]?approv(?:e|al)\s+(?:to\s+)?(on|off|true|false|yes|no)$/.exec(t)) || (m = /^turn\s+(on|off)\s+auto[- ]?approv(?:e|al)$/.exec(t))) return { key: "auto_approve", value: m[1] };
  if ((m = /^(?:turn\s+|set\s+)?review before submit(?:ting)?\s+(?:to\s+)?(on|off|true|false|yes|no)$/.exec(t)) || (m = /^turn\s+(on|off)\s+review before submit(?:ting)?$/.exec(t))) return { key: "review_before_submit", value: m[1] };
  return null;
}

/** Plain-text command parser. Returns null when nothing matches (the LLM gets a turn). */
export function parseIntent(raw: string): Intent | null {
  const text = raw.trim();
  const t = text.toLowerCase().replace(/[.!?]+$/, "");
  let m: RegExpMatchArray | null;
  if ((m = /^(?:find|search|look for)\s+(.+)$/i.exec(text))) return { kind: "find", objective: m[1].trim() };
  if ((m = /^apply(?:\s+to)?\s+#?(\d+)$/.exec(t))) return { kind: "apply", n: Number(m[1]) };
  if (/^(status|what'?s up|progress|what (did|have) you (do|done)( today| so far)?\??|(today'?s )?(summary|brief|update)|anything (new|waiting)\??)$/.test(t)) return { kind: "status" };
  if ((m = /^approve(?:\s+#?(\d+))?(?:\s+(resume|form))?$/.exec(t))) {
    return { kind: "approve", n: m[1] ? Number(m[1]) : undefined, what: m[2] as "resume" | "form" | undefined };
  }
  if ((m = /^skip\s+#?(\d+)$/.exec(t))) return { kind: "skip", n: Number(m[1]) };
  if ((m = /^(?:missing|gaps?)\s+#?(\d+)$/.exec(t))) return { kind: "missing", n: Number(m[1]) };
  if ((m = /^research\s+#?(\d+)$/.exec(t))) return { kind: "research", n: Number(m[1]) };
  if ((m = /^fact:\s*(.+)$/is.exec(text))) return { kind: "fact", text: m[1].trim() };
  const setting = parseSetting(t);
  if (setting) return { kind: "set", ...setting };
  if (/^(skip|pass on|drop|approve|apply|go ahead|submit|please)\b/.test(t)) {
    const actions = parseCompound(text);
    if (actions) return { kind: "act", actions };
  }
  if (/^i\s/i.test(text)) return { kind: "fact", text };
  if (/^(help|\?|hi|hello|start|\/start|\/help)$/.test(t)) return { kind: "help" };
  return null;
}

export function intentToActions(i: Intent): Action[] {
  switch (i.kind) {
    case "find": return [{ tool: "find_jobs", query: i.objective }];
    case "apply": return [{ tool: "apply", refs: [String(i.n)] }];
    case "status": return [{ tool: "status" }];
    case "approve": return [{ tool: "approve", refs: i.n ? [String(i.n)] : [], what: i.what }];
    case "skip": return [{ tool: "skip", refs: [String(i.n)] }];
    case "missing": return [{ tool: "gaps", ref: String(i.n) }];
    case "research": return [{ tool: "research", ref: String(i.n) }];
    case "fact": return [{ tool: "add_fact", text: i.text }];
    case "set": return [{ tool: "set_setting", key: i.key, value: i.value }];
    case "act": return i.actions;
    default: return [{ tool: "help" }];
  }
}

// ---------- LLM tool calling ----------

const ToolCallsSchema = z.object({
  calls: z.array(z.object({
    tool: z.enum(TOOLS),
    refs: z.array(z.string()).nullable().optional(),
    query: z.string().nullable().optional(),
    text: z.string().nullable().optional(),
    key: z.enum(SETTING_KEYS).nullable().optional(),
    value: z.string().nullable().optional(),
    what: z.enum(["resume", "form"]).nullable().optional(),
  })).max(8),
  reply: z.string().nullable().optional(),
});
export type ToolCalls = z.infer<typeof ToolCallsSchema>;

const TOOL_SYSTEM = `You are a job-search agent that works for the user every day and talks to them over chat.
Turn the user's latest message into tool calls. Tools:
- find_jobs {query}: search for new jobs.
- apply {refs}: start an application for items from the LAST SHORTLIST (refs = shortlist numbers or company names).
- approve {refs, what?}: approve items WAITING ON THE USER (refs = pending numbers, company names, "rest" for every waiting item not named elsewhere in this message, or "all"). Approving a resume continues to the form; approving a filled form submits it. Phrases like "apply to the rest" or "go ahead" about waiting items mean approve.
- skip {refs}: drop waiting items or shortlist items (same ref rules).
- status: what is in flight.
- research {refs:[one ref]}: company research for a shortlist or waiting item.
- gaps {refs:[one ref]}: skills the job wants that the user's graph lacks.
- add_fact {text}: the user states something about their own career or skills.
- set_setting {key, value}: daily_cap (integer), min_score (0-100), auto_approve (on/off, approve tailored resumes without asking), review_before_submit (on/off).
- help: explain what you can do.
Resolve "the Stripe one" to the company name "Stripe". Use several calls for compound requests, in the order given.
If the message is small talk or a question you can answer directly, return no calls and a short "reply".`;

async function llmActions(text: string, ctx: { turns: { role: string; content: string }[]; pending: PendingRef[]; shortlist: { n: number; title: string; company: string }[] }): Promise<{ actions: Action[]; reply?: string }> {
  const prompt = [
    ctx.turns.length ? `RECENT CONVERSATION (oldest first):\n${ctx.turns.map((t) => `${t.role}: ${t.content.slice(0, 400)}`).join("\n")}` : "",
    `WAITING ON THE USER:\n${ctx.pending.length ? ctx.pending.map((p) => `${p.n}. ${p.title} at ${p.company} (${p.status})`).join("\n") : "(nothing)"}`,
    `LAST SHORTLIST:\n${ctx.shortlist.length ? ctx.shortlist.map((s) => `${s.n}. ${s.title} at ${s.company}`).join("\n") : "(none)"}`,
    `USER: ${text}`,
  ].filter(Boolean).join("\n\n");
  const r = await getLLM("quality").json({ name: "agent_tools", system: TOOL_SYSTEM, prompt, schema: ToolCallsSchema, maxTokens: 800, effort: "low" });
  const actions: Action[] = [];
  for (const c of r.calls) {
    const refs = (c.refs ?? []).map(String).filter(Boolean);
    switch (c.tool) {
      case "find_jobs": if (c.query || c.text) actions.push({ tool: "find_jobs", query: (c.query || c.text)! }); break;
      case "apply": case "skip": actions.push({ tool: c.tool, refs }); break;
      case "approve": actions.push({ tool: "approve", refs, what: c.what ?? undefined }); break;
      case "research": case "gaps": if (refs[0] || c.query) actions.push({ tool: c.tool, ref: refs[0] ?? c.query! }); break;
      case "add_fact": actions.push({ tool: "add_fact", text: c.text || text }); break;
      case "set_setting": if (c.key && c.value != null) actions.push({ tool: "set_setting", key: c.key, value: c.value }); break;
      default: actions.push({ tool: c.tool });
    }
  }
  return { actions, reply: r.reply ?? undefined };
}

// ---------- handler ----------

export type AgentDeps = {
  runner: RunnerDeps;
  /** Push a message to the user later (worker wires channels' sendToUser). */
  notify?: (userId: string, msg: OutboundMessage) => Promise<unknown>;
  discover?: typeof discoverJobs;
  research?: typeof researchCompany;
  /** Await runner work before replying instead of running it in the background (tests, the API). */
  inline?: boolean;
  /** Use the LLM tool-calling path when a provider is configured. Default true. */
  useLLM?: boolean;
};

type Shortlist = string[];

async function channelId(db: Db, msg: Pick<InboundMessage, "channel" | "address">): Promise<string | null> {
  const [row] = await db.select().from(channels).where(and(eq(channels.kind, msg.channel), eq(channels.address, msg.address))).limit(1);
  return row?.id ?? null;
}

const memory = new Map<string, Shortlist>();

async function loadShortlist(db: Db, userId: string, msg: InboundMessage): Promise<Shortlist> {
  const ch = await channelId(db, msg);
  if (ch) {
    const [r] = await db.select().from(conversations)
      .where(and(eq(conversations.channelId, ch), eq(conversations.role, "system"), isNotNull(sql`${conversations.state}->'lastShortlist'`)))
      .orderBy(desc(conversations.ts)).limit(1);
    if (r && Array.isArray(r.state?.lastShortlist)) return r.state.lastShortlist as string[];
  }
  return memory.get(`${userId}:${msg.channel}:${msg.address}`) ?? [];
}

async function saveShortlist(db: Db, userId: string, msg: InboundMessage, list: Shortlist) {
  memory.set(`${userId}:${msg.channel}:${msg.address}`, list);
  const ch = await channelId(db, msg);
  if (ch) await db.insert(conversations).values({ channelId: ch, role: "system", content: "shortlist", state: { lastShortlist: list } });
}

async function recentTurns(db: Db, msg: InboundMessage): Promise<{ role: string; content: string }[]> {
  const ch = await channelId(db, msg);
  if (!ch) return [];
  const rows = await db.select({ role: conversations.role, content: conversations.content }).from(conversations)
    .where(and(eq(conversations.channelId, ch), inArray(conversations.role, ["user", "assistant"])))
    .orderBy(desc(conversations.ts)).limit(11);
  const turns = rows.reverse();
  // The router stores the current message before calling the handler; don't repeat it.
  if (turns.length && turns[turns.length - 1].role === "user" && turns[turns.length - 1].content === msg.text) turns.pop();
  return turns.slice(-10);
}

const STATUS_LINE: Partial<Record<ApplicationStatus, string>> = {
  resume_review: "resume ready for review", form_review: "form filled, waiting for your approval",
  needs_user: "needs your answers", awaiting_code: "waiting for a verification code", submitted: "submitted",
  failed: "failed", queued: "queued", tailoring: "tailoring resume", filling: "filling form", submitting: "submitting",
};

async function describeApp(db: Db, app: Application): Promise<OutboundMessage> {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, app.jobId)).limit(1);
  const j = job ?? { title: "Job", companyName: "?" };
  if (app.status === "resume_review" || app.status === "form_review" || app.status === "needs_user") {
    const pending = await loadPending(db, app.userId);
    const ref = pending.find((p) => p.applicationId === app.id)?.n;
    if (app.status === "needs_user") return N.splitLong(N.needsUserNote(app, j, { ref })).out;
    const [r] = app.resumeId ? await db.select().from(resumes).where(eq(resumes.id, app.resumeId)).limit(1) : [];
    const msg = N.splitLong(N.reviewRequest(app, j, r, { ref: ref ?? 1, attach: app.status === "resume_review" })).out;
    // Without a pending number, point at the plain commands.
    return ref ? msg : { ...msg, text: `${j.title} at ${j.companyName}: ${STATUS_LINE[app.status]}. Reply "approve ${app.status === "resume_review" ? "resume" : "form"}". Open: ${N.appLink(app.id)}` };
  }
  if (app.status === "submitted") return N.submittedNote(app, j);
  return { text: `${j.title} at ${j.companyName}: ${STATUS_LINE[app.status] ?? app.status}${app.status === "failed" && app.error ? `\nError: ${app.error}` : ""}` };
}

function parseBool(v: string): boolean | null {
  const t = v.trim().toLowerCase();
  if (/^(on|true|yes|y|1|enable|enabled)$/.test(t)) return true;
  if (/^(off|false|no|n|0|disable|disabled)$/.test(t)) return false;
  return null;
}

/** Build the channel router's onMessage handler. */
export function createAgent(db: Db, deps: AgentDeps) {
  const reload = async (id: string) => (await db.select().from(applications).where(eq(applications.id, id)).limit(1))[0] ?? null;
  const run = async (userId: string, work: () => Promise<unknown>, appId: string) => {
    const p = work().then(() => reload(appId));
    if (deps.inline) { await p; return; }
    void p.then(async (app) => { if (app && deps.notify) await deps.notify(userId, await describeApp(db, app)); })
      .catch((err) => console.warn("[agent] background work failed:", (err as Error).message));
  };

  return function onMessage(userId: string, msg: InboundMessage): Promise<OutboundMessage> {
    return withUserLLM(db, userId, () => handle(userId, msg));
  };

  async function handle(userId: string, msg: InboundMessage): Promise<OutboundMessage> {
    const keyword = parseIntent(msg.text);
    let actions: Action[] | null = null;
    // Exact numbered commands skip the model; everything else goes through tool calling when available.
    const exact = keyword && ["apply", "approve", "skip", "status", "set", "missing", "research", "find", "help"].includes(keyword.kind);
    if (!exact && deps.useLLM !== false && getLLM("quality").available) {
      try {
        const shortlistIds = await loadShortlist(db, userId, msg);
        const sj = shortlistIds.length ? await db.select().from(jobs).where(inArray(jobs.id, shortlistIds)) : [];
        const byId = new Map(sj.map((j) => [j.id, j]));
        const shortlist = shortlistIds.map((id, i) => ({ n: i + 1, title: byId.get(id)?.title ?? "?", company: byId.get(id)?.companyName ?? "?" }));
        const r = await llmActions(msg.text, { turns: await recentTurns(db, msg), pending: await loadPending(db, userId, msg), shortlist });
        if (r.actions.length) actions = r.actions;
        else if (r.reply) return { text: r.reply };
      } catch (err) {
        console.warn("[agent] tool calling failed, using keywords:", (err as Error).message);
      }
    }
    actions ??= intentToActions(keyword ?? { kind: "help" });
    return N.combine(await execute(userId, msg, actions));
  }

  async function execute(userId: string, msg: InboundMessage, actions: Action[]): Promise<OutboundMessage[]> {
    const pending = await loadPending(db, userId, msg);
    const shortlist = await loadShortlist(db, userId, msg);
    const shortlistJob = async (n: number) => {
      const id = shortlist[n - 1];
      return id ? ((await db.select().from(jobs).where(eq(jobs.id, id)).limit(1))[0] ?? null) : null;
    };
    const shortlistByName = async (name: string) => {
      if (!shortlist.length) return [];
      const rows = await db.select().from(jobs).where(inArray(jobs.id, shortlist));
      const t = name.toLowerCase().replace(/^the\s+/, "").replace(/\s+one$/, "");
      return rows.filter((j) => j.companyName.toLowerCase().includes(t));
    };
    const appFor = async (jobId: string) =>
      (await db.select().from(applications).where(and(eq(applications.userId, userId), eq(applications.jobId, jobId))).limit(1))[0] ?? null;

    // Items named explicitly anywhere in this message; "rest" means every other waiting item.
    const named = new Set<string>();
    for (const a of actions) {
      if (a.tool !== "approve" && a.tool !== "skip") continue;
      for (const r of a.refs) if (r !== "rest" && r !== "all") for (const p of resolveRef(pending, r)) named.add(p.applicationId);
    }

    /** Resolve refs to applications: pending list first, then the shortlist. Unknown refs come back separately. */
    const resolveApps = async (refs: string[]): Promise<{ apps: Application[]; unknown: string[] }> => {
      const ids = new Set<string>();
      const unknown: string[] = [];
      for (const r of refs) {
        if (r === "all") { pending.forEach((p) => ids.add(p.applicationId)); continue; }
        if (r === "rest") { pending.filter((p) => !named.has(p.applicationId)).forEach((p) => ids.add(p.applicationId)); continue; }
        const hits = resolveRef(pending, r);
        if (hits.length) { hits.forEach((p) => ids.add(p.applicationId)); continue; }
        const jobsHit = /^\d+$/.test(r) ? [await shortlistJob(Number(r))].filter(Boolean) as (typeof jobs.$inferSelect)[] : await shortlistByName(r);
        const apps = (await Promise.all(jobsHit.map((j) => appFor(j.id)))).filter(Boolean) as Application[];
        if (apps.length) apps.forEach((a) => ids.add(a.id)); else unknown.push(r);
      }
      const apps = ids.size ? await db.select().from(applications).where(inArray(applications.id, [...ids])) : [];
      return { apps, unknown };
    };
    const jobOf = async (jobId: string) => (await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1))[0];
    /** A job for research/gaps: shortlist number or name, a waiting item, or the newest job from that company. */
    const jobForRef = async (ref: string) => {
      if (/^\d+$/.test(ref)) return shortlistJob(Number(ref));
      const p = resolveRef(pending, ref)[0];
      if (p) return jobOf(p.jobId);
      const s = (await shortlistByName(ref))[0];
      if (s) return s;
      const [j] = await db.select().from(jobs).where(sql`lower(${jobs.companyName}) = ${ref.trim().toLowerCase()}`).orderBy(desc(jobs.firstSeenAt)).limit(1);
      return j ?? null;
    };

    const out: OutboundMessage[] = [];
    for (const a of actions) {
      switch (a.tool) {
        case "find_jobs": {
          const { jobs: ranked, heldOnly } = await findAndRank(db, userId, { objective: a.query, maxResults: 10 }, deps.discover);
          if (!ranked.length) { out.push(N.noJobsNote(a.query)); break; }
          const top = ranked.slice(0, 10);
          shortlist.splice(0, shortlist.length, ...top.map((r) => r.job.id));
          await saveShortlist(db, userId, msg, shortlist);
          out.push(N.shortlistMessage(top.map((r) => ({ job: r.job, score: r.match?.score ?? null }))));
          if (heldOnly) out.push({ text: "Live web search is not switched on, so these come from the jobs Nori already has. Add companies on the Companies page to widen it." });
          break;
        }
        case "apply": {
          for (const r of a.refs.length ? a.refs : ["1"]) {
            const hits = /^\d+$/.test(r) ? [await shortlistJob(Number(r))].filter(Boolean) as (typeof jobs.$inferSelect)[] : await shortlistByName(r);
            if (!hits.length) { out.push(/^\d+$/.test(r) ? N.noItemNote(Number(r)) : N.unknownRefNote(r, pending)); continue; }
            for (const job of hits) {
              const app = await createApplication(db, userId, job.id);
              await logAgentEvent(db, { userId, kind: "queued", jobId: job.id, applicationId: app.id, message: `You asked me to apply to ${job.title} at ${job.companyName}`, data: { job: { title: job.title, companyName: job.companyName }, byUser: true } });
              await run(userId, () => runApplication(db, app.id, deps.runner), app.id);
              out.push(N.startedNote(job));
            }
          }
          break;
        }
        case "approve": {
          let apps: Application[];
          let unknown: string[] = [];
          if (a.refs.length) ({ apps, unknown } = await resolveApps(a.refs));
          else {
            const want: ApplicationStatus[] = a.what === "resume" ? ["resume_review"] : a.what === "form" ? ["form_review"] : ["resume_review", "form_review"];
            apps = await db.select().from(applications).where(and(eq(applications.userId, userId), inArray(applications.status, want)))
              .orderBy(desc(applications.updatedAt)).limit(1);
          }
          for (const r of unknown) out.push(/^\d+$/.test(r) && !pending.length ? N.noItemNote(Number(r)) : N.unknownRefNote(r, pending));
          if (!apps.length) { if (!unknown.length) out.push(N.approvedNote([])); break; }
          const done: Parameters<typeof N.approvedNote>[0] = [];
          for (const app of apps) {
            const job = await jobOf(app.jobId);
            if (app.status === "resume_review") {
              await logAgentEvent(db, { userId, kind: "approved", applicationId: app.id, jobId: job.id, message: `You approved the resume for ${job.title} at ${job.companyName}`, data: { job: { title: job.title, companyName: job.companyName }, stage: "resume" } });
              await run(userId, () => approveResume(db, app.id, deps.runner), app.id);
              done.push({ job, stage: "resume" });
            } else if (app.status === "form_review") {
              await logAgentEvent(db, { userId, kind: "approved", applicationId: app.id, jobId: job.id, message: `You approved sending ${job.title} at ${job.companyName}`, data: { job: { title: job.title, companyName: job.companyName }, stage: "form" } });
              await run(userId, () => approveForm(db, app.id, deps.runner), app.id);
              done.push({ job, stage: "form" });
            } else {
              done.push({ job, stage: "other", status: STATUS_LINE[app.status] ?? app.status });
            }
          }
          out.push(N.approvedNote(done));
          break;
        }
        case "skip": {
          const { apps, unknown } = await resolveApps(a.refs);
          for (const r of unknown) out.push(N.unknownRefNote(r, pending));
          const skipped: (typeof jobs.$inferSelect)[] = [];
          for (const app of apps) {
            const job = await jobOf(app.jobId);
            if (!["submitted", "skipped", "viewed", "replied", "interview", "offer", "rejected"].includes(app.status)) await skipApplication(db, app.id);
            await logAgentEvent(db, { userId, kind: "skipped", applicationId: app.id, jobId: job.id, message: `You skipped ${job.title} at ${job.companyName}`, data: { job: { title: job.title, companyName: job.companyName }, reasons: ["Skipped by you"], byUser: true } });
            skipped.push(job);
          }
          if (apps.length || !unknown.length) out.push(N.skippedNote(skipped));
          break;
        }
        case "status": {
          const apps = await db.select().from(applications).where(eq(applications.userId, userId));
          const counts: Record<string, number> = {};
          for (const x of apps) counts[x.status] = (counts[x.status] ?? 0) + 1;
          const inflight = apps.filter((x) => ACTIVE_STATUSES.includes(x.status) || ["resume_review", "form_review", "needs_user", "awaiting_code"].includes(x.status));
          const js = inflight.length ? await db.select().from(jobs).where(inArray(jobs.id, inflight.map((x) => x.jobId))) : [];
          const byId = new Map(js.map((j) => [j.id, j]));
          const refOf = new Map(pending.map((p) => [p.applicationId, p.n]));
          out.push(N.statusMessage(counts, inflight.map((x) => ({
            job: byId.get(x.jobId) ?? { title: "?", companyName: "?" }, label: STATUS_LINE[x.status] ?? x.status, ref: refOf.get(x.id),
          }))));
          break;
        }
        case "research": {
          const job = await jobForRef(a.ref);
          if (!job) { out.push(/^\d+$/.test(a.ref) ? N.noItemNote(Number(a.ref)) : N.unknownRefNote(a.ref, pending)); break; }
          out.push(N.researchNote(job.companyName, await (deps.research ?? researchCompany)(db, job.companyName)));
          break;
        }
        case "gaps": {
          const job = await jobForRef(a.ref);
          if (!job) { out.push(/^\d+$/.test(a.ref) ? N.noItemNote(Number(a.ref)) : N.unknownRefNote(a.ref, pending)); break; }
          const req = await ensureRequirements(db, job.id);
          if (!req) { out.push({ text: "Could not read that job's requirements." }); break; }
          out.push(N.gapsNote(job, await skillGaps(db, userId, req)));
          break;
        }
        case "add_fact":
          out.push(N.factNote(await addFact(db, userId, a.text)));
          break;
        case "set_setting":
          out.push(await applySetting(userId, a.key, a.value));
          break;
        default:
          out.push({ text: N.HELP_TEXT });
      }
    }
    return out;
  }

  async function applySetting(userId: string, key: SettingKey, value: string): Promise<OutboundMessage> {
    switch (key) {
      case "daily_cap": {
        const n = Math.max(0, Math.min(50, Math.round(Number(value))));
        if (!Number.isFinite(n)) return { text: `"${value}" is not a number.` };
        await db.update(profiles).set({ autoApplyDailyCap: n, updatedAt: new Date() }).where(eq(profiles.userId, userId));
        return N.settingNote("your daily application cap", n === 0 ? "0 (I won't start applications on my own)" : `${n} a day`);
      }
      case "min_score": {
        let v = Number(String(value).replace("%", ""));
        if (!Number.isFinite(v)) return { text: `"${value}" is not a number.` };
        if (v > 1) v /= 100;
        v = Math.max(0, Math.min(1, v));
        await db.update(profiles).set({ autoApplyMinScore: v, updatedAt: new Date() }).where(eq(profiles.userId, userId));
        return N.settingNote("the minimum match score", `${Math.round(v * 100)}%`);
      }
      case "auto_approve":
      case "review_before_submit": {
        const b = parseBool(value);
        if (b == null) return { text: `Say on or off for ${key.replace(/_/g, " ")}.` };
        await db.update(profiles).set(key === "auto_approve" ? { resumeAutoApprove: b, updatedAt: new Date() } : { reviewBeforeSubmit: b, updatedAt: new Date() })
          .where(eq(profiles.userId, userId));
        return N.settingNote(key === "auto_approve" ? "auto-approve for tailored resumes" : "review before submit", b ? "on" : "off");
      }
    }
  }
}

export type AgentHandler = ReturnType<typeof createAgent>;

/**
 * One chat turn outside the channel router (the dashboard chat, scripts): makes sure the channel row
 * exists so conversation memory and the pending list work, records both turns, returns the reply.
 */
export async function chatOnce(db: Db, handler: AgentHandler, userId: string, kind: ChannelKind, address: string, text: string): Promise<OutboundMessage> {
  await db.insert(channels).values({ userId, kind, address }).onConflictDoNothing();
  const [ch] = await db.select().from(channels).where(and(eq(channels.kind, kind), eq(channels.address, address))).limit(1);
  if (ch.userId !== userId) throw new Error("Channel belongs to another user");
  await db.insert(conversations).values({ channelId: ch.id, role: "user", content: text });
  const out = await handler(userId, { channel: kind, address, text });
  await db.insert(conversations).values({ channelId: ch.id, role: "assistant", content: out.text });
  return out;
}

/** Recent chat turns for a channel, oldest first (dashboard chat history). */
export async function chatHistory(db: Db, kind: ChannelKind, address: string, limit = 50) {
  const ch = await channelId(db, { channel: kind, address });
  if (!ch) return [];
  const rows = await db.select({ role: conversations.role, content: conversations.content, ts: conversations.ts }).from(conversations)
    .where(and(eq(conversations.channelId, ch), inArray(conversations.role, ["user", "assistant"])))
    .orderBy(desc(conversations.ts), asc(conversations.role)).limit(limit);
  return rows.reverse();
}
