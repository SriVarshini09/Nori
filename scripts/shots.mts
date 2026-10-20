/**
 * Screenshot pages of the real app for visual review.
 *   npx tsx scripts/shots.mts [--build] name=path ...      e.g. studio=/resume/{doc} library=/resume
 * Paths may use {doc}, {app}, {app2}, {app3}. Output: test-results/shots/<name>-<width>.png at 1440 and 390 wide.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { ROOT, WEB, seedUser, startStack } from "./stack.mjs";

const args = process.argv.slice(2);
const targets = args.filter((a) => a.includes("=")).map((a) => a.split("=") as [string, string]);
const stack = await startStack({ build: args.includes("--build") });
const out = path.join(ROOT, "test-results/shots");
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chromium", headless: true });
try {
  const seed = await seedUser(stack);
  const [k, ...rest] = seed.cookie.split("=");
  for (const [w, h] of [[1440, 900], [390, 844]] as const) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await ctx.addCookies([{ name: k, value: rest.join("="), url: WEB, httpOnly: true, sameSite: "Lax" }]);
    for (const [name, p] of targets) {
      const url = WEB + p.replace("{doc}", seed.docId).replace("{app}", seed.apps.resumeReview).replace("{app2}", seed.apps.needsAnswers).replace("{app3}", seed.apps.formReview);
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: "networkidle" });
      await page.waitForTimeout(1800);
      await page.screenshot({ path: path.join(out, `${name}-${w}.png`), fullPage: false });
      await page.close();
      console.log("shot", name, w);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  await stack.stop();
}
process.exit(0);
