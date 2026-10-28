/**
 * The background runtime, shared by the standalone worker (apps/worker) and the API when EMBED_WORKER=1
 * (`npm run demo`, one process so the embedded database has one owner):
 *  - every 20 s: advance runnable applications (queued / tailoring / filling / submitting), one at a time,
 *    and auto-retry failed ones until MAX_ATTEMPTS
 *  - every 15 min: poll the tenant feeds in the companies table that are older than 3 h (the curated board registry is
 *    seeded into that table at start), then score the new jobs for every user with a graph
 *  - every 5 min: sync the default user's inbox (when Composio is configured) and tell the user about replies
 *  - every AGENT_TICK_MINUTES (default 20): agentTick for every user with a graph (discover, score, gate, queue,
 *    advance, ask for reviews over chat)
 *  - every hour: drop expired sessions and spent account links
 *  - every minute: morning brief at BRIEF_HOUR local (default 8) once a day, weekly summary on Mondays
 *  - channel router (Telegram long-poll, WhatsApp webhook adapter, Slack triggers) with the chat agent, plus the
 *    console channel (stdin/stdout) when CHANNEL_CONSOLE=1
 */
import { and, eq, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import {
  applications, channels, companies, FEEDS, HostBackoff, RateLimitedError, feedHost, MAX_ATTEMPTS, STALE_MS, ensureDefaultUser, createAgent, computeMatchesForUser, usersWithGraph,
  acquireLease, releaseLease, withLease,
  agentTick, announceInbox, seedBoardRegistry, pruneAuthTokens, pruneSessions, maybeMorningBrief, maybeWeeklySummary, pickRunnable, pollTenant, pruneArtifacts, recoverStuckCodeWaits, retryApplication, runApplication, withUserLLM,
  type AtsType, type Db, type OutboundMessage, type RunnerDeps,
} from "@jobgraph/core";
import { pickDriver } from "@jobgraph/drivers";
import { composioAvailable, createChannelRouter, pruneInbox, sendToUser, syncInbox, waitForVerificationCode, type ChannelRouter } from "@jobgraph/channels";
import { CONSOLE_ADDRESS, ConsoleChannel } from "./console.js";

export type Notify = (userId: string, msg: OutboundMessage) => Promise<unknown>;

export type RuntimeOptions = {
  /** Log prefix: "worker" standalone, "agent" embedded in the API. */
  name?: string;
  runner?: RunnerDeps;
  /** Defaults to CHANNEL_CONSOLE=1. */
  console?: boolean;
};

export type Runtime = {
  /** The channel router; the API mounts its WhatsApp webhook on it. */
  router: ChannelRouter;
  /** Push to the user's linked channels, and to the terminal in console mode. */
  notify: Notify;
  runner: RunnerDeps;
  consoleMode: boolean;
  stop: () => void;
};

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function defaultRunner(): RunnerDeps {
  return { pickDriver, waitForCode: (d: Db, userId: string, hint: string, ms: number) => waitForVerificationCode(d, userId, hint, ms) };
}

/** Start the scheduler and channel listeners. Call stop() to clear timers and listeners. */
export async function startRuntime(db: Db, opts: RuntimeOptions = {}): Promise<Runtime> {
  const name = opts.name ?? "worker";
  const RUN_EVERY = 20_000;
  const POLL_EVERY = 15 * 60_000;
  const INBOX_EVERY = 5 * 60_000;
  const TICK_EVERY = (Number(process.env.AGENT_TICK_MINUTES ?? 20) || 20) * 60_000;
  const BRIEF_HOUR = Number(process.env.BRIEF_HOUR ?? 8);
  const BRIEF_CHECK_EVERY = 60_000;

  const consoleChannel = new ConsoleChannel({ enabled: opts.console ?? process.env.CHANNEL_CONSOLE === "1" });
  // In console mode the terminal is a chat; keep logs short and on stderr.
  const log = (msg: string) => (consoleChannel.available ? console.error(`[${name}] ${msg}`) : console.log(`[${name} ${new Date().toISOString()}] ${msg}`));

  let stopping = false;
  const timers: NodeJS.Timeout[] = [];
  const leases = new Set<string>();
  /**
   * Run `fn` soon and then every `ms`, never overlapping with itself, and in one process only: with the API's embedded
   * scheduler and a separate worker on one database, the job's lease decides who runs it (the other skips), so ticks,
   * feed polls, briefs and inbox announcements are not done twice. The lease outlives one interval by a minute, so the
   * holder keeps it from tick to tick, and another process takes over about a minute after the holder stops.
   */
  const every = (label: string, ms: number, fn: () => Promise<void>) => {
    let busy = false;
    const lease = `job:${label}`;
    const tick = async () => {
      if (busy || stopping) return;
      busy = true;
      try {
        if (await withLease(db, lease, ms + 60_000, fn)) leases.add(lease);
      } catch (e) { log(`${label} failed: ${errMsg(e)}`); } finally { busy = false; }
    };
    setTimeout(() => void tick(), 0);
    timers.push(setInterval(tick, ms));
  };

  // A default user exists only for local dev (DEFAULT_USER_EMAIL) or the console channel. In production the
  // scheduler works for real accounts only, so a restart never creates a phantom "me@example.com".
  const user = process.env.DEFAULT_USER_EMAIL || consoleChannel.available ? await ensureDefaultUser(db) : null;
  const runner = opts.runner ?? defaultRunner();

  if (consoleChannel.available && user) {
    await db.insert(channels).values({ userId: user.id, kind: "console", address: CONSOLE_ADDRESS }).onConflictDoNothing();
  }
  const notify: Notify = async (userId, msg) => {
    if (consoleChannel.available && user && userId === user.id) await consoleChannel.send(CONSOLE_ADDRESS, msg);
    return sendToUser(db, userId, msg);
  };
  const agentUsers = async () => [...new Set([...(user ? [user.id] : []), ...(await usersWithGraph(db))])];

  every("runner", RUN_EVERY, async () => {
    for (const app of await pickRunnable(db, { limit: 10 })) {
      if (stopping) return;
      const status = await runApplication(db, app.id, runner);
      if (status !== app.status) log(`application ${app.id}: ${app.status} -> ${status}`);
    }
    // Auto-retry failed runs a few times (MAX_ATTEMPTS counts driver runs and step errors); after that they stay failed.
    // Never auto-retry a failed submit (formApprovedAt set): a half-finished submit must not be re-sent without the user.
    const failed = await db.select().from(applications).where(and(
      eq(applications.status, "failed"), lt(applications.attempts, MAX_ATTEMPTS), isNull(applications.formApprovedAt),
      lte(applications.updatedAt, new Date(Date.now() - STALE_MS)),
    )).limit(5);
    for (const app of failed) {
      if (stopping) return;
      log(`auto-retry ${app.id} (attempt ${app.attempts + 1} of ${MAX_ATTEMPTS})`);
      await retryApplication(db, app.id, runner, { force: false });
    }
  });

  const seeded = await seedBoardRegistry(db, { log });
  if (seeded) log(`board registry: added ${seeded} companies to watch`);

  // The curated registry carries tens of thousands of postings, so each board is re-read every few hours here.
  // Boards a user follows or applied to are refreshed hourly by that user's agent tick.
  const BOARD_REFRESH_MS = 3 * 3600_000;
  // Be a polite reader: a short pause between boards, and when a host keeps answering 429/503 (after the per-request
  // retries in http.ts) leave its remaining boards for the next cycle instead of hammering it.
  const BOARD_PAUSE_MS = 750;
  every("feeds", POLL_EVERY, async () => {
    // Boards never read first, then the most overdue, so a cycle cut short does not starve the same boards every time.
    const rows = await db.select().from(companies).where(and(
      isNotNull(companies.atsToken),
      or(isNull(companies.lastPolledAt), lt(companies.lastPolledAt, new Date(Date.now() - BOARD_REFRESH_MS))),
    )).orderBy(sql`${companies.lastPolledAt} asc nulls first`);
    const backoff = new HostBackoff(2);
    let polled = 0, skipped = 0;
    for (const c of rows) {
      if (stopping) return;
      if (!FEEDS[c.atsType as AtsType]) continue;
      const host = feedHost(c.atsType as AtsType);
      if (backoff.isBackedOff(host)) { skipped++; continue; }
      if (polled++) await new Promise<void>((resolve) => setTimeout(resolve, BOARD_PAUSE_MS));
      try {
        const r = await pollTenant(db, c.atsType, c.atsToken);
        backoff.ok(host);
        if (r.added || r.closed) log(`feed ${c.atsType}/${c.atsToken}: +${r.added} new, ${r.closed} closed (${r.total} open)`);
        if (r.ids.length) {
          for (const userId of await usersWithGraph(db)) {
            if (stopping) return;
            const m = await computeMatchesForUser(db, userId, { jobIds: r.ids, limit: r.ids.length });
            if (m.computed) log(`feed ${c.atsType}/${c.atsToken}: scored ${m.computed} job(s) for user ${userId}`);
          }
        }
      } catch (e) {
        log(`feed ${c.atsType}/${c.atsToken} failed: ${errMsg(e)}`);
        if (e instanceof RateLimitedError) {
          if (backoff.rateLimited(host)) log(`feeds: ${host} keeps refusing (429/503); backing it off for the rest of this cycle`);
        } else backoff.ok(host);
      }
    }
    if (skipped) log(`feeds: left ${skipped} board(s) on ${backoff.backedOffHosts.join(", ")} for the next cycle`);
  });

  every("housekeeping", 60 * 60_000, async () => {
    const stuck = await recoverStuckCodeWaits(db);
    if (stuck) log(`housekeeping: ${stuck} application(s) recovered from an interrupted code wait`);
    const art = await pruneArtifacts(db, { root: runner.artifactsRoot });
    if (art.files || art.dirs) log(`housekeeping: removed ${art.files} old screenshot(s) and ${art.dirs} orphaned artifact folder(s)`);
    const [sessions, tokens, mail] = [await pruneSessions(db), await pruneAuthTokens(db), await pruneInbox(db)];
    if (sessions || tokens || mail) log(`housekeeping: removed ${sessions} expired session(s), ${tokens} spent account link(s), ${mail} non-job mail marker(s)`);
  });

  every("inbox", INBOX_EVERY, async () => {
    if (!composioAvailable()) return;
    for (const userId of await agentUsers()) {
      if (stopping) return;
      // Classification uses that user's bulk model.
      const { imported } = await withUserLLM(db, userId, () => syncInbox(db, userId));
      if (imported) log(`inbox ${userId}: imported ${imported}`);
      const told = await announceInbox(db, userId, notify);
      if (told) log(`inbox ${userId}: told the user about ${told} message(s)`);
    }
  });

  every("agent", TICK_EVERY, async () => {
    for (const userId of await agentUsers()) {
      if (stopping) return;
      const s = await agentTick(db, userId, { runner, notify });
      if (s.discovered || s.queued || s.skipped.length || s.submitted || s.announced || s.errors.length) {
        log(`agent ${userId}: +${s.discovered} found, ${s.scored} scored, ${s.queued} queued, ${s.skipped.length} skipped, ${s.submitted} submitted, ${s.announced} announced${s.errors.length ? `, errors: ${s.errors.join("; ")}` : ""}`);
      }
    }
  });

  every("brief", BRIEF_CHECK_EVERY, async () => {
    for (const userId of await agentUsers()) {
      if (stopping) return;
      if (await maybeMorningBrief(db, userId, notify, { hour: BRIEF_HOUR })) log(`morning brief sent to ${userId}`);
      if (await maybeWeeklySummary(db, userId, notify, { hour: BRIEF_HOUR })) log(`weekly summary sent to ${userId}`);
    }
  });

  const router = createChannelRouter(db, { onMessage: createAgent(db, { runner, notify }) });
  // Chat listeners (Telegram long-polling, Slack triggers) run in one process: two pollers on one bot token make
  // Telegram answer 409 forever and can hand one message to both. Whoever holds the lease listens; the other process
  // checks every 30 seconds and takes over if the holder stops renewing.
  const LISTEN_LEASE = "channels:listeners";
  let stopRouter: (() => void) | null = null;
  const watchListeners = async () => {
    if (stopping) return;
    try {
      const mine = await acquireLease(db, LISTEN_LEASE, 90_000);
      if (mine && !stopRouter) { stopRouter = await router.start(); leases.add(LISTEN_LEASE); log("chat listeners started here"); }
      if (!mine && stopRouter) { stopRouter(); stopRouter = null; log("chat listeners moved to another process"); }
    } catch (e) { log(`chat listener lease failed: ${errMsg(e)}`); }
  };
  // WhatsApp is a webhook, not a poller: whichever process serves the route must handle it, lease or not.
  await router.whatsapp.listen((m) => router.handleInbound(m).then(() => {}));
  await watchListeners();
  timers.push(setInterval(() => void watchListeners(), 30_000));
  let stopConsole = () => {};
  if (consoleChannel.available) {
    stopConsole = await consoleChannel.listen(async (m) => {
      const out = await router.handleInbound(m);
      if (out) await consoleChannel.send(m.address, out);
    });
  }
  log(`started (runner 20s, feeds 15m, inbox 5m, agent tick ${TICK_EVERY / 60_000}m, brief at ${BRIEF_HOUR}:00, channel listeners${consoleChannel.available ? ", console" : ""})`);

  return {
    router, notify, runner, consoleMode: consoleChannel.available,
    stop: () => {
      if (stopping) return;
      stopping = true;
      timers.forEach(clearInterval);
      try { stopRouter?.(); stopConsole(); } catch { /* ignore */ }
      // Hand the jobs over at once instead of letting another process wait for the leases to expire.
      for (const l of leases) void releaseLease(db, l).catch(() => {});
    },
  };
}
