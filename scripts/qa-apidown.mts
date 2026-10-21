/**
 * What does a visitor see when the API is down or slow? Run with the web app up and the API stopped:
 *   E2E_WEB_PORT=3300 COOKIE="jg_session=..." npx tsx scripts/qa-apidown.mts
 * Flags: raw server error pages, blank pages, pages that hang, uncaught exceptions, and error screens without a way forward.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const WEB = `http://localhost:${process.env.E2E_WEB_PORT ?? 3300}`;
const cookie = process.env.COOKIE ?? "";
const [ck, ...cv] = cookie.split("=");
const out = path.resolve("test-results/qa");
await mkdir(out, { recursive: true });
const ROUTES = ["/", "/login", "/signup", "/dashboard", "/agent", "/jobs", "/companies", "/applications", "/graph", "/inbox", "/tracker", "/resume", "/profile", "/settings", "/onboarding", "/companion", "/privacy"];

const browser = await chromium.launch({ channel: "chromium", headless: true });
const bad: string[] = [];
for (const authed of [false, true]) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  if (authed && ck) await ctx.addCookies([{ name: ck, value: cv.join("="), url: WEB, httpOnly: true, sameSite: "Lax" }]);
  for (const r of ROUTES) {
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 120)));
    const t = Date.now();
    const res = await page.goto(WEB + r, { waitUntil: "load", timeout: 30_000 }).catch((e) => { errors.push(`navigation: ${String(e.message).slice(0, 80)}`); return null; });
    await page.waitForTimeout(900);
    const ms = Date.now() - t;
    const status = res?.status() ?? 0;
    const info = await page.evaluate(() => ({
      text: (document.body?.innerText ?? "").replace(/\s+/g, " ").trim(),
      h1: document.querySelector("h1,h2")?.textContent?.trim() ?? "",
      actions: [...document.querySelectorAll("a[href],button")].filter((n) => (n as HTMLElement).offsetParent).map((n) => (n.textContent || "").trim()).filter(Boolean).slice(0, 8),
    })).catch(() => ({ text: "", h1: "", actions: [] as string[] }));
    const label = `${authed ? "in " : "out"} ${r.padEnd(14)}`;
    const raw = /^Internal Server Error$|^Bad Gateway|ECONNREFUSED|Cannot reach the jobgraph API|fetch failed|stack|at .*\(.*:\d+:\d+\)/i.test(info.text.slice(0, 600));
    let verdict = "ok";
    if (info.text.length < 30) verdict = "BLANK PAGE";
    else if (raw) verdict = "RAW ERROR TEXT SHOWN";
    else if (errors.length) verdict = `uncaught: ${errors[0]}`;
    else if (ms > 12_000) verdict = `SLOW ${ms}ms`;
    if (verdict !== "ok") bad.push(`${label} ${verdict}`);
    console.log(`${label} ${String(status).padEnd(4)} ${String(ms).padStart(5)}ms  ${verdict.padEnd(24)} "${(info.h1 || info.text).slice(0, 70)}"  [${info.actions.slice(0, 3).join(" | ")}]`);
    if (authed && /dashboard|agent/.test(r)) await page.screenshot({ path: path.join(out, `apidown${r.replace("/", "-")}.png`) });
    await page.close();
  }
  await ctx.close();
}
await browser.close();
console.log(bad.length ? `\n${bad.length} problem(s):\n${bad.join("\n")}` : "\nevery page degrades gracefully");
process.exit(bad.length ? 1 : 0);
