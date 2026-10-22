/**
 * Monkey tester: clicks, types hostile text, presses keys and resizes at random on every page of a RUNNING instance, and
 * reports page errors, console errors, failed or 5xx requests, error screens, fired dialogs (XSS) and horizontal overflow.
 *   E2E_WEB_PORT=3300 npx tsx scripts/qa-monkey.mts [rounds=2] [actions=45] [route ...]
 * Seeded, so a failure can be replayed: the report prints the seed and the last actions before each error.
 */
import { chromium, type Page } from "playwright";

const WEB = `http://localhost:${process.env.E2E_WEB_PORT ?? 3300}`;
const args = process.argv.slice(2);
const rounds = Number(args.find((a) => a.startsWith("rounds="))?.slice(7) ?? 2);
const ACTIONS = Number(args.find((a) => a.startsWith("actions="))?.slice(8) ?? 45);
const routeArgs = args.filter((a) => a.startsWith("/"));

const login = await fetch(`${WEB}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "maya.chen@example.com", password: "demo-pass-2026" }) });
const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
const [ck, ...cv] = cookie.split("=");
const j = async (p: string) => (await fetch(WEB + p, { headers: { cookie } })).json() as Promise<any>;
const apps = await j("/api/applications");
const docs = await j("/api/resume-docs");
const jobs = await j("/api/jobs?limit=5");

const ROUTES = routeArgs.length ? routeArgs : [
  "/dashboard", "/agent", "/jobs", `/jobs?job=${jobs[0]?.job?.id}`, "/companies", "/applications", `/applications/${apps[0]?.application?.id}`,
  `/applications/${apps[1]?.application?.id}`, `/applications/${apps[0]?.application?.id}/resume`, "/graph", "/inbox", "/tracker", "/resume",
  `/resume/${docs[0]?.id}`, "/profile", "/settings", "/companion", "/onboarding?step=contact", "/onboarding?step=preferences",
];
const PUBLIC_ROUTES = ["/", "/login", "/signup", "/forgot-password", "/privacy", "/terms"];

const HOSTILE = ["", " ", "x", "<script>alert(1)</script>", "\"><img src=x onerror=alert(1)>", "'; DROP TABLE users; --", "\u0000", "a".repeat(5000), "\u{1F600}".repeat(300), "-1", "999999999999999999999",
  "0", "http://169.254.169.254/latest/meta-data", "javascript:alert(1)", "{{7*7}}", "../../etc/passwd", "‮evil", "Ünïcödé Ñame", "  padded  ", "a@b", "not an email", "1e309", "NaN"];
const DANGEROUS = /delete|log ?out|sign ?out|remove account|revoke|danger|close account|erase/i;
const KEYS = ["Escape", "Tab", "Enter", "ArrowDown", "ArrowUp", "Space", "Shift+Tab", "End", "Home"];

function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

type Finding = { route: string; seed: number; kind: string; detail: string; recent: string[] };
const findings: Finding[] = [];
let totalActions = 0;

async function runPage(page: Page, route: string, seed: number) {
  const rand = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const recent: string[] = [];
  const seen = new Set<string>();
  const add = (kind: string, detail: string) => {
    const key = `${kind}|${detail.slice(0, 120)}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ route, seed, kind, detail: detail.slice(0, 280), recent: recent.slice(-4) });
  };
  page.on("pageerror", (e) => add("pageerror", String(e.message)));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/Failed to load resource|WebGLProgram|favicon|net::ERR_ABORTED/i.test(t)) return;
    add("console.error", t);
  });
  page.on("response", (r) => { if (r.status() >= 500 && r.url().includes("/api/")) add(`http.${r.status()}`, `${r.request().method()} ${new URL(r.url()).pathname}`); });
  page.on("requestfailed", (r) => { if (!/ERR_ABORTED/.test(r.failure()?.errorText ?? "")) add("requestfailed", `${r.method()} ${r.url()} ${r.failure()?.errorText}`); });
  page.on("dialog", async (d) => { add("DIALOG (possible XSS)", `${d.type()}: ${d.message()}`); await d.dismiss().catch(() => {}); });

  await page.goto(WEB + route, { waitUntil: "load", timeout: 45_000 }).catch((e) => add("navigation", String(e.message)));
  await page.waitForTimeout(1200);

  for (let i = 0; i < ACTIONS; i++) {
    totalActions++;
    try {
      const r = rand();
      if (r < 0.42) {
        const els = await page.$$("button:visible, a[href]:visible, [role=tab]:visible, [role=switch]:visible, [role=radio]:visible, [role=checkbox]:visible, summary:visible, [role=menuitem]:visible");
        if (!els.length) continue;
        const el = pick(els);
        const info = await el.evaluate((n) => ({ t: (n.textContent || "").trim().slice(0, 40), label: n.getAttribute("aria-label") || "", href: (n as HTMLAnchorElement).href || "", ext: (n as HTMLAnchorElement).target === "_blank" }));
        const name = `${info.t} ${info.label}`;
        if (DANGEROUS.test(name) || info.ext || /^mailto:|^tel:/.test(info.href) || (info.href && !info.href.startsWith(WEB))) continue;
        recent.push(`click "${name.trim() || info.href}"`);
        await el.click({ timeout: 2500, noWaitAfter: true }).catch(() => {});
      } else if (r < 0.72) {
        const els = await page.$$("input:visible:not([type=file]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=submit]), textarea:visible");
        if (!els.length) continue;
        const el = pick(els);
        const txt = pick(HOSTILE);
        recent.push(`type ${JSON.stringify(txt.slice(0, 30))} into ${await el.evaluate((n) => (n as HTMLInputElement).name || (n as HTMLInputElement).placeholder || n.tagName)}`);
        await el.fill(txt, { timeout: 2500 }).catch(() => {});
        if (rand() < 0.5) await el.press("Enter", { timeout: 1500 }).catch(() => {});
      } else if (r < 0.8) {
        const sel = await page.$$("select:visible");
        if (sel.length) { const el = pick(sel); const opts = await el.$$eval("option", (o) => o.map((x) => (x as HTMLOptionElement).value)); if (opts.length) { recent.push("select option"); await el.selectOption(pick(opts), { timeout: 1500 }).catch(() => {}); } }
      } else if (r < 0.9) {
        const k = pick(KEYS);
        recent.push(`press ${k}`);
        await page.keyboard.press(k).catch(() => {});
      } else if (r < 0.95) {
        const w = pick([360, 390, 768, 1024, 1440]);
        recent.push(`resize ${w}`);
        await page.setViewportSize({ width: w, height: 800 });
      } else {
        recent.push("scroll");
        await page.mouse.wheel(0, Math.round((rand() - 0.3) * 1800));
      }
      await page.waitForTimeout(120);
      // stay on this origin
      if (!page.url().startsWith(WEB)) { add("left the site", page.url()); await page.goBack().catch(() => {}); }
      // an error screen?
      const bad = await page.evaluate(() => {
        const t = document.body?.innerText ?? "";
        const m = /(Application error|Something went wrong|Unhandled Runtime Error|Internal Server Error|Cannot read properties|is not defined)/i.exec(t);
        return m ? m[0] : null;
      }).catch(() => null);
      if (bad) add("error screen", `page shows "${bad}"`);
    } catch (e) {
      add("harness", String((e as Error).message).slice(0, 120));
    }
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2 ? `${document.documentElement.scrollWidth} > ${window.innerWidth}` : null).catch(() => null);
  if (overflow) add("layout", `horizontal scroll (${overflow}) at ${page.viewportSize()?.width}px`);
}

const browser = await chromium.launch({ channel: "chromium", headless: true });
for (const [list, authed] of [[PUBLIC_ROUTES, false], [ROUTES, true]] as const) {
  for (const route of routeArgs.length ? routeArgs : list) {
    if (routeArgs.length && !authed) continue;
    for (let round = 0; round < rounds; round++) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      if (authed) await ctx.addCookies([{ name: ck, value: cv.join("="), url: WEB, httpOnly: true, sameSite: "Lax" }]);
      const page = await ctx.newPage();
      await runPage(page, route, hash(route) + round * 977);
      await ctx.close();
    }
    process.stdout.write(`${authed ? "in " : "out"} ${route.slice(0, 60).padEnd(60)} done (${findings.length} findings so far)\n`);
  }
}
await browser.close();

console.log(`\n${totalActions} actions, ${findings.length} finding(s)`);
for (const f of findings) {
  console.log(`\n[${f.kind}] ${f.route} (seed ${f.seed})\n  ${f.detail}\n  after: ${f.recent.join(" > ")}`);
}
process.exit(findings.length ? 1 : 0);
