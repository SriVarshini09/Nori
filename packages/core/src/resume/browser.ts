import { chromium, type Browser, type Page } from "playwright";

/**
 * One shared headless Chromium for PDF rendering. Launching a browser costs 0.3 to 1 s, so live resume preview would
 * crawl if every render launched its own. The browser starts on first use, restarts if it dies, and closes after a
 * minute without work.
 */
let browserP: Promise<Browser> | null = null;
let active = 0;
let idle: NodeJS.Timeout | null = null;
const IDLE_MS = 60_000;

function launch(): Promise<Browser> {
  const p = chromium.launch({ headless: true }).then((b) => {
    b.on("disconnected", () => { if (browserP === p) browserP = null; });
    return b;
  });
  p.catch(() => { if (browserP === p) browserP = null; });
  return p;
}

export async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  if (idle) { clearTimeout(idle); idle = null; }
  active++;
  try {
    const browser = await (browserP ??= launch());
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      return await fn(page);
    } finally {
      await ctx.close().catch(() => {});
    }
  } finally {
    if (--active === 0) {
      idle = setTimeout(() => { const p = browserP; browserP = null; p?.then((b) => b.close()).catch(() => {}); }, IDLE_MS);
      idle.unref?.();
    }
  }
}

/** Close the shared browser now (tests and shutdown). */
export async function closeSharedBrowser(): Promise<void> {
  if (idle) { clearTimeout(idle); idle = null; }
  const p = browserP; browserP = null;
  if (p) await p.then((b) => b.close()).catch(() => {});
}
