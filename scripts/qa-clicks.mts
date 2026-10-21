/**
 * Click every control on every page, one at a time, on a fresh page each time, and report what a person would complain about:
 *  - a control that does nothing at all (no navigation, no change on the page, no request)
 *  - a click that throws, logs a console error, hits a 4xx/5xx, or lands on an error screen or a 404
 *  - a link whose target does not exist, or an in-page anchor with no target
 *  - a control with no accessible name (an icon with no label)
 * Runs on its own disposable offline stack (fake form driver, nothing leaves the machine), so destructive buttons are safe
 * to press except sign-out and account deletion, which would end the session.
 *   E2E_API_PORT=4300 E2E_WEB_PORT=3300 npx tsx scripts/qa-clicks.mts [--mobile] [--only=/jobs,/agent]
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import { Client, WEB, seedUser, startStack } from "./stack.mjs";

const mobile = process.argv.includes("--mobile");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
// Services that are optional on a fresh install (no Composio / Parallel key): a 503 there is the designed answer, and the page words it for people.
const OPTIONAL_SERVICE = /^\/api\/(integrations\/[^/]+\/connect|inbox\/sync|tracker\/sync-sheet|agent\/chat)/;
const SKIP = /log ?out|sign ?out|delete (my )?account|close account|erase (all|my)/i;
const findings: string[] = [];
const idle: string[] = [];
const seen = new Set<string>();
const add = (route: string, label: string, msg: string) => { const k = `${route}|${label}|${msg}`; if (!seen.has(k)) { seen.add(k); findings.push(`${route}  [${label}]  ${msg}`); } };

const stack = await startStack({});
const browser = await chromium.launch({ channel: "chromium", headless: true });
let total = 0;
try {
  const seed = await seedUser(stack);
  const c = new Client(stack.apiUrl); c.cookie = seed.cookie;
  const apps = (await c.call("GET", "/api/applications")).json as any[];
  const docs = (await c.call("GET", "/api/resume-docs")).json as any[];
  const jobList = (await c.call("GET", "/api/jobs?limit=5")).json as any[];
  const [ck, ...cv] = seed.cookie.split("=");

  const ROUTES = [
    "/dashboard", "/agent", "/jobs", `/jobs?job=${jobList[0].job.id}`, "/companies", "/applications",
    `/applications/${seed.apps.resumeReview}`, `/applications/${seed.apps.needsAnswers}`, `/applications/${seed.apps.formReview}`, `/applications/${seed.apps.formReview}/resume`,
    "/graph", "/inbox", "/tracker", "/resume", `/resume/${docs[0].id}`, "/profile", "/settings", "/companion",
    "/onboarding?step=resume", "/onboarding?step=contact", "/onboarding?step=authorization", "/onboarding?step=screening", "/onboarding?step=preferences", "/onboarding?step=integrations",
  ].filter((r) => !only || only.some((o) => r.startsWith(o)));
  const PUBLIC = ["/", "/login", "/signup", "/forgot-password", "/privacy", "/terms"].filter((r) => !only || only.some((o) => r.startsWith(o)));

  const ctxFor = async (authed: boolean): Promise<BrowserContext> => {
    const ctx = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 }, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
    await ctx.addInitScript("window.__name = (f) => f;"); // tsx wraps named functions; the page has no such helper
    if (authed) await ctx.addCookies([{ name: ck, value: cv.join("="), url: WEB, httpOnly: true, sameSite: "Lax" }]);
    return ctx;
  };

  const SELECTOR = "a[href], button, [role=button], [role=tab], [role=switch], [role=menuitem], summary, select, input[type=checkbox], input[type=radio], [role=checkbox], [role=radio]";
  const list = (page: Page) => page.evaluate((sel) => {
    const vis = (el: Element) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && !el.closest("[aria-hidden=true],[inert]") && !(el.tagName !== "SUMMARY" && el.closest("details:not([open])")); };
    return [...document.querySelectorAll(sel)].filter(vis).map((el, i) => {
      const a = el as HTMLAnchorElement;
      const name = (el.getAttribute("aria-label") || el.textContent || (el as HTMLInputElement).labels?.[0]?.textContent || el.closest("label")?.textContent || el.getAttribute("aria-labelledby") || el.getAttribute("title") || (el.querySelector("img") as HTMLImageElement | null)?.alt || "").trim().replace(/\s+/g, " ").slice(0, 50);
      return { i, tag: el.tagName.toLowerCase(), name, href: a.getAttribute?.("href") ?? "", disabled: (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true", ext: a.target === "_blank", tabindex: el.getAttribute("tabindex") };
    });
  }, SELECTOR);
  const sig = (page: Page) => page.evaluate(() => {
    const t = document.body.innerHTML.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");
    let h = 0; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
    return `${location.pathname}${location.search}${location.hash}|${h}|${document.querySelectorAll("[role=dialog],dialog[open]").length}|${(document.activeElement as HTMLElement)?.tagName}`;
  });

  const run = async (route: string, authed: boolean) => {
    const ctx = await ctxFor(authed);
    const page = await ctx.newPage();
    let errs: string[] = [];
    let reqs = 0;
    page.on("pageerror", (e) => errs.push(`exception: ${String(e.message).slice(0, 100)}`));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|WebGLProgram|favicon|ERR_ABORTED/i.test(m.text())) errs.push(`console: ${m.text().slice(0, 100)}`); });
    page.on("response", async (r) => { const u = r.url(); if (u.startsWith(WEB) && !/_next|\.(png|svg|ico|woff2?|css|js)$/.test(u)) { reqs++; const optional = r.status() === 503 && OPTIONAL_SERVICE.test(new URL(u).pathname); if (r.status() >= 400 && !optional && !/\/api\/auth\/(login|signup)/.test(u)) errs.push(`${r.status()} ${r.request().method()} ${new URL(u).pathname} ${(await r.text().catch(() => "")).slice(0, 120)}`); } });
    page.on("dialog", (d) => { reqs++; void d.accept().catch(() => {}); });
    const load = async () => { await page.goto(WEB + route, { waitUntil: "load", timeout: 45_000 }).catch(() => {}); await page.waitForTimeout(700); };
    await load();
    const els = await list(page);
    const checkedLinks = new Set<string>();
    for (const el of els) {
      total++;
      const label = `${el.tag} "${el.name || el.href || "?"}"`.slice(0, 70);
      if (!el.name && !el.disabled) add(route, label, "control has no accessible name (an unlabeled icon)");
      if (SKIP.test(el.name) || el.disabled || (el.tag === "a" && el.name === "Close" && el.tabindex === "-1")) continue; // the drawer backdrop sits under the panel by design
      if (el.tag === "a" && el.href) {
        if (/^(mailto:|tel:)/.test(el.href)) continue;
        if (el.href.startsWith("#")) { if (el.href.length > 1 && !(await page.evaluate((id) => !!document.getElementById(id), decodeURIComponent(el.href.slice(1))))) add(route, label, `anchor ${el.href} has no target on the page`); continue; }
        if (el.href.startsWith("/") && !checkedLinks.has(el.href)) {
          checkedLinks.add(el.href);
          const r = await ctx.request.get(WEB + el.href, { maxRedirects: 5, timeout: 30_000 }).catch(() => null);
          if (!r || r.status() >= 400) add(route, label, `link ${el.href} returns ${r?.status() ?? "no response"}`);
        }
        if (/^https?:/.test(el.href) || el.ext) continue; // external: only the target can be checked, never visit
      }
      // fresh page, click, observe
      errs = []; reqs = 0;
      if (el.i > 0 || page.url() !== WEB + route) await load();
      errs = []; reqs = 0;
      const handle = (await page.$$(SELECTOR)).filter(Boolean);
      // locate by the same visible-order index
      const target = await page.evaluateHandle(({ sel, i }) => {
        const vis = (e: Element) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && !e.closest("[aria-hidden=true],[inert]") && !(e.tagName !== "SUMMARY" && e.closest("details:not([open])")); };
        return [...document.querySelectorAll(sel)].filter(vis)[i] ?? null;
      }, { sel: SELECTOR, i: el.i });
      void handle;
      const node = target.asElement();
      if (!node) continue;
      const before = await sig(page);
      const popup = ctx.waitForEvent("page", { timeout: 800 }).catch(() => null);
      await node.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
      const clicked = await node.click({ timeout: 3000, noWaitAfter: true }).then(() => true).catch(() => false);
      if (!clicked) { await page.waitForTimeout(100); const modal = await page.evaluate(() => !!document.querySelector("[role=dialog][aria-modal=true]")); if (el.tag !== "input" && !(modal && !el.name.startsWith("Close"))) add(route, label, "could not be clicked (covered by another element or moving)"); continue; }
      const pop = await popup;
      if (pop) { reqs++; await pop.close().catch(() => {}); }
      await page.waitForTimeout(650);
      const after = await sig(page).catch(() => "navigated");
      const body = await page.evaluate(() => (document.body?.innerText ?? "").replace(/\s+/g, " ").slice(0, 600)).catch(() => "");
      if (/Application error|Unhandled Runtime Error|Internal Server Error|Cannot read properties|is not defined/i.test(body)) add(route, label, "click leads to an error screen");
      if (/does not exist|Page not found/i.test(body) && !/not-found/.test(route) && route !== "/") add(route, label, `click leads to a 404 (${page.url().replace(WEB, "")})`);
      for (const e of errs) add(route, label, e);
      if (before === after && reqs === 0 && !pop && el.tag !== "input") idle.push(`${route}  [${label}]`);
    }
    await ctx.close();
    process.stdout.write(`${authed ? "in " : "out"} ${route.slice(0, 64).padEnd(64)} ${els.length} controls, ${findings.length} findings so far\n`);
  };

  for (const r of PUBLIC) await run(r, false);
  for (const r of ROUTES) await run(r, true);
} finally {
  await browser.close();
  await stack.stop();
}
console.log(`\n${total} controls clicked${mobile ? " at 390 px" : ""}`);
if (idle.length) console.log(`\n${idle.length} control(s) that visibly did nothing (review: may be intentional, e.g. already-selected tabs):\n- ${[...new Set(idle)].join("\n- ")}`);
console.log(findings.length ? `\n${findings.length} problem(s):\n- ${findings.join("\n- ")}` : "\nclick pass: no problems");
process.exit(findings.length ? 1 : 0);
