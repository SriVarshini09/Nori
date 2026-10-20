import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { WEB } from "../scripts/stack.mjs";

export { WEB };

export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({ channel: "chromium", headless: true });
}

export async function newSession(browser: Browser): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror @ ${page.url().replace(WEB, "")}: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/Failed to load resource/i.test(t)) return; // reported through responses below
    errors.push(`console: ${t.slice(0, 200)}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 500) errors.push(`http ${r.status()}: ${r.url().replace(WEB, "")}`);
  });
  return { ctx, page, errors };
}

/** Text of the preview iframe's document. */
export async function previewHtml(page: Page): Promise<string> {
  const frame = page.frameLocator('iframe[title="Resume preview"]');
  await frame.locator("h1").first().waitFor({ timeout: 30_000 });
  return page.evaluate(() => (document.querySelector('iframe[title="Resume preview"]') as HTMLIFrameElement).contentDocument!.documentElement.outerHTML);
}
