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
import { chromium, type Browser, type Page } from "playwright";
import type { DriverContext, DriverResult, FormField, PendingQuestion, Receipt } from "@jobgraph/core";
import { discoverFields, fillForm, findSubmitButton, detectCaptcha, CAPTCHA_QUESTION, PREFERRED_FORM_SELECTORS } from "./generic.js";
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

export async function runApplyFlow(ctx: DriverContext, opts: FlowOptions): Promise<DriverResult> {
  const started = Date.now();
  const preferred = opts.preferredForms ?? PREFERRED_FORM_SELECTORS;
  let browser: Browser | undefined;
  let page: Page | undefined;
  let fields: FormField[] = [];
  const receipt = (extra: Partial<Receipt> & Pick<Receipt, "fields" | "files">): Receipt => ({
    submittedVia: opts.name, dryRun: ctx.dryRun, durationMs: Date.now() - started, ...extra,
  });

  try {
    browser = await chromium.launch({ headless: ctx.headless ?? true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    page = await context.newPage();
    page.setDefaultTimeout(NAV_TIMEOUT);

    ctx.onEvent("navigate", `Opening ${ctx.applyUrl}`);
    try {
      await page.goto(ctx.applyUrl, { waitUntil: "networkidle", timeout: NAV_TIMEOUT });
    } catch (err) {
      // Pages with long-polling never go idle; continue if the document itself loaded.
      if (!page.url() || page.url() === "about:blank") throw err;
      ctx.onEvent("navigate_warn", "Page did not reach network idle; continuing");
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
      const shot = await screenshot(page, ctx, opts.name, "no-form");
      return { outcome: "failed", error: "No application form fields found", screenshotPath: shot };
    }

    const jobContext = await runScript<string>(page, JOB_CONTEXT_SCRIPT).catch(() => "");
    const { filled, pending, files } = await fillForm(page, ctx, fields, jobContext);

    if (!files.length && ctx.resumePdfPath && (await attachResumeFallback(page, ctx))) {
      files.push(ctx.resumePdfPath);
      filled.push({ label: "Resume/CV", value: path.basename(ctx.resumePdfPath), kind: "file" });
      const i = pending.findIndex((p) => p.type === "file" && /resume|cv/i.test(p.label));
      if (i >= 0) pending.splice(i, 1);
    }

    const captcha = await detectCaptcha(page);
    if (captcha) {
      ctx.onEvent("captcha", `CAPTCHA detected (${captcha}); leaving it for the user`);
      pending.push(CAPTCHA_QUESTION);
    }

    const filledShot = await screenshot(page, ctx, opts.name, "filled");

    if (pending.length) {
      ctx.onEvent("needs_user", `${pending.length} question(s) need the user`, { pending });
      return { outcome: "needs_user", pending, receipt: receipt({ fields: filled, files, screenshotPath: filledShot }) };
    }

    if (!submitAllowed(ctx)) {
      ctx.onEvent("submit_skipped", ctx.dryRun ? "Dry run: form filled, not submitted" : "ALLOW_REAL_SUBMIT is not \"true\": form filled, not submitted");
      return { outcome: "filled", fields, receipt: receipt({ fields: filled, files, screenshotPath: filledShot }) };
    }

    const startUrl = page.url();
    const confirmedBefore = CONFIRM_RE.test(await bodyText(page));
    await clickSubmit(page, ctx);
    let state = await waitForAfterSubmit(page, startUrl, 20_000, confirmedBefore);

    if (state === "verify") {
      ctx.onEvent("verification", "Site asked for an emailed verification code");
      const code = await ctx.waitForCode(opts.name);
      if (!code) {
        const shot = await screenshot(page, ctx, opts.name, "verification");
        return {
          outcome: "needs_user",
          pending: [{ label: "Verification code", type: "verification_code", required: true }],
          receipt: receipt({ fields: filled, files, screenshotPath: shot }),
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
      return { outcome: "needs_user", pending: [CAPTCHA_QUESTION], receipt: receipt({ fields: filled, files, screenshotPath: shot }) };
    }

    const confirmationText = (await runScript<string | null>(page, CONFIRMATION_SCRIPT).catch(() => null)) ?? undefined;
    const submittedShot = (await screenshot(page, ctx, opts.name, "submitted")) ?? filledShot;

    if (!confirmationText && state === "errors") {
      return { outcome: "failed", error: "Form reported validation errors after submit", screenshotPath: submittedShot };
    }
    if (!confirmationText) ctx.onEvent("submit_unconfirmed", "Submitted but no confirmation text was found");
    ctx.onEvent("submitted", confirmationText ?? "Submitted");
    return { outcome: "submitted", receipt: receipt({ fields: filled, files, screenshotPath: submittedShot, confirmationText }) };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    ctx.onEvent("error", error);
    const shot = page ? await screenshot(page, ctx, opts.name, "error") : undefined;
    return { outcome: "failed", error, screenshotPath: shot };
  } finally {
    await browser?.close().catch(() => {});
  }
}
