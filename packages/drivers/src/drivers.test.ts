import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { DriverContext, FormField } from "@jobgraph/core";
import { GreenhouseDriver } from "./greenhouse.js";
import { chromium } from "playwright";
import { runApplyFlow } from "./flow.js";
import { ashbyApplyUrl, classifyField, cleanLabel, discoverFields, fillForm, leverApplyUrl, phoneCountryValue, pickDriver, WebDriver } from "./index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_URL = pathToFileURL(path.resolve(here, "../fixtures/greenhouse-form.html")).toString();
const TIMEOUT = 60_000;

let tmp: string;
let resumePath: string;

beforeAll(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "jobgraph-drivers-"));
  resumePath = path.join(tmp, "resume.pdf");
  await writeFile(resumePath, "%PDF-1.4\n% test resume\n%%EOF\n");
});

const savedEnv = process.env.ALLOW_REAL_SUBMIT;
afterEach(() => {
  if (savedEnv === undefined) delete process.env.ALLOW_REAL_SUBMIT;
  else process.env.ALLOW_REAL_SUBMIT = savedEnv;
});

function makeCtx(overrides: Partial<DriverContext> = {}) {
  const events: { step: string; message: string }[] = [];
  const answerQuestion = vi.fn(async (field: FormField) => {
    if (/why do you want to work here/i.test(field.label)) return "I love building robots that ship.";
    if (/how did you hear/i.test(field.label)) return "LinkedIn";
    if (/which office/i.test(field.label)) return "remote";
    if (/acknowledge/i.test(field.label)) return "Yes";
    return null;
  });
  const ctx: DriverContext = {
    applyUrl: FIXTURE_URL,
    profile: {
      fullName: "Ada Lovelace", firstName: "Ada", lastName: "Lovelace", email: "ada@example.com",
      phone: "+1 415 555 0100", linkedin: "https://linkedin.com/in/ada", website: "https://ada.dev",
      location: "San Francisco, CA", country: "US", workAuth: { authorizedUS: true, needsSponsorship: false },
    },
    resumePdfPath: resumePath,
    answers: {},
    answerQuestion,
    waitForCode: async () => null,
    dryRun: true,
    onEvent: (step, message) => { events.push({ step, message }); },
    artifactsDir: path.join(tmp, `run-${Math.random().toString(36).slice(2)}`),
    headless: true,
    ...overrides,
  };
  return { ctx, events, answerQuestion };
}

const field = (r: { receipt: { fields: { label: string; value: string; kind: string }[] } }, re: RegExp) =>
  r.receipt.fields.find((f) => re.test(f.label));

describe("GreenhouseDriver on the offline fixture", () => {
  it("dry run fills every field and does not submit", async () => {
    delete process.env.ALLOW_REAL_SUBMIT;
    const { ctx, events, answerQuestion } = makeCtx();
    const result = await new GreenhouseDriver().run(ctx);
    expect(result.outcome, JSON.stringify(result)).toBe("filled");
    if (result.outcome !== "filled") return;
    const r = result;
    expect(field(r, /first name/i)?.value).toBe("Ada");
    expect(field(r, /^email/i)?.value).toBe("ada@example.com");
    expect(field(r, /resume/i)).toMatchObject({ kind: "file", value: "resume.pdf" });
    expect(r.receipt.files).toContain(resumePath);
    expect(field(r, /authorized to work/i)).toMatchObject({ kind: "select", value: "Yes" });
    expect(field(r, /sponsorship/i)).toMatchObject({ kind: "radio", value: "No" });
    expect(field(r, /why do you want/i)?.value).toBe("I love building robots that ship.");
    expect(field(r, /hear about us/i)?.value).toBe("LinkedIn");
    expect(answerQuestion.mock.calls.map(([f]) => f.label)).toContain("Why do you want to work here?");
    expect(r.receipt.fields.some((f) => /leave this blank/i.test(f.label))).toBe(false); // honeypot untouched

    // react-select comboboxes are discovered as selects with options read from the opened listbox
    const office = r.fields.find((f) => /which office/i.test(f.label));
    expect(office).toMatchObject({ kind: "select", required: true });
    expect(office?.options).toEqual(["San Francisco", "New York", "Remote (US)"]);
    expect(field(r, /which office/i)).toMatchObject({ kind: "select", value: "Remote (US)" });
    // acknowledgment checkbox
    expect(r.fields.find((f) => /acknowledge/i.test(f.label))).toMatchObject({ kind: "checkbox", options: ["Yes"], required: true });
    expect(field(r, /acknowledge/i)).toMatchObject({ kind: "checkbox", value: "Yes" });
    // social fields stay blank without a profile value and are never sent to answer generation
    expect(field(r, /github/i)).toBeUndefined();
    expect(field(r, /twitter/i)).toBeUndefined();
    expect(answerQuestion.mock.calls.some(([f]) => /github|twitter/i.test(f.label))).toBe(false);
    expect(field(r, /^website$/i)?.value).toBe("https://ada.dev");
    // standalone Country -> profile.country; phone dialing-code picker -> from "+1"
    expect(field(r, /^country$/i)?.value).toBe("United States");
    expect(field(r, /phone country code/i)?.value).toBe("United States +1");
    // Places-style autocomplete: the suggestion is picked, not just typed
    expect(field(r, /location/i)?.value).toBe("San Francisco, California, United States");
    expect(events.some((e) => e.step === "field_warn")).toBe(false);
    expect(r.receipt.screenshotPath && existsSync(r.receipt.screenshotPath)).toBe(true);
    expect(r.receipt.confirmationText).toBeUndefined();
    expect(r.receipt.dryRun).toBe(true);
    expect(events.some((e) => e.step === "submit")).toBe(false);
  }, TIMEOUT);

  it("dryRun false without ALLOW_REAL_SUBMIT still does not submit", async () => {
    delete process.env.ALLOW_REAL_SUBMIT;
    const { ctx, events } = makeCtx({ dryRun: false });
    const result = await new GreenhouseDriver().run(ctx);
    expect(result.outcome, JSON.stringify(result)).toBe("filled");
    if (result.outcome !== "filled") return;
    expect(result.receipt.confirmationText).toBeUndefined();
    expect(events.some((e) => e.step === "submit")).toBe(false);
    expect(events.some((e) => e.step === "submit_skipped")).toBe(true);
  }, TIMEOUT);

  it("submits only with dryRun false and ALLOW_REAL_SUBMIT=true", async () => {
    process.env.ALLOW_REAL_SUBMIT = "true";
    const base = makeCtx().ctx.profile;
    const { ctx } = makeCtx({ dryRun: false, profile: { ...base, github: "https://github.com/ada" } });
    const result = await new GreenhouseDriver().run(ctx);
    expect(result.outcome, JSON.stringify(result)).toBe("submitted");
    if (result.outcome !== "submitted") return;
    expect(field(result, /github/i)?.value).toBe("https://github.com/ada");
    expect(result.receipt.confirmationText).toMatch(/Thank you/);
    expect(result.receipt.submittedVia).toBe("greenhouse");
    expect(result.receipt.dryRun).toBe(false);
    expect(result.receipt.screenshotPath && existsSync(result.receipt.screenshotPath)).toBe(true);
  }, TIMEOUT);

  it("a required field with no answer yields needs_user", async () => {
    process.env.ALLOW_REAL_SUBMIT = "true";
    const base = makeCtx().ctx.profile;
    const { ctx, events } = makeCtx({
      dryRun: false,
      // No dialing code and no country: the phone country picker is skipped, never pending.
      profile: { ...base, phone: "415 555 0100", country: undefined },
      answerQuestion: async (f) => (/why do you want/i.test(f.label) ? "Robots." : /which office/i.test(f.label) ? "New York" : null),
    });
    const result = await new GreenhouseDriver().run(ctx);
    expect(result.outcome, JSON.stringify(result)).toBe("needs_user");
    if (result.outcome !== "needs_user") return;
    expect(result.pending).toHaveLength(2);
    expect(result.pending).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "How did you hear about us?", type: "select", required: true }),
      expect.objectContaining({ label: "I acknowledge that the information I have provided is accurate.", type: "checkbox", required: true }),
    ]));
    expect(result.pending.find((p) => p.type === "select")?.options).toContain("LinkedIn");
    expect(result.pending.some((p) => /country/i.test(p.label))).toBe(false);
    expect(field(result, /which office/i)?.value).toBe("New York");
    expect(events.some((e) => e.step === "submit")).toBe(false);
  }, TIMEOUT);
});

describe("routing and classification", () => {
  it("derives the phone country from the dialing code", () => {
    const p = { fullName: "A B", firstName: "A", lastName: "B", email: "a@b.c", workAuth: {} };
    expect(phoneCountryValue({ ...p, phone: "+1 415 555 0100" })).toBe("United States");
    expect(phoneCountryValue({ ...p, phone: "+1 604 555 0100", country: "CA" })).toBe("Canada");
    expect(phoneCountryValue({ ...p, phone: "+91 98765 43210" })).toBe("India");
    expect(phoneCountryValue({ ...p, phone: "+44 20 7946 0000" })).toBe("United Kingdom");
    expect(phoneCountryValue({ ...p, phone: "415 555 0100" })).toBeUndefined();
  });

  it("picks drivers by URL", () => {
    expect(pickDriver("https://boards.greenhouse.io/acme/jobs/123")?.atsType).toBe("greenhouse");
    expect(pickDriver("https://job-boards.greenhouse.io/acme/jobs/123?gh_src=x")?.atsType).toBe("greenhouse");
    expect(pickDriver("https://acme.com/careers?gh_jid=123")?.atsType).toBe("greenhouse");
    expect(pickDriver("https://acme.com/careers/42")?.atsType).toBe("web");
    expect(pickDriver("mailto:jobs@acme.com")).toBeNull();
    expect(new WebDriver().supports("http://x.test")).toBe(true);
  });

  it("routes Lever, Ashby and SmartRecruiters postings to their own drivers", () => {
    expect(pickDriver("https://jobs.lever.co/acme/5f1c2a3b-0000-4000-8000-123456789abc")?.atsType).toBe("lever");
    expect(pickDriver("https://jobs.eu.lever.co/acme/5f1c2a3b-0000-4000-8000-123456789abc/apply")?.atsType).toBe("lever");
    expect(pickDriver("https://jobs.lever.co/acme")?.atsType).toBe("web"); // a company index is not a posting
    expect(pickDriver("https://jobs.ashbyhq.com/acme/5f1c2a3b-0000-4000-8000-123456789abc")?.atsType).toBe("ashby");
    expect(pickDriver("https://jobs.ashbyhq.com/acme")?.atsType).toBe("web");
    expect(pickDriver("https://jobs.smartrecruiters.com/Acme/743999-senior-engineer")?.atsType).toBe("smartrecruiters");
    expect(pickDriver("https://evil.example/jobs.lever.co/acme/123")?.atsType).toBe("web"); // the host decides, not the path
  });

  it("opens the application step of a Lever or Ashby posting", () => {
    const id = "5f1c2a3b-0000-4000-8000-123456789abc";
    expect(leverApplyUrl(`https://jobs.lever.co/acme/${id}`)).toBe(`https://jobs.lever.co/acme/${id}/apply`);
    expect(leverApplyUrl(`https://jobs.lever.co/acme/${id}/apply?lever-source=LinkedIn#x`)).toBe(`https://jobs.lever.co/acme/${id}/apply?lever-source=LinkedIn`);
    expect(leverApplyUrl("https://jobs.lever.co/acme")).toBeNull();
    expect(leverApplyUrl("not a url")).toBeNull();
    expect(ashbyApplyUrl(`https://jobs.ashbyhq.com/acme/${id}`)).toBe(`https://jobs.ashbyhq.com/acme/${id}/application`);
    expect(ashbyApplyUrl(`https://jobs.ashbyhq.com/acme/${id}/application`)).toBe(`https://jobs.ashbyhq.com/acme/${id}/application`);
    expect(ashbyApplyUrl("https://example.com/acme/1")).toBeNull();
  });

  it("classifies labels", () => {
    const c = (label: string, kind: FormField["kind"] = "text") => classifyField({ label, kind });
    expect(c("First Name")).toBe("first_name");
    expect(c("Surname")).toBe("last_name");
    expect(c("Name")).toBe("full_name");
    expect(c("Email address", "email")).toBe("email");
    expect(c("Mobile phone", "tel")).toBe("phone");
    expect(c("LinkedIn Profile")).toBe("linkedin");
    expect(c("Portfolio / Website")).toBe("website");
    expect(c("Resume/CV", "file")).toBe("resume");
    expect(c("Cover Letter", "file")).toBe("cover_letter");
    expect(c("Will you now or in the future require visa sponsorship for employment authorization?")).toBe("sponsorship");
    expect(c("Are you legally authorized to work in the United States?")).toBe("work_auth");
    expect(c("Current location")).toBe("location");
    expect(c("Location (City)")).toBe("location");
    expect(c("Github")).toBe("github");
    expect(c("Twitter")).toBe("social");
    expect(c("Country")).toBe("country");
    expect(c("Why do you want to work here?", "textarea")).toBe("custom");
  });
});

describe("labels and what the form really holds", () => {
  it("strips the page's required marker and helper text from labels", () => {
    expect(cleanLabel("Full name✱")).toBe("Full name");
    expect(cleanLabel("Resume/CV ✱ATTACH RESUME/CVCouldn't auto-read resume.Analyzing resume...Success!")).toBe("Resume/CV");
    expect(cleanLabel("Current location ✱No location found. Try entering a different locationLoading")).toBe("Current location");
    expect(cleanLabel("Email address *")).toBe("Email address");
    expect(cleanLabel("  Are you   over 18?  ")).toBe("Are you over 18?");
    expect(cleanLabel("✱")).toBe("✱"); // never returns an empty label
    // a group label with its options' text glued on
    expect(cleanLabel("RaceHispanic or LatinoA person of Cuban, Mexican or other Spanish cultureWhite", ["Hispanic or Latino", "White", "Asian"])).toBe("Race");
    expect(cleanLabel("Gender", ["Male", "Female"])).toBe("Gender");
    expect(cleanLabel("Pick a plan", ["Plan"])).toBe("Pick a plan"); // an option's text at the start never empties the label
  });

  it("does not report a field as filled when the page cleared it afterwards, and records what is really there", async () => {
    // "Location" and "Favourite colour" are cleared by the page's own script a moment after they are set (like an autocomplete that
    // finds no match);
    // "Nickname" is rewritten by the page to upper case; "Name" is left alone.
    const html = `<form id="application_form">
      <label for="n">Name</label><input id="n" name="n" type="text">
      <label for="l">Location</label><input id="l" name="l" type="text">
      <label for="k">Nickname</label><input id="k" name="k" type="text">
      <label for="r">Favourite colour (required)</label><input id="r" name="r" type="text" required>
      <button type="submit">Submit application</button></form>
      <script>
        document.getElementById("l").addEventListener("change", (e) => { setTimeout(() => { e.target.value = ""; }, 120); });
        document.getElementById("r").addEventListener("input", (e) => { setTimeout(() => { e.target.value = ""; }, 120); });
        document.getElementById("k").addEventListener("change", (e) => { setTimeout(() => { e.target.value = e.target.value.toUpperCase(); }, 120); });
      </script>`;
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(html);
      const fields = await discoverFields(page);
      const events: string[] = [];
      const { ctx } = makeCtx({ onEvent: (_s: string, m: string) => { events.push(m); }, answers: { Name: "Nori Dryrun", Location: "San Francisco, CA", Nickname: "nori", "Favourite colour (required)": "green" } });
      const out = await fillForm(page, ctx, fields, "");
      const byLabel = Object.fromEntries(out.filled.map((f) => [f.label, f.value]));
      expect(byLabel.Name).toBe("Nori Dryrun");
      expect(byLabel).not.toHaveProperty("Location"); // cleared by the page: not claimed
      expect(byLabel.Nickname).toBe("NORI"); // the value the form actually holds
      expect(out.pending.map((p) => p.label)).toContain("Favourite colour (required)"); // required and rejected: the person is asked
      expect(events.some((e) => /"Location" is empty after filling/.test(e))).toBe(true);
    } finally { await browser.close(); }
  }, TIMEOUT);
});

describe("a site that turns automation away", () => {
  it("hands the application to the person with a clear reason, instead of failing with 'no form'", async () => {
    const blocked = path.join(tmp, "blocked.html");
    await writeFile(blocked, `<html><body><h1>SmartRecruiters</h1><p>Access is temporarily restricted</p>
      <p>We detected unusual activity from your device or network. Reasons may include: Automated (bot) activity on your network.</p></body></html>`);
    const { ctx } = makeCtx({ applyUrl: pathToFileURL(blocked).toString() });
    const res = await runApplyFlow(ctx, { name: "test" });
    expect(res.outcome).toBe("needs_user");
    if (res.outcome !== "needs_user") return;
    expect(res.pending).toEqual([{ label: "This site blocks automated applications: open the posting and apply yourself", type: "blocked", required: true }]);
    expect(res.receipt.fields).toEqual([]);
    expect(res.receipt.dryRun).toBe(true);
  }, TIMEOUT);

  it("still reports an ordinary page with no form as a failure", async () => {
    const plain = path.join(tmp, "plain.html");
    await writeFile(plain, "<html><body><h1>Careers</h1><p>Nothing to apply to here.</p></body></html>");
    const { ctx } = makeCtx({ applyUrl: pathToFileURL(plain).toString() });
    const res = await runApplyFlow(ctx, { name: "test" });
    expect(res).toMatchObject({ outcome: "failed", error: "No application form fields found" });
  }, TIMEOUT);
});
