/**
 * Full-page screenshots of a RUNNING instance (`npm run serve`), signed out and signed in, at desktop and phone width.
 *   E2E_WEB_PORT=3300 E2E_API_PORT=4300 npx tsx scripts/qa-shots.mts [name=path ...]
 * Output: test-results/qa/<name>-<width>.png. Without arguments it captures every route.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const WEB = `http://localhost:${process.env.E2E_WEB_PORT ?? 3300}`;
const out = path.resolve("test-results/qa");
await mkdir(out, { recursive: true });

// sign in through the real API to get the session cookie
const login = await fetch(`${WEB}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "maya.chen@example.com", password: "demo-pass-2026" }) });
const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
const [ck, ...cv] = cookie.split("=");
const j = async (p: string) => (await fetch(WEB + p, { headers: { cookie } })).json() as Promise<any>;
const apps = await j("/api/applications");
const docs = await j("/api/resume-docs");
const jobs = await j("/api/jobs?limit=5");

const signedOut: [string, string][] = [["landing", "/"], ["login", "/login"], ["signup", "/signup"], ["forgot", "/forgot-password"], ["privacy", "/privacy"], ["terms", "/terms"], ["notfound", "/nope-not-here"]];
const signedIn: [string, string][] = [
  ["dashboard", "/dashboard"], ["agent", "/agent"], ["jobs", "/jobs"], ["jobdrawer", `/jobs?job=${jobs[0]?.job?.id}`], ["companies", "/companies"],
  ["applications", "/applications"], ["appreview", `/applications/${apps[0]?.application?.id}`], ["appresume", `/applications/${apps[0]?.application?.id}/resume`],
  ["graph", "/graph"], ["inbox", "/inbox"], ["tracker", "/tracker"], ["resume", "/resume"], ["studio", `/resume/${docs[0]?.id}`],
  ["profile", "/profile"], ["settings", "/settings"], ["companion", "/companion"], ["onboarding", "/onboarding?step=resume"],
];
const only = process.argv.slice(2).filter((a) => a.includes("=")).map((a) => a.split("=") as [string, string]);

const browser = await chromium.launch({ channel: "chromium", headless: true });
for (const [w, h] of [[1440, 900], [390, 844]] as const) {
  for (const authed of [false, true]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...(w < 500 ? { isMobile: true, hasTouch: true } : {}) });
    if (authed) await ctx.addCookies([{ name: ck, value: cv.join("="), url: WEB, httpOnly: true, sameSite: "Lax" }]);
    const list = only.length ? only : authed ? signedIn : signedOut;
    for (const [name, p] of list) {
      if (only.length && authed === false && w === 390 && false) continue;
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 160)));
      page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|WebGLProgram/i.test(m.text())) errors.push(m.text().slice(0, 160)); });
      await page.goto(WEB + p, { waitUntil: "load", timeout: 60000 }).catch((e) => console.log("goto failed:", String(e.message).slice(0, 120)));
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      // scroll-linked reveals sit at their start state below the fold; show everything for the static capture
      await page.addStyleTag({ content: ".reveal,.dash-col,.dash-bar{animation:none!important;opacity:1!important;transform:none!important;filter:none!important}" });
      await page.waitForTimeout(1600);
      await page.screenshot({ path: path.join(out, `${name}-${w}.png`), fullPage: true });
      console.log(`${name}@${w}`, errors.length ? `ERRORS: ${errors.join(" | ")}` : "ok", "->", page.url().replace(WEB, ""));
      await page.close();
    }
    await ctx.close();
    if (only.length) break;
  }
}
await browser.close();
process.exit(0);
