/**
 * Stress data: loads the app with extreme but plausible content (very long titles, emoji, right-to-left text, markup in names,
 * a 400 KB posting, empty fields) and checks every page at desktop and phone width for overflow, errors and overlap.
 *   E2E_API_PORT=4300 E2E_WEB_PORT=3300 npx tsx scripts/qa-stress.mts [--build]
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { jobs } from "@jobgraph/core";
import { Client, WEB, seedUser, startStack } from "./stack.mjs";

const stack = await startStack({ build: process.argv.includes("--build") });
const out = path.resolve("test-results/qa");
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chromium", headless: true });
const problems: string[] = [];
try {
  const seed = await seedUser(stack);
  const long = (s: string, n: number) => s.repeat(Math.ceil(n / s.length)).slice(0, n);
  const rows = await stack.db.insert(jobs).values([
    { companyName: long("Extraordinarily Long Company Name ", 110), atsType: "web", externalId: "s1", title: long("Principal Staff Senior Distinguished Software Engineer ", 210), location: long("Remote - Anywhere in the world, ", 120), remote: true,
      descriptionText: "Requirements:\n- React\n- TypeScript\n" + long("We value ownership and bias for action. ", 400_000), applyUrl: "https://example.com/?job=s1" },
    { companyName: "‮חברה בע״מ \u{1F680}\u{1F680}", atsType: "web", externalId: "s2", title: "מפתח בכיר / Senior \u{1F9D1}‍\u{1F4BB} Engineer (جديد)", location: "תל אביב", remote: false,
      descriptionText: "Requirements:\n- React\n- Node.js", applyUrl: "https://example.com/?job=s2" },
    { companyName: "<b>Bold</b> & \"Quotes\" 'Inc' </script>", atsType: "web", externalId: "s3", title: "<img src=x onerror=alert(1)> Engineer \"; DROP --", location: "<script>alert(1)</script>", remote: true,
      descriptionText: "Requirements:\n- <svg onload=alert(1)>\n- React", applyUrl: "https://example.com/?job=s3" },
    { companyName: "A", atsType: "web", externalId: "s4", title: "X", location: null, remote: false, descriptionText: "", applyUrl: "https://example.com/?job=s4" },
    { companyName: "NoDescription Ltd", atsType: "web", externalId: "s5", title: "Engineer", location: "", remote: false, descriptionText: "   \n\n  ", applyUrl: "https://example.com/?job=s5" },
  ]).returning();
  const c = new Client(stack.apiUrl);
  c.cookie = seed.cookie;
  await c.call("GET", "/api/jobs?limit=50&wait=1");
  for (const r of rows) await c.call("POST", "/api/applications?wait=1", { jobId: r.id });

  const apps = (await c.call("GET", "/api/applications")).json as any[];
  const [ck, ...cv] = seed.cookie.split("=");
  const routes = ["/dashboard", "/jobs", `/jobs?job=${rows[0].id}`, `/jobs?job=${rows[2].id}`, "/applications", "/tracker", "/agent", "/graph", ...apps.slice(0, 6).map((a) => `/applications/${a.application.id}`)];
  for (const [w, h] of [[1440, 900], [390, 844]] as const) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...(w < 500 ? { isMobile: true, hasTouch: true } : {}) });
    await ctx.addCookies([{ name: ck, value: cv.join("="), url: WEB, httpOnly: true, sameSite: "Lax" }]);
    for (const r of routes) {
      const page = await ctx.newPage();
      const errs: string[] = [];
      let dialog = "";
      page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 100)));
      page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|WebGLProgram/.test(m.text())) errs.push(m.text().slice(0, 100)); });
      page.on("dialog", async (d) => { dialog = d.message(); await d.dismiss(); });
      await page.goto(WEB + r, { waitUntil: "load", timeout: 60_000 }).catch((e) => errs.push(`nav ${String(e.message).slice(0, 60)}`));
      await page.waitForTimeout(1300);
      const m = await page.evaluate(() => {
        const de = document.documentElement;
        const wide = [...document.querySelectorAll("body *")].filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.right > window.innerWidth + 2 && getComputedStyle(el).position !== "fixed" && !el.closest("[aria-hidden=true],.dash-marquee"); }).slice(0, 3).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}`);
        return { overflow: de.scrollWidth > window.innerWidth + 2, scrollW: de.scrollWidth, wide, injected: !!document.querySelector("img[src=x], svg[onload]") };
      });
      const tag = `${w}px ${r.slice(0, 50)}`;
      if (m.overflow) problems.push(`${tag}: horizontal scroll (${m.scrollW} > ${w}) caused by ${m.wide.join(", ") || "?"}`);
      if (errs.length) problems.push(`${tag}: ${errs[0]}`);
      if (dialog) problems.push(`${tag}: XSS DIALOG FIRED "${dialog}"`);
      if (m.injected) problems.push(`${tag}: injected markup became real DOM`);
      if (/jobs\?job=/.test(r) || r === "/jobs") await page.screenshot({ path: path.join(out, `stress-${r.replace(/\W+/g, "_")}-${w}.png`) });
      await page.close();
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  await stack.stop();
}
console.log(problems.length ? `\n${problems.length} problem(s):\n- ${problems.join("\n- ")}` : "\nstress data: no overflow, no errors, no injection");
process.exit(problems.length ? 1 : 0);
