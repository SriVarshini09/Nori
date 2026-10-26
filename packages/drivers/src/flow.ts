/**
 * Shared apply flow used by every driver: open, reveal the form, discover, fill, screenshot,
 * then stop (dryRun / gate / pending) or submit and confirm.
 *
 * Safety: submit is only ever clicked through `clickSubmit`, which re-checks that
 * ctx.dryRun === false AND process.env.ALLOW_REAL_SUBMIT === "true". Password fields are never
 * filled (an account wall returns needs_user), and CAPTCHAs are never solved (needs_user).
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { DriverContext, DriverResult, FormField, PendingQuestion, Receipt } from "@jobgraph/core";
import { discoverFields, fillField, fillForm, findSubmitButton, detectCaptcha, norm, CAPTCHA_QUESTION, PREFERRED_FORM_SELECTORS } from "./generic.js";
import {
  runScript, CONFIRMATION_SCRIPT, JOB_CONTEXT_SCRIPT, CODE_INPUTS_SCRIPT, ERRORS_SCRIPT, PASSWORD_SCRIPT, FORM_VISIBLE_SCRIPT,
} from "./dom.js";

export type FlowOptions = {
  /** submittedVia / screenshot prefix / waitForCode hint. */
  name: string;
  preferredForms?: string[];
  /** Site-specific step before discovery (e.g. jump into an embedded iframe). */
  beforeDiscover?: (page: Page, ctx: DriverContext) => Promise<void>;
};

const NAV_TIMEOUT = 30_000;
const CONFIRM_RE = /thank you|thanks for applying|application (has been |was )?(submitted|received)/i;
/** A page that turns automation away (bot detection, "verify you are human" walls). Nori hands these to the person and never tries to get around them. */
const BLOCKED_RE = /access is temporarily restricted|unusual activity from your (device|network)|automated \(bot\) activity|verify you are (a )?human|are you a robot|checking if the site connection is secure/i;
const VERIFY_RE = /verification code|enter the code|security code|code (was|has been) sent/i;

/** The one and only place the submit gate is decided. */
export function submitAllowed(ctx: Pick<DriverContext, "dryRun">): boolean {
  return ctx.dryRun === false && process.env.ALLOW_REAL_SUBMIT === "true";
}

async function clickSubmit(page: Page, ctx: DriverContext): Promise<string> {
  if (!submitAllowed(ctx)) throw new Error("Refusing to submit: dryRun or ALLOW_REAL_SUBMIT not set");
  const btn = await findSubmitButton(page);
  if (!btn) throw new Error("Submit button not found");
  ctx.onEvent("submit", `Clicking "${btn.label}"`);
  await btn.locator.click();
  return btn.label;
}

async function screenshot(page: Page, ctx: DriverContext, name: string, tag: string): Promise<string | undefined> {
  try {
    await mkdir(ctx.artifactsDir, { recursive: true });
    const file = path.join(ctx.artifactsDir, `${name}-${tag}-${Date.now()}.png`);
    await page.screenshot({ path: file, fullPage: true });
    ctx.onEvent("screenshot", `Saved ${tag} screenshot`, { path: file });
    return file;
  } catch (err) {
    ctx.onEvent("screenshot_error", `Screenshot failed: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

async function bodyText(page: Page): Promise<string> {
  return page.evaluate("document.body ? document.body.innerText : ''").then(String).catch(() => "");
}

/** Poll until the page shows a confirmation, a verification prompt, or validation errors. */
/** confirmedBefore: the page already said "thank you" before submit (e.g. in the job copy), so also require the form to go away. */
async function waitForAfterSubmit(page: Page, startUrl: string, ms: number, confirmedBefore: boolean): Promise<"confirmed" | "verify" | "errors" | "timeout"> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    await page.waitForTimeout(500);
    try {
      const text = await bodyText(page);
      const formGone = (await page.locator("[data-jobgraph-form]").count()) === 0 || page.url() !== startUrl;
      if (CONFIRM_RE.test(text) && (!confirmedBefore || formGone)) return "confirmed";
      if (VERIFY_RE.test(text) && (await runScript<number>(page, CODE_INPUTS_SCRIPT)) > 0) return "verify";
      if ((await runScript<number>(page, ERRORS_SCRIPT)) > 0) return "errors";
      if (page.url() !== startUrl) await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    } catch {
      // Navigation in progress; try again.
    }
  }
  return "timeout";
}

async function enterCode(page: Page, code: string): Promise<void> {
  const n = await runScript<number>(page, CODE_INPUTS_SCRIPT);
  if (n <= 1) {
    await page.locator('[data-jobgraph-code="0"]').fill(code);
    return;
  }
  const chars = code.replace(/\s+/g, "").split("");
  for (let i = 0; i < Math.min(n, chars.length); i++) {
    await page.locator(`[data-jobgraph-code="${i}"]`).fill(chars[i]!);
  }
}

/** Click an "Apply" button/tab/link when the form is not visible yet. */
async function revealForm(page: Page, ctx: DriverContext, preferred: string[]): Promise<void> {
  if (await runScript<boolean>(page, FORM_VISIBLE_SCRIPT, preferred)) return;
  const candidates = [
    page.getByRole("button", { name: /apply/i }),
    page.getByRole("link", { name: /^\s*apply\b/i }),
    page.getByRole("tab", { name: /apply|application/i }),
    page.locator('a[href*="#app"], a[href*="application"]'),
  ];
  for (const c of candidates) {
    const first = c.first();
    if (await first.isVisible().catch(() => false)) {
      ctx.onEvent("reveal_form", "Opening the application form");
      await first.click().catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
      for (let i = 0; i < 20; i++) {
        if (await runScript<boolean>(page, FORM_VISIBLE_SCRIPT, preferred)) return;
        await page.waitForTimeout(250);
      }
    }
  }
}

/** Upload the resume through an "Attach" button + file chooser when no file input was found. */
async function attachResumeFallback(page: Page, ctx: DriverContext): Promise<boolean> {
  const attach = page.locator("[data-jobgraph-form]").getByRole("button", { name: /attach|upload/i }).first();
  if (!(await attach.isVisible().catch(() => false))) return false;
  try {
    const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 5000 }), attach.click()]);
    await chooser.setFiles(ctx.resumePdfPath);
    ctx.onEvent("field_filled", "Attached resume through file chooser", { label: "Resume/CV", kind: "file" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Warm shared Chromium browser pool (one per headless setting) so form filling does not pay
 * a 1.5–4s cold browser spawn on every application. Each application runs in its own isolated BrowserContext.
 */
const sharedBrowsers = new Map<boolean, Promise<Browser>>();
let activeContexts = 0;
let browserIdleTimer: ReturnType<typeof setTimeout> | null = null;
const BROWSER_IDLE_MS = 90_000;

async function acquireBrowser(headless: boolean): Promise<Browser> {
  if (browserIdleTimer) {
    clearTimeout(browserIdleTimer);
    browserIdleTimer = null;
  }
  let p = sharedBrowsers.get(headless);
  if (!p) {
    p = chromium.launch({ headless }).then((b) => {
      b.on("disconnected", () => {
        if (sharedBrowsers.get(headless) === p) sharedBrowsers.delete(headless);
      });
      return b;
    });
    p.catch(() => {
      if (sharedBrowsers.get(headless) === p) sharedBrowsers.delete(headless);
    });
    sharedBrowsers.set(headless, p);
  }
  const browser = await p;
  if (!browser.isConnected()) {
    sharedBrowsers.delete(headless);
    return acquireBrowser(headless);
  }
  return browser;
}

/**
 * Stage 2: Browserbase CDP support.
 * When BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID (or BROWSER_CDP_URL) are set, connects over CDP
 * and retrieves the Browserbase Live View debugger URL so CAPTCHAs / bot walls can be handed off to the user's phone.
 */
export function browserbaseConfigured(): boolean {
  return Boolean(
    (process.env.BROWSERBASE_API_KEY?.trim() && process.env.BROWSERBASE_PROJECT_ID?.trim()) ||
    process.env.BROWSER_CDP_URL?.trim(),
  );
}

async function createBrowserbaseSession(): Promise<{ browser: Browser; context: BrowserContext; liveViewUrl?: string } | null> {
  const cdpUrl = process.env.BROWSER_CDP_URL?.trim();
  if (cdpUrl) {
    const browser = await chromium.connectOverCDP(cdpUrl);
    const context = browser.contexts()[0] ?? (await browser.newContext({ viewport: { width: 1280, height: 900 } }));
    return { browser, context };
  }
  const apiKey = process.env.BROWSERBASE_API_KEY?.trim();
  const projectId = process.env.BROWSERBASE_PROJECT_ID?.trim();
  if (!apiKey || !projectId) return null;

  const res = await fetch("https://api.browserbase.com/v1/sessions", {
    method: "POST",
    headers: { "x-bb-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({ projectId, keepAlive: true }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Browserbase session creation failed: ${res.status}`);
  const session = (await res.json()) as { id: string; connectUrl?: string };
  const connectUrl = session.connectUrl || `wss://connect.browserbase.com?apiKey=${encodeURIComponent(apiKey)}&sessionId=${encodeURIComponent(session.id)}`;
  const browser = await chromium.connectOverCDP(connectUrl);
  const context = browser.contexts()[0] ?? (await browser.newContext({ viewport: { width: 1280, height: 900 } }));

  let liveViewUrl: string | undefined;
  try {
    const dbgRes = await fetch(`https://api.browserbase.com/v1/sessions/${encodeURIComponent(session.id)}/debug`, {
      headers: { "x-bb-api-key": apiKey },
      signal: AbortSignal.timeout(8_000),
    });
    if (dbgRes.ok) {
      const dbg = (await dbgRes.json()) as { debuggerFullscreenUrl?: string };
      liveViewUrl = dbg.debuggerFullscreenUrl;
    }
  } catch {
    /* live view URL is optional */
  }
  return { browser, context, liveViewUrl };
}
function scheduleBrowserIdleCheck(): void {
  if (activeContexts > 0 || parked.size > 0) return;
  if (browserIdleTimer) clearTimeout(browserIdleTimer);
  browserIdleTimer = setTimeout(() => {
    for (const [k, p] of sharedBrowsers.entries()) {
      sharedBrowsers.delete(k);
      void p.then((b) => b.close()).catch(() => {});
    }
  }, BROWSER_IDLE_MS);
  browserIdleTimer.unref?.();
}

/** Fast DOM-ready navigation: returns as soon as the form (or an embedded ATS iframe) is present, instead of waiting 30s for third-party tracking scripts to go network-idle. */
async function navigateToForm(page: Page, url: string, preferred: string[]): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    const ready = await runScript<boolean>(page, FORM_VISIBLE_SCRIPT, preferred).catch(() => false);
    if (ready) return;
    const hasEmbed = await page.locator("iframe#grnhse_iframe, iframe[src*='greenhouse.io/embed/job_app']").count().catch(() => 0);
    if (hasEmbed > 0) return;
    await page.waitForTimeout(80);
  }
  await page.waitForLoadState("networkidle", { timeout: 2000 }).catch(() => {});
}

/**
 * A filled form kept open between steps. The fill and the send used to be two full runs (open the site, fill every field),
 * so approving took as long as the first fill and an answer to one missing field redid the whole form. Now the page a run
 * leaves behind waits here, keyed by application, and the next run applies only what changed. Kept in memory for a short
 * while and for a few applications at once; anything else, including a server restart, starts from scratch as before.
 */
type Parked = {
  context: BrowserContext; page: Page; fields: FormField[]; filled: Receipt["fields"]; files: string[]; pending: PendingQuestion[];
  /** ctx.answers (normalised by label) the page was filled with, to tell a person's later edit from what is already there. */
  used: Map<string, string>;
  timer: ReturnType<typeof setTimeout>;
};
const PARK_MS = 20 * 60_000;
const PARK_MAX = 3;
const parked = new Map<string, Parked>();

function dropParked(key: string): void {
  const p = parked.get(key);
  if (!p) return;
  parked.delete(key);
  clearTimeout(p.timer);
  void p.context.close().catch(() => {});
  scheduleBrowserIdleCheck();
}

function parkPage(key: string, entry: Omit<Parked, "timer">): void {
  dropParked(key);
  while (parked.size >= PARK_MAX) dropParked(parked.keys().next().value as string);
  const timer = setTimeout(() => dropParked(key), PARK_MS);
  timer.unref?.();
  parked.set(key, { ...entry, timer });
}

function takeParked(key: string): Parked | undefined {
  const p = parked.get(key);
  if (!p) return undefined;
  parked.delete(key);
  clearTimeout(p.timer);
  return p;
}

/** Close every kept page and shared browser (tests, shutdown). */
export async function closeParkedPages(): Promise<void> {
  for (const key of [...parked.keys()]) dropParked(key);
  if (browserIdleTimer) {
    clearTimeout(browserIdleTimer);
    browserIdleTimer = null;
  }
  const closing: Promise<unknown>[] = [];
  for (const [k, p] of sharedBrowsers.entries()) {
    sharedBrowsers.delete(k);
    closing.push(p.then((b) => b.close()).catch(() => {}));
  }
  await Promise.all(closing);
}

/**
 * Carry on from a kept page: type only the answers that are new or changed since it was filled. Returns null when the page
 * cannot be trusted (the form's fields changed, or an edit would not go in), and the caller starts over with a fresh run.
 */
async function continueParked(p: Parked, ctx: DriverContext, preferred: string[]): Promise<{ filled: Receipt["fields"]; files: string[]; pending: PendingQuestion[] } | null> {
  try {
    if (p.page.isClosed()) return null;
    const now = await discoverFields(p.page, preferred);
    const labels = (fs: FormField[]) => fs.map((x) => x.label).sort().join("");
    if (labels(now) !== labels(p.fields)) return null;
    const answers = new Map(Object.entries(ctx.answers ?? {}).map(([k, v]) => [norm(k), v]));
    const filled = p.filled.map((x) => ({ ...x }));
    let applied = 0;
    for (const field of now) {
      if (field.kind === "file") continue;
      const key = norm(field.label);
      const want = answers.get(key);
      if (!want || want === p.used.get(key)) continue;
      const have = filled.find((x) => x.label === field.label);
      if (have?.value === want) continue;
      const actual = await fillField(p.page, field, want);
      if (have) have.value = actual; else filled.push({ label: field.label, value: actual, kind: field.kind });
      ctx.onEvent("field_filled", `Filled "${field.label}"`, { label: field.label, kind: field.kind, source: "answers", reused: true, value: actual.slice(0, 120) });
      applied++;
    }
    const pending = p.pending.filter((q) => !filled.some((x) => x.label === q.label));
    ctx.onEvent("reused_form", `Carried on from the form already filled (${applied} answer${applied === 1 ? "" : "s"} added)`, { applied });
    return { filled, files: p.files, pending };
  } catch {
    return null;
  }
}

export async function runApplyFlow(ctx: DriverContext, opts: FlowOptions): Promise<DriverResult> {
  const started = Date.now();
  const preferred = opts.preferredForms ?? PREFERRED_FORM_SELECTORS;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  /** Set once submit has been clicked: from then on the employer may have the application, and every result says so. */
  let clicked = false;
  let fields: FormField[] = [];
  /** Set when the page is handed to the registry above instead of being closed. */
  let keepOpen = false;
  const receipt = (extra: Partial<Receipt> & Pick<Receipt, "fields" | "files">): Receipt => ({
    submittedVia: opts.name, dryRun: ctx.dryRun, durationMs: Date.now() - started, ...extra,
  });

  activeContexts++;
  try {
    // A page kept from the previous step: carry on from it when it is still the same form.
    const kept = ctx.sessionKey ? takeParked(ctx.sessionKey) : undefined;
    let carried: Awaited<ReturnType<typeof continueParked>> = null;
    if (kept) {
      carried = await continueParked(kept, ctx, preferred);
      if (carried) { context = kept.context; page = kept.page; fields = kept.fields; }
      else { await kept.context.close().catch(() => {}); ctx.onEvent("reuse_skipped", "The kept form could not be reused; filling again from the start"); }
    }
    const used = new Map(Object.entries(ctx.answers ?? {}).map(([k, v]) => [norm(k), v] as [string, string]));
    /** Hand the page to the registry so the next step continues from it (see Parked). */
    const keep = (): void => {
      if (!ctx.sessionKey || !context || !page) return;
      parkPage(ctx.sessionKey, { context, page, fields, filled, files, pending, used });
      keepOpen = true;
    };
    let filled: Receipt["fields"];
    let pending: PendingQuestion[];
    let files: string[];
    let liveViewUrl: string | undefined;
    if (carried) {
      ({ filled, pending, files } = carried);
    } else {
      if (browserbaseConfigured()) {
        const bb = await createBrowserbaseSession().catch(() => null);
        if (bb) {
          context = bb.context;
          liveViewUrl = bb.liveViewUrl;
        }
      }
      if (!context) {
        const browser = await acquireBrowser(ctx.headless ?? true);
        context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      }
      page = context.pages()[0] ?? (await context.newPage());
      page.setDefaultTimeout(NAV_TIMEOUT);

      ctx.onEvent("navigate", `Opening ${ctx.applyUrl}`);
      try {
        await navigateToForm(page, ctx.applyUrl, preferred);
      } catch (err) {
        if (!page.url() || page.url() === "about:blank") throw err;
        ctx.onEvent("navigate_warn", "Page did not finish loading cleanly; continuing");
      }

      if (opts.beforeDiscover) await opts.beforeDiscover(page, ctx);
      await revealForm(page, ctx, preferred);

      if (await runScript<boolean>(page, PASSWORD_SCRIPT)) {
        const shot = await screenshot(page, ctx, opts.name, "account-wall");
        const pending: PendingQuestion[] = [{ label: "Account sign-in or creation required", type: "account", required: true }];
        ctx.onEvent("needs_user", "Site asks for a password; the driver never signs in or creates accounts");
        return { outcome: "needs_user", pending, receipt: receipt({ fields: [], files: [], screenshotPath: shot }) };
      }

      fields = await discoverFields(page, preferred);
      ctx.onEvent("discovered", `Found ${fields.length} fields`, { fields: fields.map((f) => ({ label: f.label, kind: f.kind, required: f.required })) });
      if (!fields.length) {
        if (BLOCKED_RE.test(await bodyText(page))) {
          const shot = await screenshot(page, ctx, opts.name, "blocked");
          ctx.onEvent("needs_user", "The site turned automated access away; Nori does not try to get around that");
          return {
            outcome: "needs_user", receipt: receipt({ fields: [], files: [], screenshotPath: shot }),
            pending: [{ label: "This site blocks automated applications: open the posting and apply yourself", type: "blocked", required: true }],
          };
        }
        const shot = await screenshot(page, ctx, opts.name, "no-form");
        return { outcome: "failed", error: "No application form fields found", screenshotPath: shot };
      }

      const jobContext = await runScript<string>(page, JOB_CONTEXT_SCRIPT).catch(() => "");
      ({ filled, pending, files } = await fillForm(page, ctx, fields, jobContext));

      if (!files.length && ctx.resumePdfPath && (await attachResumeFallback(page, ctx))) {
        files.push(ctx.resumePdfPath);
        filled.push({ label: "Resume/CV", value: path.basename(ctx.resumePdfPath), kind: "file" });
        const i = pending.findIndex((p) => p.type === "file" && /resume|cv/i.test(p.label));
        if (i >= 0) pending.splice(i, 1);
      }
    }
    if (!page || !context) throw new Error("The form page is not open");

    const captcha = await detectCaptcha(page);
    if (captcha) {
      ctx.onEvent("captcha", `CAPTCHA detected (${captcha}); leaving it for the user`, { liveViewUrl });
      pending.push({ ...CAPTCHA_QUESTION, ...(liveViewUrl ? { liveViewUrl } : {}) });
    }

    const filledShot = await screenshot(page, ctx, opts.name, "filled");

    if (pending.length) {
      ctx.onEvent("needs_user", `${pending.length} question(s) need the user`, { pending, liveViewUrl });
      if (!captcha || liveViewUrl) keep();
      return { outcome: "needs_user", pending, receipt: receipt({ fields: filled, files, screenshotPath: filledShot, ...(liveViewUrl ? { liveViewUrl } : {}) }) };
    }

    if (!submitAllowed(ctx)) {
      ctx.onEvent("submit_skipped", ctx.dryRun ? "Dry run: form filled, not submitted" : "ALLOW_REAL_SUBMIT is not \"true\": form filled, not submitted");
      keep();
      return { outcome: "filled", fields, receipt: receipt({ fields: filled, files, screenshotPath: filledShot }) };
    }

    const startUrl = page.url();
    const confirmedBefore = CONFIRM_RE.test(await bodyText(page));
    await clickSubmit(page, ctx);
    clicked = true;
    let state = await waitForAfterSubmit(page, startUrl, 20_000, confirmedBefore);

    if (state === "verify") {
      ctx.onEvent("verification", "Site asked for an emailed verification code");
      const code = await ctx.waitForCode(opts.name);
      if (!code) {
        const shot = await screenshot(page, ctx, opts.name, "verification");
        return {
          outcome: "needs_user",
          pending: [{ label: "Verification code", type: "verification_code", required: true }],
          receipt: { ...receipt({ fields: filled, files, screenshotPath: shot }), submitClicked: true },
        };
      }
      await enterCode(page, code);
      ctx.onEvent("verification", "Entered verification code");
      const verifyUrl = page.url();
      await clickSubmit(page, ctx);
      state = await waitForAfterSubmit(page, verifyUrl, 20_000, confirmedBefore);
    }

    if (await detectCaptcha(page)) {
      const shot = await screenshot(page, ctx, opts.name, "captcha");
      ctx.onEvent("captcha", "CAPTCHA appeared after submit; leaving it for the user");
      return { outcome: "needs_user", pending: [CAPTCHA_QUESTION], receipt: { ...receipt({ fields: filled, files, screenshotPath: shot }), submitClicked: true } };
    }

    const confirmationText = (await runScript<string | null>(page, CONFIRMATION_SCRIPT).catch(() => null)) ?? undefined;
    const submittedShot = (await screenshot(page, ctx, opts.name, "submitted")) ?? filledShot;

    if (!confirmationText && state === "errors") {
      return { outcome: "failed", error: "Form reported validation errors after submit", screenshotPath: submittedShot, submitClicked: true };
    }
    if (!confirmationText && state === "timeout") {
      // No thank-you text and the same form still on the same page: the click most likely did not send it (a step button,
      // a silent validation error). Calling it "submitted" would put a job in the tracker that the employer never got.
      const formStill = (await page.locator("[data-jobgraph-form]").count().catch(() => 0)) > 0 && page.url() === startUrl;
      if (formStill) {
        return { outcome: "failed", screenshotPath: submittedShot, submitClicked: true,
          error: "Clicked submit, but the form is still on the page and no confirmation appeared. It may not have gone through: check the employer's site or your email before trying again." };
      }
    }
    if (!confirmationText) ctx.onEvent("submit_unconfirmed", "Submitted but no confirmation text was found");
    ctx.onEvent("submitted", confirmationText ?? "Submitted");
    return { outcome: "submitted", receipt: receipt({ fields: filled, files, screenshotPath: submittedShot, confirmationText }) };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    ctx.onEvent("error", error);
    const shot = page ? await screenshot(page, ctx, opts.name, "error") : undefined;
    return { outcome: "failed", error, screenshotPath: shot, ...(clicked ? { submitClicked: true } : {}) };
  } finally {
    activeContexts = Math.max(0, activeContexts - 1);
    if (!keepOpen) await context?.close().catch(() => {});
    scheduleBrowserIdleCheck();
  }
}
