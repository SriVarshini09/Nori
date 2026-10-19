import type { Page } from "playwright";
import type { ApplyDriver, DriverContext, DriverResult } from "@jobgraph/core";
import { runApplyFlow } from "./flow.js";

const GH_URL = /^https?:\/\/(boards|job-boards)(\.eu)?\.greenhouse\.io\/(embed\/job_app\b|[^/?#]+\/jobs\/\d+)/i;

export const GREENHOUSE_FORM_SELECTORS = ["#application_form", "form#application-form", "#application-form", "form[action*='greenhouse']"];

/** Company career pages embed the Greenhouse form in an iframe; open the iframe document directly. */
async function enterEmbed(page: Page, ctx: DriverContext): Promise<void> {
  const src = await page.locator("iframe#grnhse_iframe, iframe[src*='greenhouse.io/embed/job_app']").first()
    .getAttribute("src", { timeout: 1000 }).catch(() => null);
  if (!src) return;
  const url = new URL(src, page.url()).toString();
  ctx.onEvent("navigate", `Opening embedded Greenhouse form ${url}`);
  await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 }).catch(() => {});
}

export class GreenhouseDriver implements ApplyDriver {
  readonly atsType = "greenhouse" as const;

  supports(url: string): boolean {
    if (GH_URL.test(url)) return true;
    try {
      const u = new URL(url);
      return /^https?:$/.test(u.protocol) && u.searchParams.has("gh_jid");
    } catch {
      return false;
    }
  }

  run(ctx: DriverContext): Promise<DriverResult> {
    return runApplyFlow(ctx, { name: "greenhouse", preferredForms: GREENHOUSE_FORM_SELECTORS, beforeDiscover: enterEmbed });
  }
}
