import { mkdir } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, it } from "vitest";
import { expect } from "@playwright/test";
import type { Browser, BrowserContext, Page } from "playwright";
import { jobs } from "@jobgraph/core";
import { ROOT, RESUME_TEXT, startStack, type Stack } from "../scripts/stack.mjs";
import { WEB, launchBrowser, newSession, previewHtml } from "./helpers";

const EMAIL = "e2e.user@example.com";
const PASSWORD = "journey-pass-2026";
const SHOTS = path.join(ROOT, "test-results/e2e");

let stack: Stack;
let browser: Browser;
let ctx: BrowserContext;
let page: Page;
let errors: string[];

const api = async (p: string, init?: { method?: string; data?: unknown }) => {
  const r = await ctx.request.fetch(`${WEB}${p}`, { method: init?.method ?? "GET", data: init?.data });
  const ct = r.headers()["content-type"] ?? "";
  return { status: r.status(), headers: r.headers(), json: ct.includes("json") ? await r.json() : null, body: ct.includes("json") ? null : await r.body() };
};
const shot = (name: string) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
const settle = (ms = 400) => page.waitForTimeout(ms);

beforeAll(async () => {
  await mkdir(SHOTS, { recursive: true });
  stack = await startStack();
  browser = await launchBrowser();
  ({ ctx, page, errors } = await newSession(browser));
}, 600_000);

afterAll(async () => {
  await browser?.close();
  await stack?.stop();
});

describe("1. visitors and accounts", () => {
  it("sends a signed-out visitor to the login page and remembers where they were going", async () => {
    await page.goto(`${WEB}/resume`);
    await page.waitForURL(/\/login\?next=%2Fresume/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  it("rejects a wrong password without leaving the page", async () => {
    await page.goto(`${WEB}/login`);
    await page.locator("input[type=email]").fill("nobody@example.com");
    await page.locator("input[type=password]").fill("not-the-password");
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page.getByText(/invalid|incorrect|wrong|not match|couldn/i).first()).toBeVisible({ timeout: 15_000 });
    expect(page.url()).toContain("/login");
  });

  it("creates an account and lands in onboarding", async () => {
    await page.goto(`${WEB}/signup`);
    await page.locator("input").nth(0).fill("Maya Chen");
    await page.locator("input[type=email]").fill(EMAIL);
    await page.locator("input[type=password]").fill(PASSWORD);
    await page.getByRole("button", { name: /create account/i }).click();
    await page.waitForURL(/\/onboarding/, { timeout: 30_000 });
    await expect(page.getByRole("button", { name: /get started/i })).toBeVisible();
    await shot("01-onboarding-welcome");
  });

  it("walks the onboarding wizard: paste a resume, confirm it, answer the basics", async () => {
    await page.getByRole("button", { name: /get started/i }).click();
    await page.getByRole("button", { name: /paste text instead/i }).click();
    await page.locator("textarea").fill(RESUME_TEXT);
    await page.getByRole("button", { name: /^(continue|read|build)/i }).first().click();
    await page.getByRole("button", { name: /looks right/i }).click({ timeout: 90_000 });
    await shot("02-onboarding-resume-read");
    for (let i = 0; i < 12 && !/\/dashboard/.test(page.url()); i++) {
      await settle(700);
      const next = page.getByRole("button", { name: /^(continue|finish|go to dashboard|open (my )?dashboard|done|skip for now)/i }).first();
      if (await next.count()) { await next.scrollIntoViewIfNeeded(); await next.click().catch(() => {}); }
    }
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
    await expect(page.getByText(/maya/i).first()).toBeVisible();
  });

  it("signs out, and signs back in with the same account", async () => {
    await page.getByRole("button", { name: /log out/i }).first().click();
    await page.waitForURL(/\/login/);
    await page.locator("input[type=email]").fill(EMAIL);
    await page.locator("input[type=password]").fill(PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  });
});

describe("2. resume studio", () => {
  it("shows the first resume, created from the uploaded one, in the library", async () => {
    await page.getByRole("link", { name: "Resume", exact: true }).first().click();
    await page.waitForURL(/\/resume$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/your resumes/i);
    const cards = page.getByRole("list", { name: "Your resumes" }).getByRole("listitem");
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText("My resume");
    await expect(cards.first()).toContainText("Default");
    await shot("03-library");
  });

  it("opens the studio with the content, a live preview and an ATS report", async () => {
    await page.getByRole("link", { name: /open my resume/i }).click();
    await page.waitForURL(/\/resume\/[0-9a-f-]{36}$/);
    await expect(page.getByLabel("Resume name")).toHaveValue("My resume");
    await expect(page.getByLabel("Full name")).toHaveValue("Maya Chen");
    const html = await previewHtml(page);
    expect(html).toContain("Maya Chen");
    expect(html).toContain("Lumen Analytics");
    await expect(page.getByLabel(/^ATS score/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("list", { name: "ATS checks" }).getByRole("listitem").first()).toBeVisible();
    await expect(page.getByText(/^1 page$/).first()).toBeVisible();
    await shot("04-studio-content");
  });

  it("autosaves an edit as a new version and shows it in the preview", async () => {
    const summary = page.getByRole("textbox", { name: "Summary" });
    await summary.fill("Frontend engineer who makes slow dashboards fast and accessible.");
    await expect(page.getByRole("status").filter({ hasText: /^Saved · version/ })).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await previewHtml(page)).includes("makes slow dashboards fast"), { timeout: 20_000 }).toBe(true);
    const docs = (await api("/api/resume-docs")).json;
    expect(docs[0].version).toBeGreaterThanOrEqual(2);
    const doc = (await api(`/api/resume-docs/${docs[0].id}`)).json;
    expect(doc.content.summary).toContain("slow dashboards fast");
  });

  it("edits a bullet, adds a role, and counts words", async () => {
    const bullet = page.getByLabel("Role 1 bullet 1", { exact: true });
    await bullet.fill("Rebuilt the analytics dashboard in React and Next.js, cutting p95 load from 4.2s to 1.1s for two million monthly users");
    await expect(page.getByText(/edited by you/i).first()).toBeVisible();
    await page.getByRole("button", { name: "Add role" }).click();
    await page.getByLabel("Job title").last().fill("Staff Engineer");
    await page.getByLabel("Company").last().fill("Orbit Labs");
    await page.getByLabel("Role 3 bullet 1", { exact: true }).fill("Led the design system rollout across six product teams with measurable consistency gains");
    await expect.poll(async () => (await previewHtml(page)).includes("Orbit Labs"), { timeout: 20_000 }).toBe(true);
    await expect(page.getByRole("status").filter({ hasText: /^Saved · version/ })).toBeVisible({ timeout: 20_000 });
  });

  it("hides and reorders sections", async () => {
    await page.getByRole("button", { name: "Hide Projects" }).click();
    await expect.poll(async () => /PROJECTS|>Projects</.test(await previewHtml(page)), { timeout: 20_000 }).toBe(false);
    await page.getByRole("button", { name: "Show Projects" }).click();
    await page.getByRole("button", { name: "Move Skills up" }).click();
    await page.getByRole("button", { name: "Move Skills up" }).click();
    await expect.poll(async () => { const h = await previewHtml(page); return h.indexOf('id="skills"') < h.indexOf('id="experience"'); }, { timeout: 20_000 }).toBe(true);
    await page.getByRole("button", { name: "Move Skills down" }).click();
    await page.getByRole("button", { name: "Move Skills down" }).click();
  });

  it("switches template and restyles, and the choice survives a reload", async () => {
    await page.getByRole("tab", { name: "design" }).click();
    await expect(page.getByRole("radiogroup", { name: "Template" }).getByRole("radio")).toHaveCount(7);
    await expect(page.getByRole("radio", { name: /Classic/ })).toHaveAttribute("aria-checked", "true");
    await shot("05-studio-design");
    await page.getByRole("radio", { name: /Modern/ }).click();
    await expect(page.getByRole("radio", { name: /Modern/ })).toHaveAttribute("aria-checked", "true");
    await expect.poll(async () => (await previewHtml(page)).includes("'Inter'"), { timeout: 20_000 }).toBe(true);
    await page.getByRole("radio", { name: "Accent #7c3aed" }).click();
    await expect.poll(async () => (await previewHtml(page)).includes("#7c3aed"), { timeout: 20_000 }).toBe(true);
    await page.getByLabel("Page size").selectOption("a4");
    await expect.poll(async () => (await previewHtml(page)).includes("size: A4"), { timeout: 20_000 }).toBe(true);
    await expect(page.getByRole("status").filter({ hasText: /^Saved · version/ })).toBeVisible({ timeout: 20_000 });
    await page.reload();
    await page.getByRole("tab", { name: "design" }).click();
    await expect(page.getByRole("radio", { name: /Modern/ })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByLabel("Page size")).toHaveValue("a4");
    const html = await previewHtml(page);
    expect(html).toContain("#7c3aed");
    expect(html).toContain("Orbit Labs");
  });

  it("warns that a two-column template is not ATS-safe, and lowers the score honestly", async () => {
    await page.getByRole("radio", { name: /Sidebar/ }).click();
    await expect(page.getByText(/two-column layouts can scramble/i)).toBeVisible();
    await expect(page.getByRole("list", { name: "ATS checks" })).toContainText(/single column/i);
    await expect.poll(async () => (await previewHtml(page)).includes("grid-template-columns"), { timeout: 20_000 }).toBe(true);
    await shot("06-studio-sidebar");
    await page.getByRole("radio", { name: /Modern/ }).click();
  });

  it("downloads PDF, Word, text, JSON and HTML that match the document", async () => {
    await page.getByRole("tab", { name: "content" }).click();
    await page.getByText("Download", { exact: true }).first().click();
    const hrefs = await page.getByRole("list", { name: "Download formats" }).getByRole("link").evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute("href")!));
    expect(hrefs).toHaveLength(6);
    const get = (f: string) => hrefs.find((h) => h.includes(`format=${f}`) && !h.includes("inline"))!;
    const pdf = await api(get("pdf"));
    expect(pdf.status).toBe(200);
    expect(pdf.body!.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.headers["content-disposition"]).toContain("Maya-Chen-Resume.pdf");
    const docx = await api(get("docx"));
    expect(docx.body!.subarray(0, 2).toString()).toBe("PK");
    const txt = await api(get("txt"));
    expect(txt.body!.toString()).toContain("Orbit Labs");
    const json = await api(get("json"));
    expect(json.json.content.experience.some((r: any) => r.company === "Orbit Labs")).toBe(true);
    const html = await api(get("html"));
    expect(html.body!.toString()).toContain("Orbit Labs");
    await page.keyboard.press("Escape");
  });

  it("keeps a history and restores the first version", async () => {
    await page.getByRole("tab", { name: "history" }).click();
    const list = page.getByRole("list", { name: "Version history" });
    await expect(list.getByRole("listitem").first()).toBeVisible({ timeout: 15_000 });
    const count = await list.getByRole("listitem").count();
    expect(count).toBeGreaterThanOrEqual(3);
    await list.getByRole("listitem").last().getByRole("button", { name: "Restore" }).click();
    await expect(page.getByText(/restored version 1/i)).toBeVisible({ timeout: 20_000 });
    await page.getByRole("tab", { name: "content" }).click();
    await expect(page.getByRole("textbox", { name: "Summary" })).toHaveValue("");
    await expect.poll(async () => (await previewHtml(page)).includes("Orbit Labs"), { timeout: 20_000 }).toBe(false);
  });

  it("creates a blank resume, duplicates it, makes it the default, and deletes it", async () => {
    page.on("dialog", (d) => void d.accept());
    await page.goto(`${WEB}/resume`);
    await page.getByRole("button", { name: "Blank resume" }).click();
    await page.waitForURL(/\/resume\/[0-9a-f-]{36}$/);
    await expect(page.getByLabel("Full name")).toHaveValue("Maya Chen");
    await page.getByLabel("Resume name").fill("Blank draft");
    await expect(page.getByRole("status").filter({ hasText: /^Saved · version/ })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("link", { name: "All resumes" }).click();
    await page.waitForURL(/\/resume$/);
    const cards = page.getByRole("list", { name: "Your resumes" }).getByRole("listitem");
    await expect(cards).toHaveCount(2);
    const blank = cards.filter({ hasText: "Blank draft" });
    await blank.getByRole("button", { name: "Make default" }).click();
    await expect(blank).toContainText("Default");
    await expect(cards.filter({ hasText: "My resume" })).not.toContainText("Default");
    await blank.getByRole("button", { name: "Duplicate" }).click();
    await expect(cards).toHaveCount(3);
    await cards.filter({ hasText: "Copy of Blank draft" }).getByRole("button", { name: /delete/i }).click();
    await expect(cards).toHaveCount(2);
    await shot("07-library-after");
  });

  it("shows a friendly 404 for a resume that does not exist", async () => {
    const res = await page.goto(`${WEB}/resume/00000000-0000-0000-0000-000000000000`);
    expect(res?.status()).toBe(404);
    await expect(page.getByText(/does not exist/i)).toBeVisible();
  });
});

describe("3. tailored resume for an application", () => {
  let appId: string;

  it("creates an application whose resume uses the default document's look", async () => {
    await stack.db.insert(jobs).values({
      companyName: "Acme", atsType: "web", externalId: "acme-e2e", title: "Senior Frontend Engineer", location: "San Francisco, CA", remote: true,
      descriptionText: "Requirements:\n- React and TypeScript\n- Node.js\n- Testing with Playwright\nNice to have:\n- GraphQL", applyUrl: "https://example.com/?job=e2e",
    });
    const list = (await api("/api/jobs?limit=20&wait=1")).json as { job: { id: string; companyName: string } }[];
    const job = list.find((x) => x.job.companyName === "Acme")!;
    const created = await api("/api/applications?wait=1", { method: "POST", data: { jobId: job.job.id } });
    expect(created.status).toBe(201);
    appId = created.json.id;
    const detail = (await api(`/api/applications/${appId}`)).json;
    expect(detail.application.status).toBe("resume_review");
    const defaultDoc = ((await api("/api/resume-docs")).json as { isDefault: boolean; templateId: string }[]).find((d) => d.isDefault)!;
    expect(detail.resume.templateId).toBe(defaultDoc.templateId);
  });

  it("opens the review, and edits the resume from there", async () => {
    await page.goto(`${WEB}/applications/${appId}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Senior Frontend Engineer");
    await shot("08-review-before");
    await page.getByRole("link", { name: "Edit resume" }).click();
    await page.waitForURL(new RegExp(`/applications/${appId}/resume$`));
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Edit resume for Senior Frontend Engineer at Acme/);
    await expect(page.getByRole("button", { name: "Save and re-render" })).toBeDisabled(); // nothing changed yet
    const first = page.getByLabel("Role 1 bullet 1", { exact: true });
    await first.fill("Shipped a faster checkout by moving the flow to React and TypeScript, cutting load time by forty-five percent");
    await page.getByRole("tab", { name: "design" }).click();
    await page.getByRole("radio", { name: /Executive/ }).click();
    await expect.poll(async () => (await previewHtml(page)).includes("Garamond"), { timeout: 20_000 }).toBe(true);
    await shot("09-edit-application-resume");
    await page.getByRole("button", { name: "Save and re-render" }).click();
    await page.waitForURL(new RegExp(`/applications/${appId}$`), { timeout: 60_000 });
  });

  it("shows the edit honestly in the review and keeps the application waiting for approval", async () => {
    await expect(page.getByText("Edited by you").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Executive template/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve resume" })).toBeEnabled();
    const detail = (await api(`/api/applications/${appId}`)).json;
    expect(detail.resume).toMatchObject({ version: 2, edited: true, templateId: "executive" });
    expect(detail.resume.changes.some((c: { reason: string }) => c.reason === "Edited by you")).toBe(true);
    expect(detail.application.status).toBe("resume_review");
    await shot("10-review-after");
  });

  it("downloads the edited tailored resume as PDF and Word", async () => {
    const detail = (await api(`/api/applications/${appId}`)).json;
    const pdf = await api(`/api/resumes/${detail.resume.id}/download?format=pdf`);
    expect(pdf.body!.subarray(0, 5).toString()).toBe("%PDF-");
    const docx = await api(`/api/resumes/${detail.resume.id}/download?format=docx`);
    expect(docx.body!.subarray(0, 2).toString()).toBe("PK");
  });

  it("approving the resume ends editing", async () => {
    await page.getByRole("button", { name: "Approve resume" }).click();
    await expect(page.getByText("Approved").first()).toBeVisible({ timeout: 60_000 });
    await page.goto(`${WEB}/applications/${appId}/resume`);
    await expect(page.getByText(/can no longer be edited/i)).toBeVisible();
  });
});

describe("4. nothing broke along the way", () => {
  it("raised no page errors, console errors or server errors", () => {
    expect(errors).toEqual([]);
  });
});
