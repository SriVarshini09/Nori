/**
 * Keyboard-only pass over a RUNNING instance: tab through every page and check focus is visible, never lost or trapped,
 * every stop has a name, the skip link works, switches respond to Space/Enter and Escape closes the job drawer.
 *   E2E_WEB_PORT=3300 npx tsx scripts/qa-keys.mts
 */
import { chromium, type Page } from "playwright";

const WEB = `http://localhost:${process.env.E2E_WEB_PORT ?? 3300}`;
const login = await fetch(`${WEB}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "maya.chen@example.com", password: "demo-pass-2026" }) });
const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
const [ck, ...cv] = cookie.split("=");
const jobs = await (await fetch(`${WEB}/api/jobs?limit=3`, { headers: { cookie } })).json() as any[];
const apps = await (await fetch(`${WEB}/api/applications`, { headers: { cookie } })).json() as any[];

const OUT = ["/", "/login", "/signup", "/forgot-password", "/privacy"];
const IN = ["/dashboard", "/agent", "/jobs", "/companies", "/applications", `/applications/${apps[0].application.id}`, "/graph", "/inbox", "/tracker", "/resume", "/profile", "/settings", "/onboarding?step=contact"];
const problems: string[] = [];
const note = (m: string) => { if (!problems.includes(m)) problems.push(m); };

async function describeFocus(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const cs = getComputedStyle(el);
    const name = (el.getAttribute("aria-label") || el.textContent || (el as HTMLInputElement).placeholder || el.getAttribute("title") || el.getAttribute("alt") || "").trim().replace(/\s+/g, " ").slice(0, 40);
    const labelled = !!(el.getAttribute("aria-labelledby") || (el as HTMLInputElement).labels?.length || el.closest("label"));
    const r = el.getBoundingClientRect();
    const outline = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0;
    const shadow = cs.boxShadow !== "none" && /rgb/.test(cs.boxShadow);
    // a parent ring (peer / focus-within styling) also counts
    const parentRing = !!el.closest("[class*=focus-within]") || !!el.parentElement?.matches("label") || !!el.closest("label")?.querySelector("span[class*=peer-focus]");
    return { tag: el.tagName.toLowerCase(), type: (el as HTMLInputElement).type || "", name, labelled, outline, shadow, parentRing, w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y), visible: r.width > 0 && r.height > 0, tabindex: el.getAttribute("tabindex"), id: el.id };
  });
}

async function tabThrough(page: Page, label: string, max = 70) {
  let last = "", repeat = 0, lost = 0, stops = 0;
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(40);
    const f = await describeFocus(page);
    if (!f) { if (++lost > 3 && i > 3 && i < max - 5) { note(`${label}: keyboard focus fell off the page after ${i} Tabs`); break; } continue; }
    lost = 0; stops++;
    const key = `${f.tag}${f.id}${f.name}@${f.x},${f.y}`;
    repeat = key === last ? repeat + 1 : 0;
    if (repeat >= 3) { note(`${label}: keyboard trap or loop at "${f.name}"`); break; }
    last = key;
    if (!f.visible) note(`${label}: focus on a hidden element "${f.name}"`);
    if (f.tabindex && Number(f.tabindex) > 0) note(`${label}: positive tabindex on "${f.name}" (breaks natural order)`);
    if (!f.name && !f.labelled && !["input", "textarea", "select"].includes(f.tag)) note(`${label}: ${f.tag} with no accessible name`);
    if (f.tag !== "iframe" && f.type !== "file" && f.type !== "checkbox" && f.type !== "radio" && !f.outline && !f.shadow && !f.parentRing) note(`${label}: no visible focus indicator on ${f.tag} "${f.name}"`);
    if (f.visible && (f.w < 24 || f.h < 24) && !["checkbox", "radio", "range", "file"].includes(f.type) && f.tag !== "a") note(`${label}: tiny target ${f.w}x${f.h} "${f.name}"`);
  }
  return stops;
}

const browser = await chromium.launch({ channel: "chromium", headless: true });
for (const [list, authed] of [[OUT, false], [IN, true]] as const) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  if (authed) await ctx.addCookies([{ name: ck, value: cv.join("="), url: WEB, httpOnly: true, sameSite: "Lax" }]);
  for (const r of list) {
    const page = await ctx.newPage();
    await page.goto(WEB + r, { waitUntil: "load", timeout: 45_000 }).catch(() => {});
    await page.waitForTimeout(900);
    const stops = await tabThrough(page, `${authed ? "in " : "out"} ${r.slice(0, 40)}`);
    if (stops < 2) note(`${authed ? "in " : "out"} ${r}: only ${stops} keyboard stop(s)`);
    await page.close();
  }
  await ctx.close();
}

// skip link, switch toggling, drawer Escape
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addCookies([{ name: ck, value: cv.join("="), url: WEB, httpOnly: true, sameSite: "Lax" }]);
  const anon = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p0 = await anon.newPage();
  await p0.goto(WEB + "/", { waitUntil: "load" });
  await p0.keyboard.press("Tab");
  const first = await describeFocus(p0);
  if (!first || !/skip/i.test(first.name)) note(`landing: the first Tab stop is "${first?.name}", expected the skip link`);
  else { await p0.keyboard.press("Enter"); await p0.waitForTimeout(200); if (!/#main/.test(p0.url())) note("landing: the skip link does not jump to #main"); }

  const p = await ctx.newPage();
  await p.goto(WEB + "/agent", { waitUntil: "load" });
  await p.waitForTimeout(900);
  const sw = p.getByRole("switch").first();
  if (await sw.count()) {
    const before = await sw.getAttribute("aria-checked");
    await sw.focus(); await p.keyboard.press("Space"); await p.waitForTimeout(500);
    const after = await sw.getAttribute("aria-checked");
    if (before === after) note("agent: a switch does not toggle with the Space key");
    await p.keyboard.press("Space"); await p.waitForTimeout(300);
  }
  await p.goto(WEB + `/jobs?job=${jobs[0].job.id}`, { waitUntil: "load" });
  await p.waitForTimeout(1200);
  const open = await p.getByRole("dialog").count();
  await p.keyboard.press("Escape"); await p.waitForTimeout(500);
  const stillOpen = await p.getByRole("dialog").count();
  console.log(`job drawer: dialog role present before Escape: ${open > 0}, after: ${stillOpen > 0}, url: ${p.url().replace(WEB, "")}`);
  if (open > 0 && stillOpen > 0) note("jobs: Escape does not close the job drawer");
  if (open === 0) note("jobs: the job drawer has no role=dialog (screen readers will not announce it)");
  await ctx.close(); await anon.close();
}
await browser.close();
console.log(problems.length ? `\n${problems.length} keyboard problem(s):\n- ${problems.join("\n- ")}` : "\nkeyboard pass: focus visible, no traps, no unnamed stops");
process.exit(problems.length ? 1 : 0);
