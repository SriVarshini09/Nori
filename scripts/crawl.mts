/**
 * Crawl every route of the real app (production build, live mode) as a signed-out visitor and as a signed-in user.
 * For each page it records console errors, page errors, failed requests, 4xx/5xx responses, CSP violations, broken
 * images, unlabeled controls, and verifies every link on the page (internal and external).
 *
 *   npx tsx scripts/crawl.mts            writes test-results/crawl/report.{json,md}, exits 1 on any issue
 *   npx tsx scripts/crawl.mts --build    rebuild the web app first
 *   npx tsx scripts/crawl.mts --no-external   skip checking external links
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { ROOT, WEB, seedUser, startStack } from "./stack.mjs";

type Issue = { page: string; kind: string; detail: string };
const issues: Issue[] = [];
const pagesVisited: { url: string; as: string; final: string; status: number; title: string; links: number; buttons: number }[] = [];
const linkChecked = new Map<string, string>();
const args = process.argv.slice(2);
const checkExternal = !args.includes("--no-external");

// SwiftShader (software GL in headless Chromium) warns about shader precision in three.js; not an app defect.
const NOISE = [/Download the React DevTools/i, /THREE.WebGLProgram/i];

function attach(page: Page, label: string, expected401: boolean, expect404Path?: string) {
  page.on("console", (m) => {
    if (!["error", "warning"].includes(m.type())) return;
    const t = m.text();
    if (NOISE.some((r) => r.test(t))) return;
    // The browser logs every non-2xx fetch as a console error; failed responses are reported separately below.
    if (/Failed to load resource/i.test(t)) return;
    issues.push({ page: label, kind: `console.${m.type()}`, detail: t.slice(0, 300) });
  });
  page.on("pageerror", (e) => issues.push({ page: label, kind: "pageerror", detail: String(e.message).slice(0, 300) }));
  page.on("requestfailed", (r) => {
    const f = r.failure()?.errorText ?? "";
    if (/ERR_ABORTED/.test(f)) return; // navigations and cancelled prefetches
    issues.push({ page: label, kind: "requestfailed", detail: `${r.method()} ${r.url()} ${f}` });
  });
  page.on("response", (r) => {
    const s = r.status();
    if (s < 400) return;
    const u = new URL(r.url());
    if (expected401 && s === 401 && u.pathname.startsWith("/api/")) return;
    if (expect404Path && s === 404 && u.pathname === expect404Path) return;
    issues.push({ page: label, kind: `http.${s}`, detail: `${r.request().method()} ${u.pathname}${u.search}` });
  });
}

async function visit(ctx: BrowserContext, url: string, as: string, opts: { expectFinal?: RegExp; expected401?: boolean; settle?: number; expect404?: boolean } = {}) {
  const page = await ctx.newPage();
  const label = `${as}: ${url.replace(WEB, "") || "/"}`;
  attach(page, label, opts.expected401 ?? false, opts.expect404 ? new URL(url).pathname : undefined);
  await page.addInitScript("window.__name = (f) => f;"); // tsx injects __name into evaluated functions
  await page.addInitScript(() => {
    (window as any).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => (window as any).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  let status = 0;
  try {
    const res = await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
    status = res?.status() ?? 0;
  } catch (e) {
    issues.push({ page: label, kind: "navigation", detail: String((e as Error).message).slice(0, 200) });
    await page.close();
    return null;
  }
  await page.waitForTimeout(opts.settle ?? 900);
  const final = page.url();
  if (opts.expect404) {
    if (status !== 404) issues.push({ page: label, kind: "http", detail: `expected a 404 page, got ${status}` });
    else if (!(await page.getByText(/does not exist/i).count())) issues.push({ page: label, kind: "not-found", detail: "404 without the friendly not-found card" });
  } else if (status >= 400) issues.push({ page: label, kind: `http.${status}`, detail: "page itself" });
  if (opts.expectFinal && !opts.expectFinal.test(final.replace(WEB, ""))) issues.push({ page: label, kind: "redirect", detail: `ended at ${final.replace(WEB, "")}` });

  const facts = await page.evaluate(() => {
    const vis = (el: Element) => { const r = (el as HTMLElement).getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
    const links = [...document.querySelectorAll("a[href]")].map((a) => (a as HTMLAnchorElement).href);
    const buttons = [...document.querySelectorAll("button, [role=button]")].filter(vis);
    const unlabeledButtons = buttons.filter((b) => !(b.textContent || "").trim() && !b.getAttribute("aria-label") && !b.getAttribute("title") && !b.querySelector("img[alt]"));
    const inputs = [...document.querySelectorAll("input:not([type=hidden]), select, textarea")].filter(vis);
    const unlabeledInputs = inputs.filter((i) => {
      const el = i as HTMLInputElement;
      return !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby") && !(el.id && document.querySelector(`label[for="${el.id}"]`)) && !el.closest("label") && !el.getAttribute("placeholder") && el.type !== "checkbox" && el.type !== "radio";
    });
    const brokenImgs = [...document.images].filter((i) => vis(i) && i.complete && i.naturalWidth === 0).map((i) => i.src);
    return {
      title: document.title, h1: [...document.querySelectorAll("h1")].map((h) => h.textContent?.trim()).slice(0, 2),
      lang: document.documentElement.lang, links, buttons: buttons.length,
      unlabeledButtons: unlabeledButtons.map((b) => b.outerHTML.slice(0, 120)),
      unlabeledInputs: unlabeledInputs.map((b) => b.outerHTML.slice(0, 120)),
      brokenImgs, csp: (window as any).__csp as string[],
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  if (!facts.title.trim()) issues.push({ page: label, kind: "a11y", detail: "empty <title>" });
  if (!facts.lang) issues.push({ page: label, kind: "a11y", detail: "<html> has no lang" });
  if (!facts.h1.length) issues.push({ page: label, kind: "a11y", detail: "no <h1>" });
  for (const b of facts.unlabeledButtons) issues.push({ page: label, kind: "a11y", detail: `button without a name: ${b}` });
  for (const i of facts.unlabeledInputs) issues.push({ page: label, kind: "a11y", detail: `form control without a label: ${i}` });
  for (const i of facts.brokenImgs) issues.push({ page: label, kind: "image", detail: i });
  for (const v of facts.csp) issues.push({ page: label, kind: "csp", detail: v });
  if (facts.overflowX) issues.push({ page: label, kind: "layout", detail: "horizontal scroll at 1280px" });

  pagesVisited.push({ url, as, final: final.replace(WEB, ""), status, title: facts.title, links: facts.links.length, buttons: facts.buttons });
  const links = [...new Set(facts.links)];
  await page.close();
  return { links, label };
}

async function checkLink(ctx: BrowserContext, href: string, from: string, signedIn: boolean) {
  const u = new URL(href);
  if (!/^https?:$/.test(u.protocol)) return;
  u.hash = "";
  const key = `${signedIn ? "in" : "out"}:${u.href}`;
  if (linkChecked.has(key)) return;
  const internal = u.origin === WEB;
  if (!internal && !checkExternal) return;
  let result = "ok";
  try {
    const res = await ctx.request.get(u.href, { maxRedirects: 5, timeout: 20_000, headers: { "user-agent": "Mozilla/5.0 NoriLinkCheck" } });
    const final = new URL(res.url());
    if (res.status() >= 400 && !(res.status() === 403 && !internal)) result = `HTTP ${res.status()}`;
    else if (internal && signedIn && final.pathname === "/login") result = "redirected to /login while signed in";
  } catch (e) {
    result = `unreachable: ${String((e as Error).message).slice(0, 100)}`;
  }
  linkChecked.set(key, result);
  if (result !== "ok") issues.push({ page: from, kind: "link", detail: `${href} -> ${result}` });
}

const stack = await startStack({ build: args.includes("--build") });
const browser = await chromium.launch({ channel: "chromium", headless: true });
try {
  const seed = await seedUser(stack);
  const cookie = seed.cookie.split("=");
  const anon = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const authed = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await authed.addCookies([{ name: cookie[0], value: cookie.slice(1).join("="), url: WEB, httpOnly: true, sameSite: "Lax" }]);

  // ---- signed out
  for (const p of ["/login", "/signup"]) {
    const r = await visit(anon, WEB + p, "visitor", { expectFinal: new RegExp(`^${p}$`), expected401: true });
    if (r) for (const l of r.links) await checkLink(anon, l, r.label, false);
  }
  for (const p of ["/", "/dashboard", "/jobs", "/applications", "/agent", "/graph", "/inbox", "/tracker", "/resume", "/profile", "/settings", "/onboarding", "/companion"]) {
    await visit(anon, WEB + p, "visitor", { expectFinal: /^\/login(\?.*)?$/, expected401: true });
  }
  await visit(anon, WEB + "/definitely-not-a-page", "visitor", { expectFinal: /./, expected401: true });

  // ---- signed in
  const routes = [
    "/", "/dashboard", "/agent", "/jobs", `/jobs?job=${seed.jobIds[0]}`, "/applications",
    `/applications/${seed.apps.resumeReview}`, `/applications/${seed.apps.needsAnswers}`, `/applications/${seed.apps.formReview}`,
    "/graph", "/inbox", "/tracker", "/resume", `/resume/${seed.docId}`, `/applications/${seed.apps.resumeReview}/resume`, "/profile", "/settings", "/companion",
  ];
  for (const p of routes) {
    const r = await visit(authed, WEB + p, "user", { expectFinal: p === "/" ? /^\/dashboard/ : /^\/(?!login)/ });
    if (r) for (const l of r.links) await checkLink(authed, l, r.label, true);
  }
  // an unknown application and an unknown job must fail gracefully, not crash
  await visit(authed, WEB + "/applications/00000000-0000-0000-0000-000000000000", "user", { expectFinal: /./, expect404: true });
  await visit(authed, WEB + "/applications/not-a-uuid", "user", { expectFinal: /./, expect404: true });
  await visit(authed, WEB + "/resume/not-a-uuid", "user", { expectFinal: /./, expect404: true });
  await visit(authed, WEB + "/resume/00000000-0000-0000-0000-000000000000", "user", { expectFinal: /./, expect404: true });
  await visit(authed, WEB + "/definitely-not-a-page", "user", { expectFinal: /./, expect404: true });
} finally {
  await browser.close();
  await stack.stop();
}

// ---- report
const outDir = path.join(ROOT, "test-results/crawl");
await mkdir(outDir, { recursive: true });
const grouped = new Map<string, Issue[]>();
for (const i of issues) { const k = `${i.page} | ${i.kind} | ${i.detail}`; if (!grouped.has(k)) grouped.set(k, []); grouped.get(k)!.push(i); }
const unique = [...grouped.values()].map((v) => v[0]);
await writeFile(path.join(outDir, "report.json"), JSON.stringify({ pages: pagesVisited, links: Object.fromEntries(linkChecked), issues: unique }, null, 2));
const md = [
  "# Crawl report", "", `Pages visited: ${pagesVisited.length}. Links checked: ${linkChecked.size}. Issues: ${unique.length}.`, "",
  "| Page | Kind | Detail |", "|---|---|---|", ...unique.map((i) => `| ${i.page} | ${i.kind} | ${i.detail.replace(/\|/g, "\\|")} |`), "",
].join("\n");
await writeFile(path.join(outDir, "report.md"), md);
console.log(`\ncrawl: ${pagesVisited.length} pages, ${linkChecked.size} links, ${unique.length} issue(s)`);
for (const i of unique.slice(0, 60)) console.log(` - [${i.kind}] ${i.page}: ${i.detail}`);
process.exit(unique.length ? 1 : 0);
