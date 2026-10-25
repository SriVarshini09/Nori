import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { and, asc, desc, eq, gt, gte, ilike, inArray, isNotNull, isNull, ne, notExists, or, sql, type SQL } from "drizzle-orm";
import {
  clearResumeNodes, deleteGraphNode,
  applications, channels, companies, inboxMessages, jobs, matches, profiles, resumes, runEvents, users,
  APPLICATION_STATUSES, ATS_TYPES,
  addFact, addJobFromUrl, answerPending, approveForm, approveResume, artifactsRootOf, createApplication, ensureDefaultUser,
  advanceOnboarding, authenticate, ensureResumeDoc, createPasswordUser, createSession, deleteUserAccount, getSessionUser, publicUser, revokeSession,
  acceptAnswers, countHumanApprovals, recruiterReview, AUTOPILOT_MIN_HUMAN_APPROVALS, changePassword, consumeAuthToken, sha256, detectBoard, ingestCareerPageJsonLd, prettifyToken, followCompany, unfollowCompany, listCompanies, issueAuthToken, listSessions, markEmailVerified, resetPassword, revokeOtherSessions, revokeSessionById,
  ONBOARDING_STEPS, SESSION_COOKIE, SESSION_TTL_MS, type SessionUser,
  computeMatchesForUser, findAndRank, getGraph, getProfile, ingestResume, matchJobs, onRunEvent, pollTenant, researchCompany, resolveProvider,
  retryApplication, runApplication, skipApplication, toRunEvent,
  agentTick, tickRunning, type TickSummary, chatHistory, chatOnce, createAgent, getActivity, startOfDay,
  effectiveLanes, exportGraph, issueChannelLinkCode, localOnly, modeOf, modelSettings,
  normalizeLanes, processLLM, queuedTodayByLane, storedLanes, withUserLLM, LaneInput,
  type ApplicationStatus, type Db, type OutboundMessage, type Preferences, type RunEventRow, type RunnerDeps,
} from "@jobgraph/core";
import { pickDriver } from "@jobgraph/drivers";
import { captureError, sentryEnabled, sentrySelfTest } from "./sentry.js";
import {
  composioAvailable, connectToolkit, listConnections, sendToUser, syncInbox, syncTrackerSheet, telegramBotUsername, verifyWhatsAppSignature, waitForVerificationCode, TOOLKITS,
  type ChannelRouter,
} from "@jobgraph/channels";
import { mountMcp } from "./mcp.js";
import { defaultMailer, mailerState, resetEmail, verifyEmail, type Mailer } from "./mailer.js";
import { defaultRateRules, rateLimit, securityHeaders, type RateRule } from "./security.js";
import { bad, body, describeDevice, uuidOk } from "./http.js";
import { mountFontRoute, mountResumeRoutes } from "./resume-routes.js";
import { MAX_RESUME_BYTES, extractResumeFile, resumeKind } from "./extract.js";
import { SCANNED_PDF_ERROR, type ExtractedLink, type ExtractedResume } from "@jobgraph/core";
import { ProfileBody, STEP_SCHEMAS, buildProfilePatch } from "./profile-fields.js";

export type AppEnv = { Variables: { user: SessionUser } };

export type AppOptions = {
  /** Override runner wiring (tests inject a fake driver and a stub renderer). */
  runnerDeps?: Partial<RunnerDeps>;
  /** Channel router for the WhatsApp webhook. Omit to disable the webhook (returns 503). */
  router?: ChannelRouter;
  webUrl?: string;
  /** Disable the /mcp endpoint. */
  mcp?: boolean;
  /**
   * Dev fallback user when a request has no session cookie. Defaults to DEFAULT_USER_EMAIL;
   * null (or unset env) means cookieless requests get 401.
   */
  defaultUserEmail?: string | null;
  /** Push agent notifications (tick results, background chat work). Defaults to channels' sendToUser. */
  notify?: (userId: string, msg: OutboundMessage) => Promise<unknown>;
  /** Rate limiting: true or unset = the default rules (off under test runners), false = off, or custom rules. */
  rateLimit?: boolean | RateRule[];
  /** How long approve-form waits for a resumed run to reach the form review (default 25 s, under the web proxy timeout). */
  approveWaitMs?: number;
  /** Sends verification and password-reset email. Defaults to Resend when RESEND_API_KEY is set, else logs to the console. */
  mailer?: Mailer;
};

export function defaultRunnerDeps(overrides: Partial<RunnerDeps> = {}): RunnerDeps {
  return { pickDriver, waitForCode: (db, userId, hint, timeoutMs) => waitForVerificationCode(db, userId, hint, timeoutMs), ...overrides };
}

/** GET /api/jobs scores at most this many unscored rows per request. */
const LAZY_MATCH_CAP = 40;
const STATUS_FILTERS = ["open", "closed", "new", "applied"] as const;
const Answers = z.record(z.string(), z.string());
const DiscoverBody = z.object({
  objective: z.string().min(1), titles: z.array(z.string()).optional(), locations: z.array(z.string()).optional(),
  remote: z.boolean().optional(), maxResults: z.number().int().min(1).max(50).optional(),
});

const CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".html": "text/html; charset=utf-8", ".json": "application/json", ".txt": "text/plain; charset=utf-8",
};

async function sendFile(c: Context, file: string, contentType?: string) {
  const st = await stat(file).catch(() => null);
  if (!st?.isFile()) throw bad("File not found", 404);
  const stream = Readable.toWeb(createReadStream(file)) as unknown as ReadableStream;
  return new Response(stream, {
    headers: {
      "content-type": contentType ?? CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      "content-length": String(st.size), "cache-control": "no-cache",
    },
  });
}

/** Strip bulky columns from list payloads. */
function slimJob(j: typeof jobs.$inferSelect) {
  const { raw: _raw, descriptionHtml: _html, ...rest } = j;
  return rest;
}
function slimResume(r: typeof resumes.$inferSelect | null | undefined) {
  if (!r) return null;
  const { html: _html, ...rest } = r;
  return rest;
}

export function createApp(db: Db, opts: AppOptions = {}) {
  const deps = defaultRunnerDeps(opts.runnerDeps);
  const webUrl = opts.webUrl ?? process.env.WEB_URL ?? "http://localhost:3000";
  const artifactsRoot = artifactsRootOf(deps);
  const app = new Hono<AppEnv>();
  const defaultEmail = opts.defaultUserEmail === undefined ? process.env.DEFAULT_USER_EMAIL || null : opts.defaultUserEmail;
  let fallbackPromise: Promise<SessionUser> | null = null;
  /** DEFAULT_USER_EMAIL dev fallback, created on first use and logged once. */
  const fallbackUser = () => (fallbackPromise ??= ensureDefaultUser(db, defaultEmail ?? undefined).then((u) => {
    console.log(`[api] requests without a session act as ${u.email} (DEFAULT_USER_EMAIL dev fallback)`);
    return u;
  }).catch((e) => { fallbackPromise = null; throw e; }));
  // MCP has no cookie. It acts as MCP_USER_EMAIL (an existing account, never created here) or, in local dev,
  // as the DEFAULT_USER_EMAIL fallback. With neither configured the tools refuse rather than invent a user.
  const me = async (): Promise<SessionUser> => {
    const mcpEmail = process.env.MCP_USER_EMAIL?.trim().toLowerCase();
    if (mcpEmail) {
      const u = await db.query.users.findFirst({ where: (t, { eq }) => eq(t.email, mcpEmail) });
      if (!u) throw new Error(`MCP_USER_EMAIL ${mcpEmail} has no account yet; sign up on the dashboard first`);
      return u as SessionUser;
    }
    if (defaultEmail) return fallbackUser();
    throw new Error("MCP has no user: set MCP_USER_EMAIL to an existing account");
  };
  // Production: Secure always. With COOKIE_DOMAIN (dashboard and API on sibling subdomains) the cookie is SameSite=None
  // and shared across them; without it (Next.js /api proxy, same-origin) it stays SameSite=Lax and host-only.
  const secure = process.env.NODE_ENV === "production";
  const cookieDomain = secure ? process.env.COOKIE_DOMAIN?.trim() || undefined : undefined;
  const cookieScope = { path: "/", secure, ...(cookieDomain ? { domain: cookieDomain } : {}) };
  const mailer = opts.mailer ?? defaultMailer();
  const linkTo = (route: string, token: string) => `${webUrl.replace(/\/$/, "")}/${route}?token=${encodeURIComponent(token)}`;
  /** Email is best effort: a mail failure is logged, never shown to the person (and never reveals whether an account exists). */
  const sendMail = (to: string, mail: ReturnType<typeof verifyEmail>) =>
    mailer({ to, ...mail }).catch((err) => console.warn(`[api] email to ${to} failed:`, (err as Error).message));
  const sendVerification = async (user: SessionUser) => {
    await sendMail(user.email, verifyEmail(linkTo("verify-email", await issueAuthToken(db, user.id, "verify"))));
  };
  const setSession = (c: Context, token: string) => setCookie(c, SESSION_COOKIE, token, {
    ...cookieScope, httpOnly: true, sameSite: cookieDomain ? "None" : "Lax", maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  const clearSession = (c: Context) => deleteCookie(c, SESSION_COOKIE, cookieScope);
  /**
   * Fire-and-forget rescoring after the graph changes: scores jobs with no match or one computed before
   * the change. One run per user at a time; a trigger during a run schedules one more pass.
   */
  const matchRuns = new Map<string, { rerun: boolean; done: Promise<void> }>();
  const refreshMatches = (userId: string): Promise<void> => {
    const running = matchRuns.get(userId);
    if (running) { running.rerun = true; return running.done; }
    const state = { rerun: false, done: Promise.resolve() };
    state.done = (async () => {
      try {
        do {
          state.rerun = false;
          const r = await computeMatchesForUser(db, userId, { staleBefore: new Date() });
          if (r.computed) console.log(`[api] scored ${r.computed} job(s) for user ${userId}`);
        } while (state.rerun);
      } catch (err) {
        console.warn(`[api] match refresh failed: ${(err as Error).message}`);
      } finally {
        matchRuns.delete(userId);
      }
    })();
    matchRuns.set(userId, state);
    return state.done;
  };
  /** Start a rescoring pass; ?wait=1 awaits it (tests, scripts). */
  const rescore = async (c: Context, userId: string) => {
    const p = refreshMatches(userId);
    if (c.req.query("wait")) await p;
  };

  /** Session cookie user, else the dev fallback when no cookie was sent, else null. */
  const resolveUser = async (c: Context): Promise<{ user: SessionUser; via: "session" | "default" } | null> => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) {
      const user = await getSessionUser(db, token);
      if (user) return { user, via: "session" };
      clearSession(c);
      return null;
    }
    if (!defaultEmail) return null;
    const u = await fallbackUser();
    return { user: (await db.query.users.findFirst({ where: eq(users.id, u.id) })) ?? u, via: "default" };
  };

  /** Run in the background; ?wait=1 awaits the run (tests, scripts). */
  const kick = async (c: Context, work: () => Promise<unknown>) => {
    const p = work();
    if (c.req.query("wait")) await p;
    else p.catch((err) => console.warn("[api] background run failed:", (err as Error).message));
  };
  const loadApp = async (c: Context<AppEnv>, id: string) => {
    if (!uuidOk(id)) throw bad("Application not found", 404);
    const user = c.get("user");
    const [row] = await db.select().from(applications).where(and(eq(applications.id, id), eq(applications.userId, user.id))).limit(1);
    if (!row) throw bad("Application not found", 404);
    return row;
  };

  app.use("*", cors({
    origin: (origin) => (!origin || origin === webUrl || /^http:\/\/(localhost|127\.0\.0\.1):3000$/.test(origin) ? origin || "*" : null),
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["content-type", "mcp-session-id", "mcp-protocol-version", "last-event-id"],
    exposeHeaders: ["mcp-session-id"],
    credentials: true,
  }));

  // Cross-site request forgery: a page on another site can make the browser POST here with the person's cookie (a plain
  // form needs no preflight). Browsers say where a request comes from, so state-changing requests from any other origin are
  // refused. Requests without an Origin (scripts, the companion app, server-to-server webhooks) still need a session.
  const ownOrigins = new Set([new URL(webUrl).origin]);
  app.use("*", async (c, next) => {
    const m = c.req.method;
    if (m === "GET" || m === "HEAD" || m === "OPTIONS" || c.req.path.startsWith("/api/webhooks/")) return next();
    const origin = c.req.header("origin");
    const crossSite = c.req.header("sec-fetch-site") === "cross-site";
    const allowed = !origin || ownOrigins.has(origin) || origin === new URL(c.req.url).origin
      || (!secure && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
    if (!allowed || (crossSite && !(origin && ownOrigins.has(origin)))) throw bad("Cross-site request refused", 403);
    return next();
  });

  app.use("*", securityHeaders({ hsts: secure }));
  // Off under test runners (they hammer signup and login), on everywhere else unless explicitly disabled.
  const limits = opts.rateLimit ?? !(process.env.VITEST || process.env.NODE_ENV === "test");
  if (limits) app.use("/api/*", rateLimit(Array.isArray(limits) ? limits : defaultRateRules()));
  // Every body is read into memory, so every route gets a ceiling. The resume upload sets its own, larger one.
  const jsonLimit = bodyLimit({ maxSize: 1024 * 1024, onError: () => { throw bad("Request too large (1 MB max)", 413); } });
  app.use("*", async (c, next) => (c.req.path === "/api/profile/resume-file" ? next() : jsonLimit(c, next)));

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    const message = err instanceof Error ? err.message : String(err);
    // The full error (file paths, SQL, upstream replies) goes to the server log only; the person gets a reference to quote.
    const ref = Math.random().toString(36).slice(2, 10);
    console.warn(`[api] ${ref} ${c.req.method} ${c.req.path}: ${message}`, err instanceof Error && err.stack ? `\n${err.stack.split("\n").slice(1, 4).join("\n")}` : "");
    captureError(err, { ref, method: c.req.method, path: c.req.path, userId: c.get("user")?.id });
    if (/PARALLEL_API_KEY|Parallel/i.test(message) && /not set|not configured/i.test(message)) return c.json({ error: "Web job search is not set up on this server." }, 503);
    if (/COMPOSIO_API_KEY|Composio/i.test(message) && /not set|not configured/i.test(message)) return c.json({ error: "Connected apps (Gmail, Sheets, Slack) are not set up on this server." }, 503);
    if (/not set|not configured/i.test(message)) return c.json({ error: "This feature is not set up on this server." }, 503);
    return c.json({ error: `Something went wrong on our side. If it keeps happening, quote reference ${ref}.`, ref }, 500);
  });
  app.notFound((c) => c.json({ error: `No route ${c.req.method} ${c.req.path}` }, 404));

  // ---------- auth ----------
  const PUBLIC = /^\/api\/(auth\/|health$|webhooks\/|resume-fonts\/)/;
  app.use("/api/*", async (c, next) => {
    if (c.req.method === "OPTIONS" || PUBLIC.test(c.req.path)) return next();
    const r = await resolveUser(c);
    if (!r) throw bad("Not signed in", 401);
    c.set("user", r.user);
    // Every LLM call in this request (and background work it starts) uses this user's models.
    return withUserLLM(db, r.user.id, () => next());
  });

  const Credentials = z.object({
    email: z.string().trim().email("Enter a valid email").max(320),
    password: z.string().min(8, "Password must be at least 8 characters").max(200),
  });

  app.post("/api/auth/signup", async (c) => {
    const b = await body(c, Credentials.extend({ name: z.string().trim().max(200).optional() }));
    const user = await createPasswordUser(db, b);
    if (!user) throw bad("An account with that email already exists", 409);
    setSession(c, await createSession(db, user.id, c.req.header("user-agent")));
    void sendVerification(user).catch(() => undefined);
    return c.json({ user: publicUser(user) }, 201);
  });

  app.post("/api/auth/login", async (c) => {
    const b = await body(c, z.object({ email: z.string().trim().max(320), password: z.string().max(200) }));
    // authenticate() runs scrypt whether or not the user exists, so both failures take the same time.
    const user = await authenticate(db, b.email, b.password);
    if (!user) throw bad("Wrong email or password", 401);
    setSession(c, await createSession(db, user.id, c.req.header("user-agent")));
    return c.json({ user: publicUser(user) });
  });

  app.post("/api/auth/logout", async (c) => {
    await revokeSession(db, getCookie(c, SESSION_COOKIE));
    clearSession(c);
    return c.body(null, 204);
  });

  // Permanently deletes the signed-in user and all their data. Needs a real session cookie, never the DEFAULT_USER_EMAIL fallback.
  app.delete("/api/auth/account", async (c) => {
    const r = await resolveUser(c);
    if (!r) throw bad("Not signed in", 401);
    if (r.via !== "session") throw bad("Deleting an account needs a signed-in session", 403);
    const b = await body(c, z.object({ confirm: z.string().max(320) }));
    if (b.confirm.trim().toLowerCase() !== r.user.email.toLowerCase()) throw bad("Type your account email to confirm", 400);
    const counts = await deleteUserAccount(db, r.user.id, { artifactsRoot });
    console.log(`[api] deleted account ${r.user.id}: ${JSON.stringify(counts)}`);
    clearSession(c);
    return c.body(null, 204);
  });

  // The signed-in person behind this request's own session cookie (not the dev fallback user).
  const ownSession = async (c: Context) => {
    const token = getCookie(c, SESSION_COOKIE);
    const user = await getSessionUser(db, token);
    if (!user || !token) throw bad("Not signed in", 401);
    return { user, token };
  };
  const NewPassword = z.string().min(8, "Password must be at least 8 characters").max(200);

  // Always the same answer, so the form cannot be used to find out which addresses have an account.
  app.post("/api/auth/forgot-password", async (c) => {
    const { email } = await body(c, z.object({ email: z.string().trim().email("Enter a valid email").max(320) }));
    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    if (user?.passwordHash) void sendMail(user.email, resetEmail(linkTo("reset-password", await issueAuthToken(db, user.id, "reset"))));
    return c.json({ ok: true });
  });

  app.post("/api/auth/reset-password", async (c) => {
    const b = await body(c, z.object({ token: z.string().min(10).max(200), password: NewPassword }));
    const done = await resetPassword(db, b.token, b.password);
    if (!done) throw bad("This reset link is invalid or has expired. Ask for a new one.", 400);
    clearSession(c);
    return c.json({ ok: true });
  });

  app.post("/api/auth/change-password", async (c) => {
    const { user, token } = await ownSession(c);
    const b = await body(c, z.object({ current: z.string().max(200), next: NewPassword }));
    if (b.current === b.next) throw bad("Choose a password different from the current one", 400);
    const r = await changePassword(db, user.id, b.current, b.next, sha256(token));
    if (r === "no_password") throw bad("This account has no password to change", 400);
    if (r === "wrong_password") throw bad("Your current password is not right", 400);
    return c.json({ ok: true });
  });

  app.post("/api/auth/resend-verification", async (c) => {
    const { user } = await ownSession(c);
    if (!user.emailVerifiedAt) await sendVerification(user);
    return c.json({ ok: true, verified: Boolean(user.emailVerifiedAt) });
  });

  // Opened from the email link, before or without a session.
  app.post("/api/auth/verify-email", async (c) => {
    const { token } = await body(c, z.object({ token: z.string().min(10).max(200) }));
    const userId = await consumeAuthToken(db, token, "verify");
    if (!userId || !(await markEmailVerified(db, userId))) throw bad("This confirmation link is invalid or has expired. Request a new one from Settings.", 400);
    return c.json({ ok: true });
  });

  app.get("/api/auth/sessions", async (c) => {
    const { user, token } = await ownSession(c);
    return c.json((await listSessions(db, user.id, token)).map((s) => ({
      id: s.id, current: s.current, device: describeDevice(s.userAgent), createdAt: s.createdAt, expiresAt: s.expiresAt,
    })));
  });

  app.post("/api/auth/sessions/revoke-others", async (c) => {
    const { user, token } = await ownSession(c);
    return c.json({ revoked: await revokeOtherSessions(db, user.id, token) });
  });

  app.delete("/api/auth/sessions/:id", async (c) => {
    const { user, token } = await ownSession(c);
    const id = c.req.param("id");
    if (!uuidOk(id)) throw bad("Session not found", 404);
    const own = (await listSessions(db, user.id, token)).find((s) => s.id === id);
    if (own?.current) throw bad("This is the session you are using. Use Log out instead.", 400);
    if (!(await revokeSessionById(db, user.id, id))) throw bad("Session not found", 404);
    return c.body(null, 204);
  });

  app.get("/api/auth/session", async (c) => {
    const r = await resolveUser(c);
    if (!r) throw bad("Not signed in", 401);
    return c.json({ user: publicUser(r.user), via: r.via });
  });

  // ---------- meta ----------
  app.get("/api/health", (c) => c.json({
    ok: true, time: new Date().toISOString(), llm: resolveProvider(),
    // Process-level default per tier (hosted env or local Ollama); users with their own key override it. Never includes keys.
    models: Object.fromEntries((["quality", "bulk"] as const).map((t) => {
      const llm = processLLM(t);
      return [t, { mode: modeOf(llm), model: llm.available ? llm.model : null }];
    })),
    localOnly: localOnly(),
    embeddedWorker: process.env.EMBED_WORKER === "1",
    integrations: { parallel: Boolean(process.env.PARALLEL_API_KEY), exa: Boolean(process.env.EXA_API_KEY), composio: composioAvailable(), telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN), email: mailerState().mode !== "console" && !mailerState().blockedBy },
    allowRealSubmit: process.env.ALLOW_REAL_SUBMIT === "true",
  }));

  // ---------- profile + graph ----------
  app.get("/api/me", async (c) => {
    const user = c.get("user");
    return c.json({ user: publicUser(user), profile: await getProfile(db, user.id) });
  });

  app.put("/api/profile", async (c) => {
    const user = c.get("user");
    const b = await body(c, ProfileBody);
    const current = await getProfile(db, user.id);
    const [profile] = await db.update(profiles).set(buildProfilePatch(current, b)).where(eq(profiles.userId, user.id)).returning();
    let u = user;
    if (b.name !== undefined) [u] = await db.update(users).set({ name: b.name }).where(eq(users.id, user.id)).returning();
    return c.json({ user: publicUser(u), profile });
  });

  const saveResumeText = async (c: Context, userId: string, text: string, links: ExtractedLink[] = [], replace = false) => {
    // replace: this resume supersedes the earlier ones, so what they said (and this one no longer does) is forgotten.
    if (replace) await clearResumeNodes(db, userId);
    const result = await ingestResume(db, userId, text, { links });
    await db.update(profiles).set({ rawResumeText: text, updatedAt: new Date() }).where(eq(profiles.userId, userId));
    await rescore(c, userId);
    // The user's first resume document, so the resume studio has something to edit right away. Best effort.
    await ensureResumeDoc(db, userId).catch((e) => console.warn(`[api] could not create the first resume document: ${(e as Error).message}`));
    return result;
  };

  app.post("/api/profile/resume", async (c) => {
    const { text, replace } = await body(c, z.object({ text: z.string().min(20, "Paste the full resume text").max(200_000, "That is longer than any resume: paste just the resume"), replace: z.boolean().optional() }));
    return c.json(await saveResumeText(c, c.get("user").id, text, [], replace ?? false));
  });

  app.post("/api/profile/resume-file",
    bodyLimit({ maxSize: MAX_RESUME_BYTES + 64 * 1024, onError: () => { throw bad("File too large (10 MB max)", 413); } }),
    async (c) => {
      const form = await c.req.parseBody().catch(() => { throw bad("Expected multipart/form-data with a \"file\" field"); });
      const file = form.file;
      if (!(file instanceof File)) throw bad("Expected multipart/form-data with a \"file\" field");
      if (file.size > MAX_RESUME_BYTES) throw bad("File too large (10 MB max)", 413);
      const kind = resumeKind(file.name, file.type);
      if (!kind) throw bad("Unsupported file type; upload a PDF, DOCX or TXT", 415);
      let doc: ExtractedResume;
      try {
        doc = await extractResumeFile(kind, new Uint8Array(await file.arrayBuffer()));
      } catch (err) {
        throw bad(`Could not read the ${kind.toUpperCase()}: ${(err as Error).message}`, 422);
      }
      if (!doc.hadTextLayer && doc.text.length < 20) throw bad(doc.error ?? SCANNED_PDF_ERROR, 422);
      if (doc.text.length < 20) throw bad("No text found in the file", 422);
      const result = await saveResumeText(c, c.get("user").id, doc.text, doc.links);
      return c.json({
        ...result, extractedChars: doc.text.length, pages: doc.pages, layout: doc.layout, hadTextLayer: doc.hadTextLayer,
      });
    });

  // ---------- onboarding ----------
  app.get("/api/onboarding", async (c) => {
    const profile = await getProfile(db, c.get("user").id);
    return c.json({ step: profile.onboarding?.step ?? "resume", profile });
  });

  app.put("/api/onboarding", async (c) => {
    const user = c.get("user");
    const { step, data } = await body(c, z.object({ step: z.enum(ONBOARDING_STEPS), data: z.record(z.string(), z.unknown()).optional() }));
    const r = STEP_SCHEMAS[step].safeParse(data ?? {});
    if (!r.success) throw bad(r.error.issues.map((i) => `data.${i.path.join(".") || step}: ${i.message}`).join("; "));
    const { text, ...fields } = r.data as Record<string, unknown> & { text?: string };
    if (step === "resume" && typeof text === "string") await saveResumeText(c, user.id, text);
    const current = await getProfile(db, user.id);
    const patch = { ...buildProfilePatch(current, fields), onboarding: advanceOnboarding(current.onboarding, step) };
    const [profile] = await db.update(profiles).set(patch).where(eq(profiles.userId, user.id)).returning();
    if (profile.onboarding.step === "done" && current.onboarding?.step !== "done") await rescore(c, user.id);
    return c.json({ step: profile.onboarding.step, profile });
  });

  app.get("/api/graph", async (c) => c.json(await getGraph(db, c.get("user").id)));

  // Retract one claim: the node and its edges go, and matches are rescored without it.
  app.delete("/api/graph/nodes/:id", async (c) => {
    const id = c.req.param("id");
    if (!uuidOk(id) || !(await deleteGraphNode(db, c.get("user").id, id))) throw bad("Not found", 404);
    await rescore(c, c.get("user").id);
    return c.body(null, 204);
  });

  app.get("/api/graph/export", async (c) => {
    const data = await exportGraph(db, c.get("user").id);
    c.header("content-disposition", `attachment; filename="jobgraph-export-${data.exportedAt.slice(0, 10)}.json"`);
    c.header("cache-control", "no-store");
    return c.body(JSON.stringify(data, null, 2), 200, { "content-type": "application/json; charset=utf-8" });
  });

  // ---------- model (Nori's hosted model serves every account; no keys to manage) ----------
  /** Which model does the work for this user, and today's token use against the daily allowance. */
  app.get("/api/settings/model", async (c) => c.json(await modelSettings(db, c.get("user").id)));

  /**
   * Operator-only wiring check for error reporting: sends one message to Sentry and waits for delivery. Allowed for the
   * account named by MCP_USER_EMAIL (the operator), so a stranger cannot fill the project with noise.
   */
  app.post("/api/settings/error-reporting/test", async (c) => {
    const user = c.get("user");
    const operator = process.env.MCP_USER_EMAIL?.trim().toLowerCase();
    if (!operator || user.email.toLowerCase() !== operator) throw bad("Only the operator account can run this check", 403);
    if (!sentryEnabled()) throw bad("Error reporting is not set up on this server (SENTRY_DSN_API)", 503);
    const delivered = await sentrySelfTest();
    return c.json({ sent: true, delivered });
  });

  // ---------- lanes ----------
  const lanesOf = async (userId: string) => {
    const p = await getProfile(db, userId);
    const stored = storedLanes(p);
    if (stored.length) return stored;
    return (p.preferences as Preferences).titles?.length ? effectiveLanes(p) : [];
  };
  app.get("/api/lanes", async (c) => c.json(await lanesOf(c.get("user").id)));

  app.put("/api/lanes", async (c) => {
    const user = c.get("user");
    const input = await body(c, z.array(LaneInput).max(20, "At most 20 lanes"));
    const lanes = normalizeLanes(input);
    const p = await getProfile(db, user.id);
    await db.update(profiles).set({ preferences: { ...(p.preferences as Preferences), lanes }, updatedAt: new Date() }).where(eq(profiles.userId, user.id));
    return c.json(lanes);
  });

  app.post("/api/graph/facts", async (c) => {
    const { text } = await body(c, z.object({ text: z.string().min(1, "Write the fact first").max(4000, "Keep a fact under 4000 characters") }));
    const result = await addFact(db, c.get("user").id, text);
    await rescore(c, c.get("user").id);
    return c.json(result);
  });

  // ---------- jobs ----------
  app.get("/api/jobs", async (c) => {
    const user = c.get("user");
    const q = c.req.query("q")?.trim();
    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50) || 50, 1), 500);
    const minScore = c.req.query("minScore") !== undefined ? Number(c.req.query("minScore")) : undefined;
    const status = c.req.query("status");
    if (status && !(STATUS_FILTERS as readonly string[]).includes(status)) throw bad(`status must be one of ${STATUS_FILTERS.join(", ")}`);
    const hasApp = db.select({ x: applications.id }).from(applications).where(and(eq(applications.userId, user.id), eq(applications.jobId, jobs.id)));
    const where: SQL[] = [];
    if (q) where.push(or(ilike(jobs.title, `%${q}%`), ilike(jobs.companyName, `%${q}%`))!);
    if (minScore !== undefined && !Number.isNaN(minScore)) where.push(gte(matches.score, minScore));
    if (status === "open") where.push(isNull(jobs.closedAt));
    if (status === "closed") where.push(isNotNull(jobs.closedAt));
    if (status === "new") where.push(notExists(hasApp));
    if (status === "applied") where.push(sql`exists (${hasApp})`);
    const select = () => db.select({ job: jobs, match: matches, application: { id: applications.id, status: applications.status } }).from(jobs)
      .leftJoin(matches, and(eq(matches.jobId, jobs.id), eq(matches.userId, user.id)))
      .leftJoin(applications, and(eq(applications.jobId, jobs.id), eq(applications.userId, user.id)))
      .where(where.length ? and(...where) : undefined)
      .orderBy(sql`${matches.score} desc nulls last`, sql`${jobs.postedAt} desc nulls last`, desc(jobs.firstSeenAt))
      .limit(limit);
    let rows = await select();
    // Score unscored rows on this page (capped) so a fresh account never sees a wall of 0%.
    const unscored = rows.filter((r) => !r.match && !r.job.closedAt).slice(0, LAZY_MATCH_CAP).map((r) => r.job.id);
    if (unscored.length) {
      const r = await computeMatchesForUser(db, user.id, { jobIds: unscored, limit: LAZY_MATCH_CAP });
      if (r.computed) rows = await select();
    }
    return c.json(rows.map((r) => ({ job: slimJob(r.job), match: r.match, application: r.application?.id ? r.application : null })));
  });

  app.post("/api/jobs/discover", async (c) => {
    const q = await body(c, DiscoverBody);
    const res = await findAndRank(db, c.get("user").id, q);
    return c.json({ added: res.added, heldOnly: res.heldOnly ?? false, jobs: res.jobs.map((r) => ({ job: slimJob(r.job), match: r.match })) });
  });

  app.post("/api/jobs/url", async (c) => {
    const { url } = await body(c, z.object({ url: z.string().url() }));
    // Whatever is wrong with the link is the person's to fix: answer 422 with the reason rather than a 500.
    const { job, added } = await addJobFromUrl(db, url).catch((err) => { throw bad(err instanceof Error ? err.message : "Could not read that link", 422); });
    const [ranked] = await matchJobs(db, c.get("user").id, [job.id]);
    return c.json({ job: ranked?.job ?? job, match: ranked?.match ?? null, added });
  });

  // ---------- companies: the boards Nori watches, and the ones a user follows ----------
  app.get("/api/companies", async (c) => {
    const n = (k: string, d: number, max: number) => Math.min(max, Math.max(0, Number.parseInt(c.req.query(k) ?? "", 10) || d));
    return c.json(await listCompanies(db, c.get("user").id, {
      q: c.req.query("q") ?? undefined, followedOnly: c.req.query("followed") === "1", limit: n("limit", 60, 200), offset: n("offset", 0, 100_000),
    }));
  });

  const BoardRef = z.object({ atsType: z.enum(ATS_TYPES), token: z.string().min(1).max(200) });

  app.post("/api/companies/follow", async (c) => {
    const { atsType, token } = await body(c, BoardRef);
    if (!(await followCompany(db, c.get("user").id, atsType, token))) throw bad("Nori is not watching that company yet", 404);
    return c.json({ ok: true });
  });

  app.delete("/api/companies/follow", async (c) => {
    const { atsType, token } = await body(c, BoardRef);
    await unfollowCompany(db, c.get("user").id, atsType, token);
    return c.body(null, 204);
  });

  // Paste a company's careers page or a posting link: find its job board, read it, and follow the company.
  app.post("/api/companies/detect", async (c) => {
    const { url } = await body(c, z.object({ url: z.string().trim().url().max(2000) }));
    const user = c.get("user");
    const found = await detectBoard(url).catch((err) => { throw bad(err instanceof Error ? err.message : "Could not read that link", 422); });
    if (!found) {
      // Fallback: check if the careers page directly publishes schema.org/JobPosting JSON-LD listings.
      const ld = await ingestCareerPageJsonLd(db, url).catch(() => ({ added: 0, total: 0, ids: [] as string[], companyName: undefined }));
      if (ld.total > 0) {
        const host = new URL(url).hostname.replace(/^(www|jobs|careers)\./i, "");
        await computeMatchesForUser(db, user.id, { jobIds: ld.ids, limit: Math.max(1, ld.ids.length) }).catch(() => undefined);
        return c.json({ atsType: "web", token: host, name: ld.companyName || prettifyToken(host.split(".")[0] ?? host), openJobs: ld.total, added: ld.added });
      }
      throw bad("No supported job board (Greenhouse, Lever, Ashby, SmartRecruiters, Workday, Workable, Rippling, Recruitee, BambooHR, Pinpoint, Breezy, Dover, Personio or JobPosting markup) was found on that page. Try pasting a link to one of its job postings.", 422);
    }
    const res = await pollTenant(db, found.atsType, found.token).catch(() => { throw bad(`Found the ${found.atsType} board "${found.token}", but its job feed did not answer. Check the link and try again.`, 422); });
    if (res.total === 0) throw bad(`The ${found.atsType} board "${found.token}" has no open jobs right now.`, 422);
    await db.update(companies).set({ name: found.name }).where(and(eq(companies.atsType, found.atsType), eq(companies.atsToken, found.token), sql`${companies.name} = ${prettifyToken(found.token)}`));
    await followCompany(db, user.id, found.atsType, found.token);
    await computeMatchesForUser(db, user.id, { jobIds: res.ids, limit: Math.max(1, res.ids.length) }).catch(() => undefined);
    return c.json({ atsType: found.atsType, token: found.token, name: found.name, openJobs: res.total, added: res.added });
  });

  app.post("/api/jobs/poll", async (c) => {
    const { atsType, token } = await body(c, z.object({ atsType: z.enum(ATS_TYPES), token: z.string().min(1) }));
    const res = await pollTenant(db, atsType, token);
    // A board can add hundreds of jobs: score them with the instant rules pass, not a model call each.
    await computeMatchesForUser(db, c.get("user").id, { jobIds: res.ids, limit: Math.max(1, res.ids.length) }).catch(() => undefined);
    return c.json(res);
  });

  const jobDetail = async (c: Context<AppEnv>, id: string) => {
    if (!uuidOk(id)) throw bad("Job not found", 404);
    const user = c.get("user");
    const [job] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
    if (!job) throw bad("Job not found", 404);
    const [match] = await db.select().from(matches).where(and(eq(matches.jobId, id), eq(matches.userId, user.id))).limit(1);
    const company = job.companyId ? (await db.select().from(companies).where(eq(companies.id, job.companyId)).limit(1))[0] ?? null
      : (await db.select().from(companies).where(sql`lower(${companies.name}) = ${job.companyName.toLowerCase()}`).limit(1))[0] ?? null;
    const [application] = await db.select().from(applications).where(and(eq(applications.jobId, id), eq(applications.userId, user.id))).limit(1);
    return { job, match: match ?? null, company, application: application ?? null };
  };

  app.get("/api/jobs/:id", async (c) => {
    const d = await jobDetail(c, c.req.param("id"));
    if (!d.match) {
      const [ranked] = await matchJobs(db, c.get("user").id, [d.job.id]);
      return c.json({ ...d, job: ranked?.job ?? d.job, match: ranked?.match ?? null });
    }
    // Scored with the instant rules pass: let the model read this posting properly in the background for next time.
    if (d.job.requirements?.via === "heuristic") void matchJobs(db, c.get("user").id, [d.job.id]).catch(() => undefined);
    return c.json(d);
  });

  app.post("/api/jobs/:id/research", async (c) => {
    const d = await jobDetail(c, c.req.param("id"));
    return c.json({ research: await researchCompany(db, d.job.companyName, d.company?.domain ?? undefined) });
  });

  app.get("/api/jobs/:id/company", async (c) => {
    const d = await jobDetail(c, c.req.param("id"));
    const research = d.company?.research ?? (c.req.query("refresh") !== "0" ? await researchCompany(db, d.job.companyName, d.company?.domain ?? undefined) : null);
    return c.json({ company: d.company, research });
  });

  // ---------- applications ----------
  app.post("/api/applications", async (c) => {
    const { jobId } = await body(c, z.object({ jobId: z.string().uuid() }));
    const user = c.get("user");
    const [job] = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!job) throw bad("Job not found", 404);
    const created = await createApplication(db, user.id, jobId);
    await kick(c, () => runApplication(db, created.id, deps));
    return c.json(await loadApp(c, created.id), 201);
  });

  app.get("/api/applications", async (c) => {
    const user = c.get("user");
    const statuses = (c.req.query("status") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    for (const s of statuses) if (!(APPLICATION_STATUSES as readonly string[]).includes(s)) throw bad(`Unknown status ${s}`);
    const rows = await db.select({ application: applications, job: jobs, resume: resumes }).from(applications)
      .innerJoin(jobs, eq(jobs.id, applications.jobId))
      .leftJoin(resumes, eq(resumes.id, applications.resumeId))
      .where(and(eq(applications.userId, user.id), statuses.length ? inArray(applications.status, statuses as ApplicationStatus[]) : undefined))
      .orderBy(desc(applications.updatedAt));
    return c.json(rows.map((r) => ({ application: r.application, job: slimJob(r.job), resume: slimResume(r.resume) })));
  });

  app.get("/api/applications/:id", async (c) => {
    const id = c.req.param("id");
    if (!uuidOk(id)) throw bad("Application not found", 404);
    const application = await loadApp(c, id);
    const d = await jobDetail(c, application.jobId);
    const resume = application.resumeId ? (await db.select().from(resumes).where(eq(resumes.id, application.resumeId)).limit(1))[0] ?? null : null;
    const events = (await db.select().from(runEvents).where(eq(runEvents.applicationId, id)).orderBy(asc(runEvents.ts))).map(toRunEvent);
    // What a recruiter would see on this resume for this job (pure and cheap, so it is computed fresh after every edit).
    const [req] = await db.select({ requirements: jobs.requirements }).from(jobs).where(eq(jobs.id, application.jobId)).limit(1);
    const recruiter = resume ? recruiterReview(resume.content, req?.requirements ?? null, { jobTitle: d.job.title, pages: resume.pages }) : null;
    return c.json({ application, job: d.job, resume, events, company: d.company, match: d.match, recruiter });
  });

  app.post("/api/applications/:id/approve-resume", async (c) => {
    const a = await loadApp(c, c.req.param("id"));
    if (!a.resumeId) throw bad("No resume to approve yet", 409);
    await kick(c, () => approveResume(db, a.id, deps));
    return c.json(await loadApp(c, a.id));
  });

  app.post("/api/applications/:id/approve-form", async (c) => {
    let a = await loadApp(c, c.req.param("id"));
    const { answers } = await body(c, z.object({ answers: Answers.optional() }));
    // Answering a question resumes the run in the background, so an approve that follows at once can find the application
    // in the gap before it moves on: still "needs you" with no question left, then queued or filling the form. Wait for it
    // to reach the review instead of refusing a valid request. (A "needs you" with questions still open is a real refusal.)
    const resuming = (x: typeof a) => x.status === "filling" || x.status === "queued" || (x.status === "needs_user" && x.pendingQuestions.length === 0);
    for (const deadline = Date.now() + (opts.approveWaitMs ?? 25_000); resuming(a) && Date.now() < deadline;) {
      await new Promise((r) => setTimeout(r, 250));
      a = await loadApp(c, a.id);
    }
    if (a.status !== "form_review") throw bad(`Application is ${a.status}, not form_review`, 409);
    await kick(c, () => approveForm(db, a.id, deps, answers));
    return c.json(await loadApp(c, a.id));
  });

  app.post("/api/applications/:id/answer", async (c) => {
    const a = await loadApp(c, c.req.param("id"));
    const { answers } = await body(c, z.object({ answers: Answers }));
    // Save the answers and move the application on before replying (quick writes), then run the rest in the background.
    // Replying first and saving later left a window where the very next request still saw the question open.
    const { resume } = await acceptAnswers(db, a.id, answers);
    if (resume) await kick(c, () => runApplication(db, a.id, deps));
    return c.json(await loadApp(c, a.id));
  });

  app.post("/api/applications/:id/skip", async (c) => {
    const a = await loadApp(c, c.req.param("id"));
    await skipApplication(db, a.id);
    return c.json(await loadApp(c, a.id));
  });

  app.post("/api/applications/:id/retry", async (c) => {
    const a = await loadApp(c, c.req.param("id"));
    await kick(c, () => retryApplication(db, a.id, deps, { force: true }));
    return c.json(await loadApp(c, a.id));
  });

  app.get("/api/applications/:id/events", async (c) => {
    const a = await loadApp(c, c.req.param("id"));
    return streamSSE(c, async (stream) => {
      const seen = new Set<string>();
      let lastTs = new Date(0);
      let queue: Promise<void> = Promise.resolve();
      const send = (ev: RunEventRow) => {
        if (seen.has(ev.id)) return;
        seen.add(ev.id);
        const ts = new Date(ev.ts);
        if (ts > lastTs) lastTs = ts;
        queue = queue.then(() => stream.writeSSE({ data: JSON.stringify(ev), id: ev.id })).catch(() => {});
      };
      const off = onRunEvent(a.id, send); // subscribe first so nothing falls between replay and live
      const replay = await db.select().from(runEvents).where(eq(runEvents.applicationId, a.id)).orderBy(asc(runEvents.ts));
      replay.map(toRunEvent).forEach(send);
      // Events written by another process (the worker) only reach us through the table.
      const poll = setInterval(async () => {
        try {
          const rows = await db.select().from(runEvents)
            .where(and(eq(runEvents.applicationId, a.id), gt(runEvents.ts, new Date(lastTs.getTime() - 1000)))).orderBy(asc(runEvents.ts));
          rows.map(toRunEvent).forEach(send);
        } catch { /* db busy; next tick */ }
      }, 2000);
      const heartbeat = setInterval(() => { queue = queue.then(() => stream.write(": ping\n\n")).then(() => {}).catch(() => {}); }, 15_000);
      await new Promise<void>((resolve) => stream.onAbort(resolve));
      off(); clearInterval(poll); clearInterval(heartbeat);
    });
  });

  // ---------- resume studio: templates, library, exports, tailored edits ----------
  mountFontRoute(app);
  mountResumeRoutes(app, { db, deps });

  // ---------- resumes + artifacts ----------
  app.get("/api/resumes/:id", async (c) => {
    const raw = c.req.param("id");
    const m = /^(.+?)(?:\.(pdf|html))?$/.exec(raw)!;
    const [id, ext] = [m[1], m[2]];
    if (!uuidOk(id)) throw bad("Resume not found", 404);
    const user = c.get("user");
    const [r] = await db.select().from(resumes).where(and(eq(resumes.id, id), eq(resumes.userId, user.id))).limit(1);
    if (!r) throw bad("Resume not found", 404);
    if (ext === "pdf") {
      if (!r.pdfPath) throw bad("Resume has no PDF", 404);
      return sendFile(c, r.pdfPath, "application/pdf");
    }
    if (ext === "html") return c.html(r.html ?? "");
    return c.json(r);
  });

  app.get("/api/artifacts/*", async (c) => {
    const rel = decodeURIComponent(c.req.path.replace(/^\/api\/artifacts\/?/, ""));
    if (!rel || rel.includes("\0")) throw bad("File not found", 404);
    // files live under <applicationId>/...; only the application's owner may read them
    const appId = rel.split("/")[0];
    const owned = uuidOk(appId) && (await db.select({ id: applications.id }).from(applications).where(and(eq(applications.id, appId), eq(applications.userId, c.get("user").id))).limit(1)).length > 0;
    if (!owned) throw bad("File not found", 404);
    const file = path.resolve(artifactsRoot, rel);
    const inside = path.relative(artifactsRoot, file);
    if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) throw bad("File not found", 404);
    return sendFile(c, file);
  });

  // ---------- inbox, tracker, channels, integrations ----------
  app.get("/api/inbox", async (c) => {
    const user = c.get("user");
    const limit = Math.min(Number(c.req.query("limit") ?? 100) || 100, 500);
    // Non-job mail is kept only as an empty marker (see syncInbox); it is not the person's inbox to show.
    return c.json(await db.select().from(inboxMessages).where(and(eq(inboxMessages.userId, user.id), ne(inboxMessages.bodyText, "")))
      .orderBy(desc(inboxMessages.receivedAt)).limit(limit));
  });

  app.post("/api/inbox/sync", async (c) => {
    if (!composioAvailable()) throw bad("COMPOSIO_API_KEY is not set; connect Gmail through Composio first", 503);
    return c.json(await syncInbox(db, c.get("user").id));
  });

  app.get("/api/tracker/stats", async (c) => {
    const user = c.get("user");
    const rows = await db.select({ status: applications.status, n: sql<number>`count(*)::int` }).from(applications)
      .where(eq(applications.userId, user.id)).groupBy(applications.status);
    const byStatus: Record<string, number> = {};
    for (const r of rows) byStatus[r.status] = Number(r.n);
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    const countWhere = async (cond: SQL | undefined) => Number((await db.select({ n: sql<number>`count(*)::int` }).from(applications)
      .where(and(eq(applications.userId, user.id), cond)))[0]?.n ?? 0);
    const thisWeek = {
      applied: await countWhere(gte(applications.submittedAt, weekAgo)),
      replied: await countWhere(and(inArray(applications.status, ["replied", "interview", "offer", "rejected"]), gte(applications.updatedAt, weekAgo))),
      interview: await countWhere(and(eq(applications.status, "interview"), gte(applications.updatedAt, weekAgo))),
    };
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
    return c.json({ byStatus, thisWeek, total });
  });

  app.post("/api/tracker/sync-sheet", async (c) => {
    if (!composioAvailable()) throw bad("COMPOSIO_API_KEY is not set; connect Google Sheets through Composio first", 503);
    return c.json(await syncTrackerSheet(db, c.get("user").id));
  });

  // The dashboard chat keeps its memory in a "web" channel row; it is not a push channel, so it is not listed.
  app.get("/api/channels", async (c) => c.json((await db.select().from(channels).where(eq(channels.userId, c.get("user").id)).orderBy(asc(channels.createdAt)))
    .filter((r) => r.kind !== "web")));

  app.post("/api/channels", async (c) => {
    const b = await body(c, z.object({ kind: z.enum(["slack", "telegram", "whatsapp", "email"]), address: z.string().min(1).max(320), meta: z.record(z.string(), z.unknown()).optional() }));
    const user = c.get("user");
    // An address belongs to whoever linked it first. Re-pointing someone else's chat at this account would send their
    // commands here and this account's notifications (resumes, job details) to their phone.
    const [taken] = await db.select({ userId: channels.userId }).from(channels).where(and(eq(channels.kind, b.kind), eq(channels.address, b.address))).limit(1);
    if (taken && taken.userId !== user.id) throw bad("That address is already linked to another account", 409);
    // Email notifications go only to the account's own address.
    if (b.kind === "email" && b.address.trim().toLowerCase() !== user.email.toLowerCase()) throw bad("Email notifications go to your account's own address", 400);
    const [row] = await db.insert(channels).values({ userId: user.id, kind: b.kind, address: b.address, meta: b.meta ?? {} })
      .onConflictDoUpdate({ target: [channels.kind, channels.address], set: { meta: b.meta ?? {} }, setWhere: eq(channels.userId, user.id) }).returning();
    if (!row) throw bad("That address is already linked to another account", 409);
    return c.json(row, 201);
  });

  // ---------- linking a Telegram chat ----------
  /** Whether the bot is set up, its handle, and whether this account has a chat linked. */
  app.get("/api/channels/telegram", async (c) => {
    const user = c.get("user");
    const configured = Boolean(process.env.TELEGRAM_BOT_TOKEN);
    const [linked] = await db.select({ id: channels.id }).from(channels).where(and(eq(channels.userId, user.id), eq(channels.kind, "telegram"))).limit(1);
    return c.json({ configured, botUsername: configured ? await telegramBotUsername() : null, linked: Boolean(linked) });
  });

  /** A one-time code (15 minutes) the person sends to the bot; the chat it arrives from is then linked to this account. */
  app.post("/api/channels/telegram/link", async (c) => {
    if (!process.env.TELEGRAM_BOT_TOKEN) throw bad("Telegram is not set up on this server (TELEGRAM_BOT_TOKEN)", 503);
    const { code, expiresAt } = await issueChannelLinkCode(db, c.get("user").id);
    const botUsername = await telegramBotUsername();
    return c.json({ code, expiresAt: expiresAt.toISOString(), botUsername, link: botUsername ? `https://t.me/${botUsername}?start=${code}` : null });
  });

  app.delete("/api/channels/:id", async (c) => {
    const id = c.req.param("id");
    if (!uuidOk(id)) throw bad("Channel not found", 404);
    const rows = await db.delete(channels).where(and(eq(channels.id, id), eq(channels.userId, c.get("user").id))).returning();
    if (!rows.length) throw bad("Channel not found", 404);
    return c.json({ deleted: true });
  });

  app.get("/api/integrations", async (c) => {
    if (!composioAvailable()) return c.json(TOOLKITS.map((toolkit) => ({ toolkit, connected: false, available: false })));
    try {
      return c.json(await listConnections(c.get("user").id));
    } catch (err) {
      // A bad or revoked Composio key must not take the settings page down; report it per toolkit instead.
      const message = (err as Error).message.includes("Invalid API key") ? "Composio rejected COMPOSIO_API_KEY" : (err as Error).message.slice(0, 160);
      return c.json(TOOLKITS.map((toolkit) => ({ toolkit, connected: false, error: message })));
    }
  });

  app.post("/api/integrations/:toolkit/connect", async (c) => {
    const toolkit = c.req.param("toolkit");
    if (!(TOOLKITS as readonly string[]).includes(toolkit)) throw bad(`Unknown toolkit ${toolkit}; expected one of ${TOOLKITS.join(", ")}`);
    if (!composioAvailable()) throw bad("COMPOSIO_API_KEY is not set", 503);
    return c.json(await connectToolkit(c.get("user").id, toolkit, `${webUrl.replace(/\/$/, "")}/settings`));
  });

  // ---------- autonomous agent ----------
  const notify = opts.notify ?? ((userId: string, msg: OutboundMessage) => sendToUser(db, userId, msg));
  const chatAgent = createAgent(db, { runner: deps, notify });
  const chatAgentInline = createAgent(db, { runner: deps, notify, inline: true });
  const tickMinutes = () => Number(process.env.AGENT_TICK_MINUTES ?? 20) || 20;

  app.get("/api/agent/activity", async (c) => {
    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50) || 50, 1), 500);
    const rows = await getActivity(db, c.get("user").id, { limit });
    return c.json(rows.map((r) => ({
      id: r.id, ts: r.ts.toISOString(), kind: r.kind, applicationId: r.applicationId ?? undefined, jobId: r.jobId ?? undefined,
      message: r.message, data: r.data,
    })));
  });

  app.get("/api/agent/status", async (c) => {
    const user = c.get("user");
    const profile = await getProfile(db, user.id);
    const lastTickAt = (profile.preferences as Preferences).agent?.lastTickAt ?? null;
    const [{ n: usedToday }] = await db.select({ n: sql<number>`count(*)::int` }).from(applications)
      .where(and(eq(applications.userId, user.id), gte(applications.createdAt, startOfDay(new Date()))));
    const chs = await db.select({ kind: channels.kind, address: channels.address }).from(channels).where(eq(channels.userId, user.id)).orderBy(asc(channels.createdAt));
    const waiting = await db.select({ application: applications, title: jobs.title, companyName: jobs.companyName, atsScore: resumes.atsScore, changes: resumes.changes })
      .from(applications).innerJoin(jobs, eq(jobs.id, applications.jobId)).leftJoin(resumes, eq(resumes.id, applications.resumeId))
      .where(and(eq(applications.userId, user.id), inArray(applications.status, ["resume_review", "form_review"]))).orderBy(desc(applications.updatedAt));
    const since = startOfDay(new Date());
    const perLane = await queuedTodayByLane(db, user.id, since);
    const lanes = effectiveLanes(profile).map((l) => ({ id: l.id, name: l.name, enabled: l.enabled, queuedToday: perLane.get(l.id) ?? 0, ...(l.implicit ? { implicit: true } : {}) }));
    const mode = (await modelSettings(db, user.id)).mode;
    return c.json({
      mode, lanes,
      lastTickAt,
      nextTickAt: lastTickAt ? new Date(Date.parse(lastTickAt) + tickMinutes() * 60_000).toISOString() : null,
      tickMinutes: tickMinutes(),
      dailyCap: profile.autoApplyDailyCap, usedToday: Number(usedToday), minScore: profile.autoApplyMinScore,
      autoApprove: profile.resumeAutoApprove, reviewBeforeSubmit: profile.reviewBeforeSubmit,
      autopilot: profile.autopilot, autopilotTrust: { approved: await countHumanApprovals(db, user.id), needed: AUTOPILOT_MIN_HUMAN_APPROVALS },
      /** False means every "submitted" application is a dry run: the form is filled and stopped, nothing is sent. */
      liveSubmit: process.env.ALLOW_REAL_SUBMIT === "true",
      channels: chs.filter((ch) => ch.kind !== "web"),
      awaitingReview: waiting.map((w) => ({
        applicationId: w.application.id, status: w.application.status, title: w.title, companyName: w.companyName,
        atsScore: w.atsScore ?? null, changes: w.changes?.length ?? 0,
      })),
    });
  });

  /** One agent cycle for the session user, in-process (the API owns the database). */
  /**
   * ?quick=1 (the Run now button) starts the cycle in the background and answers 202 at once: a cycle can take minutes on a
   * local model, longer than any proxy or browser will wait. The page polls GET /api/agent/tick. Without it the call waits
   * for the whole cycle and returns the summary (scripts, the scheduler's HTTP tick).
   */
  const tickState = new Map<string, { startedAt: string; last?: TickSummary; error?: string }>();
  app.post("/api/agent/tick", async (c) => {
    const user = c.get("user");
    if (!c.req.query("quick")) return c.json(await agentTick(db, user.id, { runner: deps, notify, webUrl }));
    if (!tickRunning(user.id)) {
      const startedAt = new Date().toISOString();
      tickState.set(user.id, { startedAt });
      agentTick(db, user.id, { runner: deps, notify, webUrl, maxAdvance: 0 })
        .then((last) => tickState.set(user.id, { startedAt, last }))
        .catch((e: unknown) => tickState.set(user.id, { startedAt, error: e instanceof Error ? e.message : String(e) }));
    }
    return c.json({ running: true, startedAt: tickState.get(user.id)?.startedAt ?? new Date().toISOString() }, 202);
  });
  app.get("/api/agent/tick", (c) => {
    const user = c.get("user");
    return c.json({ running: tickRunning(user.id), ...(tickState.get(user.id) ?? {}) });
  });

  app.get("/api/agent/chat", async (c) => {
    const user = c.get("user");
    const rows = await chatHistory(db, "web", user.id, Math.min(Number(c.req.query("limit") ?? 50) || 50, 200));
    return c.json(rows.map((r) => ({ role: r.role, content: r.content, ts: r.ts.toISOString() })));
  });

  /** The same handler the channels use; ?wait=1 awaits runner work before replying (tests, scripts). */
  app.post("/api/agent/chat", async (c) => {
    const b = await body(c, z.object({ text: z.string().trim().min(1).max(4000) }));
    const user = c.get("user");
    const out = await chatOnce(db, c.req.query("wait") ? chatAgentInline : chatAgent, user.id, "web", user.id, b.text);
    return c.json({ reply: out.text, attachments: out.attachments?.map((a) => a.filename) ?? [] });
  });

  // ---------- webhooks ----------
  app.get("/api/webhooks/whatsapp", (c) => {
    if (!opts.router) throw bad("WhatsApp webhook not enabled", 503);
    const challenge = opts.router.whatsapp.verifyWebhook(c.req.query());
    return challenge === null ? c.text("forbidden", 403) : c.text(challenge);
  });

  app.post("/api/webhooks/whatsapp", async (c) => {
    if (!opts.router) throw bad("WhatsApp webhook not enabled", 503);
    if (!process.env.WHATSAPP_APP_SECRET) throw bad("WhatsApp webhook needs WHATSAPP_APP_SECRET", 503);
    const raw = await c.req.text();
    if (!verifyWhatsAppSignature(raw, c.req.header("x-hub-signature-256"))) throw bad("Bad signature", 401);
    let payload: unknown = {};
    try { payload = JSON.parse(raw); } catch { throw bad("Body must be JSON"); }
    const msgs = await opts.router.whatsapp.handleWebhook(payload);
    return c.json({ received: msgs.length });
  });

  if (opts.mcp !== false) mountMcp(app, db, deps, me);

  return app;
}
