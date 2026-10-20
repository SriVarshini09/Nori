/**
 * Lever, Ashby and SmartRecruiters. Each public job page is a description with an "Apply" step in front of the form,
 * so these drivers recognise the URL, open the application step, and hand over to the shared apply flow, which discovers
 * and fills the form by its labels. They carry no site-specific selectors beyond the form root.
 *
 * Not yet exercised against the live sites: a real dry run needs a human-chosen posting (see docs/MORNING.md).
 */
import type { Page } from "playwright";
import type { ApplyDriver, DriverContext, DriverResult } from "@jobgraph/core";
import { runApplyFlow } from "./flow.js";

const NAV_TIMEOUT = 30_000;

const parse = (url: string): URL | null => {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u : null;
  } catch {
    return null;
  }
};

/** The URL of the application form for a Lever posting (…/{company}/{id} -> …/{company}/{id}/apply), or null if it is not one. */
export function leverApplyUrl(url: string): string | null {
  const u = parse(url);
  if (!u || !/^jobs(\.eu)?\.lever\.co$/i.test(u.hostname)) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const [company, id] = parts;
  u.pathname = `/${company}/${id}/apply`;
  u.hash = "";
  return u.toString();
}

/** …/{company}/{id} -> …/{company}/{id}/application for an Ashby posting, or null. */
export function ashbyApplyUrl(url: string): string | null {
  const u = parse(url);
  if (!u || !/^jobs\.ashbyhq\.com$/i.test(u.hostname)) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const [company, id] = parts;
  u.pathname = `/${company}/${id}/application`;
  u.hash = "";
  return u.toString();
}

const isSmartRecruiters = (url: string) => {
  const u = parse(url);
  return Boolean(u && /^(jobs|careers)\.smartrecruiters\.com$/i.test(u.hostname) && u.pathname.split("/").filter(Boolean).length >= 2);
};

async function openUrl(page: Page, ctx: DriverContext, url: string | null) {
  if (!url || page.url() === url) return;
  ctx.onEvent("navigate", `Opening the application form ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
}

export class LeverDriver implements ApplyDriver {
  readonly atsType = "lever" as const;
  supports(url: string) { return leverApplyUrl(url) !== null; }
  run(ctx: DriverContext): Promise<DriverResult> {
    return runApplyFlow(ctx, {
      name: "lever", preferredForms: ["#application-form", "form.application-form", "form[action*='lever']"],
      beforeDiscover: (page) => openUrl(page, ctx, leverApplyUrl(ctx.applyUrl)),
    });
  }
}

export class AshbyDriver implements ApplyDriver {
  readonly atsType = "ashby" as const;
  supports(url: string) { return ashbyApplyUrl(url) !== null; }
  run(ctx: DriverContext): Promise<DriverResult> {
    return runApplyFlow(ctx, {
      name: "ashby", preferredForms: ["form[class*='application' i]", "form:has(input[name='_systemfield_email'])"],
      beforeDiscover: async (page) => {
        await openUrl(page, ctx, ashbyApplyUrl(ctx.applyUrl));
        // The form renders client-side; wait for the first field before discovery looks.
        await page.locator("input[name='_systemfield_email'], input[type=email]").first().waitFor({ timeout: 15_000 }).catch(() => {});
      },
    });
  }
}

export class SmartRecruitersDriver implements ApplyDriver {
  readonly atsType = "smartrecruiters" as const;
  supports(url: string) { return isSmartRecruiters(url); }
  run(ctx: DriverContext): Promise<DriverResult> {
    return runApplyFlow(ctx, {
      name: "smartrecruiters",
      beforeDiscover: async (page) => {
        // The posting page shows the description; "I'm interested" opens the one-click application.
        const btn = page.getByRole("link", { name: /i'?m interested|apply now|apply/i }).first();
        if (await btn.count()) {
          ctx.onEvent("navigate", "Opening the application from the posting");
          await Promise.all([page.waitForLoadState("domcontentloaded").catch(() => {}), btn.click({ timeout: 5000 }).catch(() => {})]);
          await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
        }
      },
    });
  }
}
