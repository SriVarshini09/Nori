import type { Page } from "playwright";
import type { ApplyDriver, DriverContext, DriverResult } from "@jobgraph/core";
import { runApplyFlow } from "./flow.js";

/**
 * Stage 5: Workday Apply Driver (`*.myworkdayjobs.com`, `*.myworkdaysite.com`).
 *
 * Handles revealing the Workday application flow ("Apply" -> "Apply Manually" or "Autofill with Resume")
 * and structured Workday form selectors (`[data-automation-id="applyFlowPage"]`, `[data-automation-id="jobApplicationPage"]`).
 * When an account sign-in/creation wall appears, `runApplyFlow` captures it cleanly and hands off or uses
 * the per-employer ATS account vault after form approval.
 */

const WORKDAY_URL_RE = /^https?:\/\/(?:[\w-]+\.wd[\w-]*\.myworkdayjobs\.com|wd[\w-]*\.myworkdaysite\.com)\//i;

export const WORKDAY_FORM_SELECTORS = [
  '[data-automation-id="applyFlowPage"]',
  '[data-automation-id="jobApplicationPage"]',
  '[data-automation-id="applyFlowMyInfoPage"]',
  '[data-automation-id="applyFlowMyExperiencePage"]',
  "form",
];

async function revealWorkdayForm(page: Page, ctx: DriverContext): Promise<void> {
  const applyBtn = page.locator('[data-automation-id="adventureButton"], a[data-automation-id="applyButton"], button:has-text("Apply")').first();
  if (await applyBtn.isVisible().catch(() => false)) {
    ctx.onEvent("reveal_form", "Clicking Workday Apply button");
    await applyBtn.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
  }
  const manualBtn = page.locator('[data-automation-id="applyManually"], a:has-text("Apply Manually"), button:has-text("Apply Manually"), [data-automation-id="autofillWithResume"]').first();
  if (await manualBtn.isVisible().catch(() => false)) {
    ctx.onEvent("reveal_form", "Selecting Workday manual/autofill entry");
    await manualBtn.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(600);
  }
}

export class WorkdayDriver implements ApplyDriver {
  readonly atsType = "workday" as const;

  supports(url: string): boolean {
    return WORKDAY_URL_RE.test(url);
  }

  run(ctx: DriverContext): Promise<DriverResult> {
    return runApplyFlow(ctx, {
      name: "workday",
      preferredForms: WORKDAY_FORM_SELECTORS,
      beforeDiscover: revealWorkdayForm,
    });
  }
}
