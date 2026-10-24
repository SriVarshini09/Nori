/**
 * Generic, label-based form handling shared by every driver: field discovery, classification,
 * filling, submit-button lookup and CAPTCHA detection.
 */
import path from "node:path";
import type { Locator, Page } from "playwright";
import type { DriverContext, FormField, PendingQuestion, Receipt, ApplicantProfile } from "@jobgraph/core";
import { foreignWorkCountry } from "@jobgraph/core";
import {
  runScript, DISCOVER_SCRIPT, SELECT_OPTIONS_SCRIPT, CHOICE_LABELS_SCRIPT, FORCE_VALUE_SCRIPT,
  FIND_SUBMIT_SCRIPT, CAPTCHA_SCRIPT, FIELD_ERROR_SCRIPT,
} from "./dom.js";

export type FieldClass =
  | "first_name" | "last_name" | "full_name" | "email" | "phone" | "linkedin" | "website" | "github" | "social"
  | "location" | "country" | "resume" | "cover_letter" | "work_auth" | "sponsorship" | "custom";

/** Discovery output: a FormField plus hints the filler uses (extra props survive as plain JSON). */
export type DiscoveredField = FormField & { combobox?: boolean; group?: "phone_country" };

/** Selectors tried, in order, as the form root before falling back to form heuristics. */
export const PREFERRED_FORM_SELECTORS = ["#application_form", "form#application-form", "#application-form", "form[data-testid*=application i]"];

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * A field label without the page's decoration. Some forms glue the required marker and helper text onto the label
 * ("Resume/CV ✱ATTACH RESUME/CVCouldn't auto-read resume..."), which would make labels unreadable on a receipt and
 * impossible to match against answers the person saved. Cut at the marker; drop a trailing "*".
 */
export function cleanLabel(raw: string, options: string[] = []): string {
  let s = clean(raw);
  // A radio or checkbox group's label can arrive with its options' text glued on ("RaceHispanic or Latino..."): cut there.
  const cuts = options.map((o) => clean(o)).filter((o) => o.length >= 4).map((o) => s.indexOf(o)).filter((i) => i > 0);
  if (cuts.length) s = s.slice(0, Math.min(...cuts));
  const mark = s.search(/[✱＊]/);
  if (mark > 0) s = s.slice(0, mark);
  s = s.replace(/\s*\*+\s*$/, "").trim();
  return s || clean(raw);
}

/** Find every input/textarea/select in the main application form. Tags the chosen form with data-jobgraph-form. */
export async function discoverFields(page: Page, preferred: string[] = PREFERRED_FORM_SELECTORS): Promise<FormField[]> {
  const fields = await runScript<DiscoveredField[]>(page, DISCOVER_SCRIPT, preferred);
  for (const f of fields) f.label = cleanLabel(f.label, f.options);
  for (const f of fields) {
    if (!f.combobox) continue;
    // react-select style: the listbox only renders while open, so open it, read the options, close it.
    const options = await comboboxOptionTexts(page, f.selector).catch(() => [] as string[]);
    if (options.length) f.options = options;
  }
  return fields;
}

export function classifyField(field: Pick<FormField, "label" | "kind">): FieldClass {
  const l = field.label.toLowerCase().replace(/\s+/g, " ").trim();
  const has = (re: RegExp) => re.test(l);
  if (has(/cover letter/)) return "cover_letter";
  if (has(/\bresume\b|\bcv\b|résumé|curriculum vitae/)) return "resume";
  if (has(/sponsor|\bvisa\b|h-?1b/)) return "sponsorship";
  if (has(/authori[sz]ed to work|work authori[sz]ation|legally (authori[sz]ed|eligible|able)|eligible to work|right to work|work permit/)) return "work_auth";
  if (has(/linkedin/)) return "linkedin";
  if (has(/github/)) return "github";
  if (has(/twitter|\bx\.com\b|\bx (handle|profile)\b|gitlab|mastodon|bluesky|dribbble|behance|stack ?overflow|facebook|instagram|tiktok/)) return "social";
  if (has(/e-?mail/)) return "email";
  if (has(/first name|given name|forename/)) return "first_name";
  if (has(/last name|surname|family name/)) return "last_name";
  if (has(/full name|legal name/) || /^(your )?name$/.test(l)) return "full_name";
  if (has(/phone|mobile|telephone|cell/)) return "phone";
  if (has(/website|portfolio|personal (site|url|page)|^url$|blog/)) return "website";
  if (/^country\b/.test(l) || has(/country of residence|which country/)) return "country";
  if (has(/location|city|where are you (based|located)|current address/)) return "location";
  return "custom";
}

const yesNo = (b: boolean | undefined) => (b === undefined ? undefined : b ? "Yes" : "No");

/** "US" -> "United States"; names pass through. */
export function countryName(country: string | undefined): string | undefined {
  if (!country) return undefined;
  const c = country.trim();
  if (/^[A-Za-z]{2}$/.test(c)) {
    try {
      return new Intl.DisplayNames(["en"], { type: "region" }).of(c.toUpperCase()) ?? c;
    } catch {
      return c;
    }
  }
  return c;
}

const DIAL_CODES: Record<string, string> = {
  "7": "RU", "20": "EG", "27": "ZA", "30": "GR", "31": "NL", "32": "BE", "33": "FR", "34": "ES", "36": "HU", "39": "IT",
  "40": "RO", "41": "CH", "43": "AT", "44": "GB", "45": "DK", "46": "SE", "47": "NO", "48": "PL", "49": "DE", "51": "PE", "52": "MX",
  "54": "AR", "55": "BR", "56": "CL", "57": "CO", "60": "MY", "61": "AU", "62": "ID", "63": "PH", "64": "NZ", "65": "SG", "66": "TH",
  "81": "JP", "82": "KR", "84": "VN", "86": "CN", "90": "TR", "91": "IN", "92": "PK", "234": "NG", "254": "KE", "351": "PT", "353": "IE",
  "358": "FI", "380": "UA", "420": "CZ", "852": "HK", "880": "BD", "886": "TW", "966": "SA", "971": "AE", "972": "IL",
};

/** Country for the phone dialing-code picker, from the profile phone ("+1 ..." => United States). */
export function phoneCountryValue(profile: ApplicantProfile): string | undefined {
  const m = profile.phone?.trim().match(/^(?:\+|00)\s*(\d{1,3})/);
  if (m) {
    const digits = m[1]!;
    if (digits.startsWith("1")) {
      // NANP: +1 covers the US and Canada; trust the profile country when it says Canada.
      return countryName(/^(ca|canada)$/i.test(profile.country ?? "") ? "CA" : "US");
    }
    for (const len of [3, 2, 1]) {
      const iso = digits.length >= len ? DIAL_CODES[digits.slice(0, len)] : undefined;
      if (iso) return countryName(iso);
    }
  }
  return countryName(profile.country);
}

export function profileValue(cls: FieldClass, profile: ApplicantProfile, resumePdfPath?: string): string | undefined {
  switch (cls) {
    case "first_name": return profile.firstName;
    case "last_name": return profile.lastName;
    case "full_name": return profile.fullName;
    case "email": return profile.email;
    case "phone": return profile.phone;
    case "linkedin": return profile.linkedin;
    case "website": return profile.website;
    case "github": return profile.github;
    case "location": return profile.location;
    case "country": return countryName(profile.country);
    case "resume": return resumePdfPath;
    case "work_auth": return yesNo(profile.workAuth.authorizedUS);
    case "sponsorship": return yesNo(profile.workAuth.needsSponsorship);
    default: return undefined;
  }
}

/** Optional fields of these classes stay blank when the profile has no value (no answer generation). */
const BLANK_WHEN_ABSENT = new Set<FieldClass>(["github", "social", "website", "linkedin", "country"]);

export const norm = (s: string) => s.toLowerCase().replace(/\*/g, "").replace(/\s+/g, " ").trim();

const YES = /^(y|yes|true|1|i am|i do|i will)\b/i;
const NO = /^(n|no|false|0|i am not|i do not|i don't|i will not)\b/i;
const CHECK_ON = /^(y|yes|true|1|on|checked|acknowledged?|i acknowledge|agreed?|i agree|accept(ed)?|i accept|confirm(ed)?|i confirm)\b/i;
function polarity(s: string): "yes" | "no" | undefined {
  const t = s.trim();
  if (NO.test(t)) return "no";
  if (YES.test(t)) return "yes";
  return undefined;
}

/** Pick the option best matching value: exact text, exact value, yes/no polarity, prefix, substring. */
function matchOption<T extends { text: string; value: string }>(opts: T[], value: string): T | undefined {
  const v = norm(value);
  const usable = opts.filter((o) => o.value !== "" || o.text !== "");
  return (
    usable.find((o) => norm(o.text) === v) ??
    usable.find((o) => norm(o.value) === v) ??
    (polarity(value) ? usable.find((o) => o.value !== "" && polarity(o.text) === polarity(value)) : undefined) ??
    usable.find((o) => o.value !== "" && norm(o.text).startsWith(v)) ??
    usable.find((o) => o.value !== "" && v.length >= 3 && norm(o.text).includes(v))
  );
}

/** Index of the option text best matching value (case-insensitive): exact, shortest containing, longest contained, polarity. */
function pickIndex(texts: string[], value: string): number {
  const v = norm(value);
  const t = texts.map(norm);
  const exact = t.findIndex((x) => x === v);
  if (exact >= 0) return exact;
  const ranked = (pred: (x: string) => boolean, shortest: boolean) => {
    const hits = t.map((x, j) => ({ x, j })).filter(({ x }) => x !== "" && pred(x));
    hits.sort((a, b) => (shortest ? a.x.length - b.x.length : b.x.length - a.x.length));
    return hits[0]?.j ?? -1;
  };
  const containing = ranked((x) => x.includes(v), true);
  if (containing >= 0) return containing;
  const contained = ranked((x) => x.length >= 2 && v.includes(x), false);
  if (contained >= 0) return contained;
  const p = polarity(value);
  return p ? t.findIndex((x) => polarity(x) === p) : -1;
}

async function waitForCount(loc: Locator, ms: number): Promise<number> {
  const deadline = Date.now() + ms;
  for (;;) {
    const n = await loc.count().catch(() => 0);
    if (n > 0 || Date.now() >= deadline) return n;
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** [role=option] items of the listbox this combobox controls (falls back to any visible listbox). */
async function comboOptionLocator(page: Page, input: Locator): Promise<Locator> {
  const id = (await input.getAttribute("aria-controls").catch(() => null)) || (await input.getAttribute("aria-owns").catch(() => null));
  if (id) {
    const box = page.locator(`[id=${JSON.stringify(id)}]`);
    if (await box.count()) return box.locator('[role="option"]');
  }
  return page.locator('[role="listbox"]:visible [role="option"]');
}

async function openCombobox(page: Page, input: Locator): Promise<Locator> {
  await input.click({ timeout: 5000 }).catch(() => input.focus());
  let opts = await comboOptionLocator(page, input);
  if (!(await waitForCount(opts, 1500))) {
    await input.press("ArrowDown").catch(() => {});
    opts = await comboOptionLocator(page, input);
    await waitForCount(opts, 1000);
  }
  return opts;
}

export async function comboboxOptionTexts(page: Page, selector: string): Promise<string[]> {
  const input = page.locator(selector).first();
  try {
    const opts = await openCombobox(page, input);
    const texts = (await opts.allInnerTexts()).map(clean).filter(Boolean);
    return [...new Set(texts)];
  } finally {
    await input.press("Escape").catch(() => {});
  }
}

async function fillCombobox(page: Page, field: FormField, value: string): Promise<string> {
  const input = page.locator(field.selector).first();
  let lastError = "";
  // Menus re-render (filtering, async options, blur timers), so an option can detach mid-click: retry a few times.
  for (let attempt = 0; attempt < 3; attempt++) {
    await input.click({ timeout: 5000 }).catch(() => input.focus());
    await input.fill(attempt === 2 ? "" : value).catch(() => {});
    let opts = await comboOptionLocator(page, input);
    let texts = (await waitForCount(opts, 2500)) ? await opts.allInnerTexts() : [];
    let idx = pickIndex(texts, value);
    if (idx < 0) {
      // The typed filter may not match the option wording; clear it and search the full list.
      await input.fill("").catch(() => {});
      opts = await openCombobox(page, input);
      texts = await opts.allInnerTexts();
      idx = pickIndex(texts, value);
    }
    if (idx < 0) {
      await input.press("Escape").catch(() => {});
      throw new Error(`No option matching "${value}" for "${field.label}"`);
    }
    try {
      await opts.nth(idx).click({ timeout: 3000 });
      return clean(texts[idx]!);
    } catch (err) {
      lastError = err instanceof Error ? err.message.split(/\r?\n/)[0]! : String(err);
    }
  }
  await input.press("Escape").catch(() => {});
  throw new Error(`Could not pick "${value}" for "${field.label}": ${lastError}`);
}

/** Fill one field. Returns the value as it now reads on the page (option text for choices, file name for files). */
export async function fillField(page: Page, field: FormField, value: string): Promise<string> {
  const loc = page.locator(field.selector).first();
  switch (field.kind) {
    case "file": {
      await loc.setInputFiles(value);
      return path.basename(value);
    }
    case "select": {
      const tag = await loc.evaluate((el) => el.tagName);
      if (tag !== "SELECT") return fillCombobox(page, field, value);
      const opts = await runScript<{ text: string; value: string }[]>(page, SELECT_OPTIONS_SCRIPT, field.selector);
      const hit = matchOption(opts, value);
      if (!hit) throw new Error(`No option matching "${value}" for "${field.label}"`);
      await loc.selectOption({ value: hit.value });
      return hit.text;
    }
    case "radio":
    case "checkbox": {
      const labels = await runScript<{ label: string; value: string }[]>(page, CHOICE_LABELS_SCRIPT, field.selector);
      const all = page.locator(field.selector);
      if (field.kind === "checkbox" && labels.length <= 1) {
        const on = CHECK_ON.test(value.trim());
        await setChecked(loc, on);
        return on ? "Yes" : "No";
      }
      const wanted = field.kind === "checkbox" ? value.split(/[;,|]/).map((s) => s.trim()).filter(Boolean) : [value];
      const chosen: string[] = [];
      for (const w of wanted) {
        const opts = labels.map((l, i) => ({ text: l.label, value: l.value, i }));
        const hit = matchOption(opts, w);
        if (!hit) throw new Error(`No choice matching "${w}" for "${field.label}"`);
        await setChecked(all.nth(hit.i), true);
        chosen.push(hit.text || hit.value);
      }
      return chosen.join(", ");
    }
    default: {
      await loc.fill(value);
      let current = await loc.inputValue().catch(() => "");
      if (current !== value) {
        await runScript(page, FORCE_VALUE_SCRIPT, [field.selector, value]);
        current = await loc.inputValue().catch(() => value);
      }
      return current;
    }
  }
}

async function setChecked(loc: Locator, on: boolean) {
  try {
    await loc.setChecked(on, { timeout: 5000 });
  } catch {
    // Custom-styled inputs hide the real control behind a label.
    await loc.setChecked(on, { force: true, timeout: 5000 });
  }
}

/**
 * Places-style autocomplete (Greenhouse "Location (City)"): typing is not enough, a suggestion
 * must be picked. Clicks the first suggestion within 2 s, else ArrowDown+Enter only when the input
 * advertises autocomplete (never Enter on a plain input: that could submit the form).
 * Returns the field's value afterwards.
 */
export async function settleAutocomplete(page: Page, field: FormField, ctx: DriverContext): Promise<string> {
  const input = page.locator(field.selector).first();
  const first = page.locator('[role="listbox"]:visible [role="option"]')
    .or(page.locator(".pac-container:visible .pac-item"))
    .or(page.locator('ul[id*="autocomplete"]:visible li'))
    .first();
  const deadline = Date.now() + 2000;
  let picked = false;
  while (Date.now() < deadline) {
    if (await first.isVisible().catch(() => false)) {
      await first.click().catch(() => {});
      picked = true;
      break;
    }
    await page.waitForTimeout(100);
  }
  if (!picked) {
    const role = await input.getAttribute("role").catch(() => null);
    const auto = await input.getAttribute("aria-autocomplete").catch(() => null);
    if (role === "combobox" || auto) {
      await input.press("ArrowDown").catch(() => {});
      await input.press("Enter").catch(() => {});
      picked = true;
    }
  }
  await page.waitForTimeout(150);
  const error = await runScript<string | null>(page, FIELD_ERROR_SCRIPT, field.selector).catch(() => null);
  if (error || !picked) {
    ctx.onEvent("field_warn", `"${field.label}" may not have accepted the location${error ? `: ${error}` : " (no suggestion picked)"}`, { label: field.label, error });
  }
  return input.inputValue().catch(() => "");
}

export type FillOutcome = { filled: Receipt["fields"]; pending: PendingQuestion[]; files: string[] };

const isPhoneCountry = (f: FormField) => (f as DiscoveredField).group === "phone_country" || /^phone country code$/i.test(f.label);

/**
 * Fill every discovered field. Value precedence: ctx.answers by label (explicit user decisions),
 * then the profile, then ctx.answerQuestion. Required fields left without a value become pending.
 */
export async function fillForm(page: Page, ctx: DriverContext, fields: FormField[], jobContext: string): Promise<FillOutcome> {
  const answers = new Map(Object.entries(ctx.answers ?? {}).map(([k, v]) => [norm(k), v]));
  const filled: Receipt["fields"] = [];
  const pending: PendingQuestion[] = [];
  const files: string[] = [];

  const classes = fields.map((f) => (f.kind === "file" || classifyField(f) !== "resume" ? classifyField(f) : "custom"));
  // A lone unlabeled file input is almost always the resume upload.
  if (!classes.includes("resume")) {
    const i = fields.findIndex((f, j) => f.kind === "file" && classes[j] === "custom");
    if (i >= 0) classes[i] = "resume";
  }

  for (const [i, field] of fields.entries()) {
    const cls = classes[i]!;

    if (isPhoneCountry(field)) {
      // Part of the phone field: chosen from the phone's dialing code, never asked as a question.
      const value = answers.get(norm(field.label)) || phoneCountryValue(ctx.profile);
      if (!value) {
        ctx.onEvent("field_skipped", "No dialing code in profile phone; phone country left as is", { label: field.label });
        continue;
      }
      try {
        const actual = await fillField(page, field, value);
        filled.push({ label: field.label, value: actual, kind: field.kind });
        ctx.onEvent("field_filled", `Filled "${field.label}"`, { label: field.label, kind: field.kind, classification: "phone", source: "profile", value: actual });
      } catch (err) {
        ctx.onEvent("field_warn", `Could not set phone country: ${err instanceof Error ? err.message : String(err)}`, { label: field.label });
      }
      continue;
    }

    let value: string | null | undefined = answers.get(norm(field.label));
    let source = "answers";
    if (value === undefined || value === "") {
      // The profile's work authorization is US-only; "authorised to work in the UK?" is not answered from it.
      const foreign = (cls === "work_auth" || cls === "sponsorship") && foreignWorkCountry(field.label);
      value = foreign ? undefined : profileValue(cls, ctx.profile, ctx.resumePdfPath);
      source = "profile";
    }
    const mayAsk = cls !== "resume" && !(field.kind === "file" && !field.required) && !(BLANK_WHEN_ABSENT.has(cls) && !field.required);
    if ((value === undefined || value === "") && mayAsk) {
      value = await ctx.answerQuestion(field, jobContext);
      source = "answerQuestion";
    }
    if (value === undefined || value === null || value === "") {
      if (field.required) {
        pending.push({ label: field.label, type: field.kind, required: true, ...(field.options ? { options: field.options } : {}) });
        ctx.onEvent("field_pending", `No answer for required field "${field.label}"`, { label: field.label, kind: field.kind });
      } else {
        ctx.onEvent("field_skipped", `Skipped optional field "${field.label}"`, { label: field.label, kind: field.kind });
      }
      continue;
    }
    try {
      let actual = await fillField(page, field, value);
      if (cls === "location" && field.kind !== "select") actual = (await settleAutocomplete(page, field, ctx)) || actual;
      filled.push({ label: field.label, value: actual, kind: field.kind });
      if (field.kind === "file") files.push(value);
      ctx.onEvent("field_filled", `Filled "${field.label}"`, {
        label: field.label, kind: field.kind, classification: cls, source,
        value: field.kind === "file" ? actual : actual.slice(0, 120),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.onEvent("field_error", `Could not fill "${field.label}": ${message}`, { label: field.label, kind: field.kind });
      if (field.required) pending.push({ label: field.label, type: field.kind, required: true, ...(field.options ? { options: field.options } : {}) });
    }
  }
  await verifyFilled(page, ctx, fields, filled, pending);
  return { filled, pending, files };
}

const TEXT_KINDS = new Set<FormField["kind"]>(["text", "email", "tel", "textarea"]);

/**
 * Re-read every text field once the whole form is filled. A page's own scripts can reject or clear a value after we set it
 * (an autocomplete that "found no location", a field that re-renders), and a receipt must show what the form really holds:
 * what is in the box now replaces what we typed, and a field that ended up empty is not reported as filled.
 */
async function verifyFilled(page: Page, ctx: DriverContext, fields: FormField[], filled: Receipt["fields"], pending: PendingQuestion[]): Promise<void> {
  await page.waitForTimeout(250);
  for (const entry of [...filled]) {
    const field = fields.find((f) => f.label === entry.label && TEXT_KINDS.has(f.kind));
    if (!field) continue;
    const now = await page.locator(field.selector).first().inputValue().catch(() => null);
    if (now === null || now === entry.value) continue;
    if (now.trim() === "") {
      filled.splice(filled.indexOf(entry), 1);
      ctx.onEvent("field_warn", `"${field.label}" is empty after filling: the form did not keep the value`, { label: field.label, wanted: entry.value });
      if (field.required) pending.push({ label: field.label, type: field.kind, required: true });
    } else {
      ctx.onEvent("field_warn", `"${field.label}" holds "${now.slice(0, 60)}" rather than what was typed`, { label: field.label, wanted: entry.value, actual: now });
      entry.value = now;
    }
  }
}

/** Locate the submit control (button text first, then type=submit in the form). Never clicks it. */
export async function findSubmitButton(page: Page) {
  const label = await runScript<string | null>(page, FIND_SUBMIT_SCRIPT);
  return label ? { label, locator: page.locator("[data-jobgraph-submit]").first() } : null;
}

/** Returns a reason string when a CAPTCHA challenge is visible, else null. */
export async function detectCaptcha(page: Page): Promise<string | null> {
  for (const frame of page.frames()) {
    const url = frame.url();
    if (/recaptcha|hcaptcha|turnstile|challenges\.cloudflare/i.test(url) && !/size=invisible/i.test(url) && frame !== page.mainFrame()) {
      const el = await frame.frameElement().catch(() => null);
      const box = el ? await el.boundingBox().catch(() => null) : null;
      if (box && box.width >= 20 && box.height >= 20) return `frame:${url.slice(0, 120)}`;
    }
  }
  return runScript<string | null>(page, CAPTCHA_SCRIPT);
}

export const CAPTCHA_QUESTION: PendingQuestion = { label: "CAPTCHA", type: "captcha", required: true };
