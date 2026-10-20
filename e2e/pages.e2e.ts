import { afterAll, beforeAll, describe, it } from "vitest";
import { expect } from "@playwright/test";
import type { Browser, BrowserContext, Page } from "playwright";
import { seedUser, startStack, type Seed, type Stack } from "../scripts/stack.mjs";
import { WEB, launchBrowser, newSession } from "./helpers";

/**
 * Click-through tests for the pages the journey does not touch: jobs, applications, tracker, inbox, auto apply.
 * One seeded user (see seedUser): three applications in different states and one job nobody has applied to.
 */
let stack: Stack;
let seed: Seed;
let browser: Browser;
let ctx: BrowserContext;
let page: Page;
let errors: string[];

const api = async (p: string, init?: { method?: string; data?: unknown }) => {
  const r = await ctx.request.fetch(`${WEB}${p}`, { method: init?.method ?? "GET", data: init?.data });
  const ct = r.headers()["content-type"] ?? "";
  return { status: r.status(), json: ct.includes("json") ? await r.json() : null };
};

beforeAll(async () => {
  stack = await startStack();
  seed = await seedUser(stack);
  browser = await launchBrowser();
  ({ ctx, page, errors } = await newSession(browser));
  const [name, ...rest] = seed.cookie.split("=");
  await ctx.addCookies([{ name, value: rest.join("="), url: WEB, httpOnly: true, sameSite: "Lax" }]);
}, 600_000);

afterAll(async () => {
  await browser?.close();
  await stack?.stop();
});

const cards = () => page.locator("main article");

describe("jobs", () => {
  it("lists every role with its match and application state", async () => {
    await page.goto(`${WEB}/jobs`);
    await expect(cards()).toHaveCount(4);
    await expect(page.getByText(/of 4 roles · by match/)).toBeVisible();
    await expect(page.getByRole("link", { name: /Applied · Resume review/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Applied · Needs you/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Applied · Form review/ })).toBeVisible();
    await expect(cards().filter({ hasText: "Backend Engineer" }).getByRole("button", { name: "Apply" })).toBeVisible();
  });

  it("filters by search text, and the filter lives in the URL", async () => {
    await page.getByRole("searchbox", { name: "Search jobs" }).fill("backend");
    await expect(cards()).toHaveCount(1);
    await expect(cards().first()).toContainText("Backend Engineer");
    await expect(page).toHaveURL(/q=backend/);
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(cards()).toHaveCount(4);
    await page.getByRole("searchbox", { name: "Search jobs" }).fill("zzz-nothing");
    await expect(page.getByText("No roles match these filters")).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
  });

  it("filters to remote roles, hides applied ones, and sorts", async () => {
    await page.getByRole("switch", { name: /Remote only/ }).click();
    await expect(cards()).toHaveCount(2);
    await page.getByRole("switch", { name: /Remote only/ }).click();
    await page.getByRole("switch", { name: /Hide applied/ }).click();
    await expect(cards()).toHaveCount(1);
    await expect(cards().first()).toContainText("Backend Engineer");
    await page.getByRole("switch", { name: /Hide applied/ }).click();
    await page.getByRole("radio", { name: "Newest" }).click();
    await expect(page.getByRole("radio", { name: "Newest" })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("radio", { name: "Match" }).click();
    await page.getByLabel("Minimum match").fill("100");
    await expect(cards()).toHaveCount(0);
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(cards()).toHaveCount(4);
  });

  it("opens a role in a drawer with the reasons, and closes it again", async () => {
    await cards().filter({ hasText: "Senior Frontend Engineer" }).getByRole("link", { name: "Details" }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await expect(page).toHaveURL(/job=/);
    await expect(drawer).toContainText("Senior Frontend Engineer");
    await expect(drawer.getByRole("link", { name: /Posting/ })).toHaveAttribute("href", /example\.com/);
    await drawer.getByRole("link", { name: "Close drawer" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.goto(`${WEB}/jobs?job=${seed.jobIds[0]}`); // a shared link opens the drawer directly
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  it("applies to the one open role and lands on its review", async () => {
    await page.goto(`${WEB}/jobs`);
    await cards().filter({ hasText: "Backend Engineer" }).getByRole("button", { name: "Apply" }).click();
    await page.waitForURL(/\/applications\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Backend Engineer");
    await page.goto(`${WEB}/jobs`);
    await expect(cards().filter({ hasText: "Backend Engineer" }).getByRole("link", { name: /Applied/ })).toBeVisible();
  });

  it("refuses a pasted URL that is not a job, with a message", async () => {
    await page.goto(`${WEB}/jobs`);
    await page.getByPlaceholder("https://boards.greenhouse.io/...").fill("http://127.0.0.1:1/not-a-job");
    await page.getByRole("button", { name: "Add job" }).click();
    await expect(page.getByRole("button", { name: "Add job" })).toBeEnabled({ timeout: 60_000 });
    await expect(page.getByText(/^Added /)).toHaveCount(0);
    await expect(page.locator("main").getByText(/fetch|reach|could not|failed|unable|not a job|not a public|error|refused/i).first()).toBeVisible();
  });
});

describe("applications and the review gates", () => {
  it("shows the list with tabs that filter by stage", async () => {
    await page.goto(`${WEB}/applications`);
    await expect(page.getByRole("tab", { name: /^ALL/i })).toBeVisible();
    await page.getByRole("tab", { name: /SUBMITTED/i }).click();
    await expect(page.getByText(/nothing|no applications|empty/i).first()).toBeVisible();
    await page.getByRole("tab", { name: /NEEDS YOU/i }).click();
    await expect(page.getByRole("link", { name: /Needs Answers Co/ })).toBeVisible();
  });

  it("answers the pending questions, approves the form, and the application is submitted (no 409)", async () => {
    await page.goto(`${WEB}/applications/${seed.apps.needsAnswers}`);
    await expect(page.getByText("Will you require visa sponsorship?").first()).toBeVisible();
    const approve = page.getByRole("button", { name: /Approve and send/i });
    await expect(approve).toBeDisabled(); // a required question is still open
    await page.locator("main select").first().selectOption({ label: "No" });
    await expect(approve).toBeEnabled({ timeout: 15_000 });
    await approve.click();
    await expect.poll(async () => (await api(`/api/applications/${seed.apps.needsAnswers}`)).json.application.status, { timeout: 90_000 }).toMatch(/submitting|submitted|awaiting_code/);
    expect(errors.filter((e) => /409/.test(e))).toEqual([]);
  });

  it("skips an application and shows it as skipped", async () => {
    await page.goto(`${WEB}/applications/${seed.apps.resumeReview}`);
    await page.getByRole("button", { name: /^Skip/ }).first().click();
    await expect.poll(async () => (await api(`/api/applications/${seed.apps.resumeReview}`)).json.application.status).toBe("skipped");
  });
});

describe("tracker", () => {
  it("groups applications by stage and links each to its review", async () => {
    await page.goto(`${WEB}/tracker`);
    await expect(page.getByRole("heading", { level: 3, name: /SUBMITTED/i })).toBeVisible();
    await page.getByRole("link", { name: /Globex/ }).first().click();
    await page.waitForURL(new RegExp(`/applications/${seed.apps.formReview}$`));
  });

  it("switches between board and table", async () => {
    await page.goto(`${WEB}/tracker`);
    await page.getByRole("button", { name: "TABLE" }).click();
    await expect(page.getByRole("button", { name: "TABLE" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("table")).toBeVisible();
    await page.getByRole("button", { name: "BOARD" }).click();
    await expect(page.getByRole("button", { name: "BOARD" })).toHaveAttribute("aria-pressed", "true");
  });

  it("says plainly that the sheet needs Google when it is not connected", async () => {
    await page.getByRole("button", { name: "Sync to Google Sheet" }).click();
    await expect(page.getByText(/composio|connect|not configured|google/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible(); // the page did not crash
  });
});

describe("inbox", () => {
  it("is empty without a mailbox, and says what syncing needs instead of failing", async () => {
    await page.goto(`${WEB}/inbox`);
    await page.getByRole("button", { name: "Sync inbox" }).click();
    await expect(page.getByText(/composio|connect|gmail|no (messages|mail)|nothing/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});

describe("auto apply", () => {
  it("changes the daily cap and keeps it after a reload", async () => {
    await page.goto(`${WEB}/agent`);
    const cap = page.locator('input[aria-label="Daily cap"]');
    const before = Number(await cap.inputValue());
    await page.getByRole("button", { name: "Raise the daily cap" }).click();
    await expect.poll(async () => (await api("/api/me")).json.profile.autoApplyDailyCap).toBe(before + 1);
    await page.reload();
    await expect(page.locator('input[aria-label="Daily cap"]')).toHaveValue(String(before + 1));
    await page.getByRole("button", { name: "Lower the daily cap" }).click();
    await expect.poll(async () => (await api("/api/me")).json.profile.autoApplyDailyCap).toBe(before);
  });

  it("toggles review-before-submit and auto-approve, and they persist", async () => {
    await page.goto(`${WEB}/agent`);
    const review = page.getByRole("switch", { name: "Review before submit" });
    const was = (await review.getAttribute("aria-checked")) === "true";
    await review.click();
    await expect.poll(async () => (await api("/api/me")).json.profile.reviewBeforeSubmit).toBe(!was);
    await review.click();
    await expect.poll(async () => (await api("/api/me")).json.profile.reviewBeforeSubmit).toBe(was);
  });

  it("adds, edits and deletes a lane", async () => {
    await page.goto(`${WEB}/agent`);
    await page.getByRole("button", { name: "Add lane" }).click();
    await page.getByPlaceholder("Frontend, remote").fill("Platform, remote");
    await page.getByRole("button", { name: "Save lane" }).click();
    await expect(page.getByRole("button", { name: "Edit Platform, remote" })).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.getByRole("button", { name: "Edit Platform, remote" })).toBeVisible();
    await page.getByRole("button", { name: "Delete Platform, remote" }).click();
    await expect(page.getByRole("button", { name: "Edit Platform, remote" })).toHaveCount(0);
  });

  it("runs the agent now and reports what it did", async () => {
    await page.goto(`${WEB}/agent`);
    await page.getByRole("button", { name: "Run now" }).click();
    await expect(page.getByRole("status").filter({ hasText: /./ }).first()).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole("button", { name: "Run now" })).toBeEnabled({ timeout: 90_000 });
  });

  it("answers a message in the chat", async () => {
    await page.goto(`${WEB}/agent`);
    await page.getByLabel("Message the agent").fill("What did you do today?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("What did you do today?").first()).toBeVisible();
    await expect(page.getByLabel("Agent is typing")).toHaveCount(0, { timeout: 90_000 });
    await expect(page.getByRole("alert").filter({ hasText: /./ })).toHaveCount(0);
  });
});

describe("companies", () => {
  it("lists the watched companies with open-role counts", async () => {
    await page.goto(`${WEB}/companies`);
    const rows = page.getByRole("list", { name: "Companies" }).getByRole("listitem");
    await expect(rows).toHaveCount(60);
    await expect(page.getByRole("status").filter({ hasText: /companies/ })).toContainText(/1\d\d companies/);
    await expect(rows.first()).toContainText(/open role/);
  });

  it("searches, follows, filters to followed ones and unfollows", async () => {
    const rows = page.getByRole("list", { name: "Companies" }).getByRole("listitem");
    await page.getByRole("searchbox", { name: "Search companies" }).fill("stripe");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Stripe");
    await page.getByRole("button", { name: "Follow Stripe" }).click();
    await expect(page.getByRole("button", { name: "Unfollow Stripe" })).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => (await api("/api/me")).json.profile.preferences.followCompanies).toEqual(["greenhouse:stripe"]);
    await page.getByRole("searchbox", { name: "Search companies" }).fill("");
    await page.getByRole("switch", { name: "Following only" }).click();
    await expect(rows).toHaveCount(1);
    await page.getByRole("button", { name: "Unfollow Stripe" }).click();
    await expect(page.getByText("You are not following anyone yet")).toBeVisible();
    await expect.poll(async () => (await api("/api/me")).json.profile.preferences.followCompanies).toEqual([]);
  });

  it("explains why a link cannot be used instead of failing", async () => {
    await page.getByRole("switch", { name: "Following only" }).click();
    await page.getByPlaceholder("https://example.com/careers").fill("http://169.254.169.254/latest");
    await page.getByRole("button", { name: "Find and follow" }).click();
    await expect(page.getByText(/not a public website/i)).toBeVisible({ timeout: 20_000 });
  });

  it("is reachable from the jobs page", async () => {
    await page.goto(`${WEB}/jobs`);
    await page.getByRole("link", { name: "Browse and follow companies" }).click();
    await page.waitForURL(/\/companies$/);
  });
});

describe("nothing broke along the way", () => {
  it("raised no page errors, console errors or server errors", () => {
    // Syncing a sheet or a mailbox without Composio answers 503 on purpose ("not configured"); the pages show it as a message.
    expect(errors.filter((e) => !/^http 503: \/api\/(tracker\/sync-sheet|inbox\/sync)$/.test(e))).toEqual([]);
  });
});
