import { describe, expect, it } from "vitest";
import type { ApplicantProfile, FormField } from "../contracts.js";
import type { profiles } from "../db/schema.js";
import { educationAnswer, heuristicAnswer, inferCountry, inferState, makeAnswerQuestion, toApplicantProfile, type ApplicantProfileFull, type EducationFact } from "./answers.js";

const base: ApplicantProfile = {
  fullName: "Jordan Rivera", firstName: "Jordan", lastName: "Rivera", email: "jordan@example.com",
  linkedin: "https://linkedin.com/in/jr", github: "https://github.com/jr", location: "San Francisco, CA",
  workAuth: { authorizedUS: true },
};
const sel = (label: string, options?: string[], kind: FormField["kind"] = "select"): FormField => ({ label, kind, required: true, options, selector: "#x" });
const ans = (f: FormField, p: Partial<ApplicantProfile> = {}) => heuristicAnswer(f, { ...base, ...p, workAuth: { ...base.workAuth, ...(p.workAuth ?? {}) } });

describe("geography inference", () => {
  it("infers US state and country from a location", () => {
    expect(inferState("San Francisco, CA")).toEqual({ abbr: "CA", name: "California" });
    expect(inferState("Austin, Texas, USA")?.abbr).toBe("TX");
    expect(inferState("London, UK")).toBeUndefined();
    expect(inferCountry({ location: "San Francisco, CA" })).toBe("United States");
    expect(inferCountry({ location: "Remote (US)" })).toBe("United States");
    expect(inferCountry({ location: "Toronto, Canada" })).toBe("Canada");
    expect(inferCountry({ country: "US", location: "Berlin, Germany" })).toBe("United States");
    expect(inferCountry({ location: "Berlin" })).toBeUndefined();
  });

  const row: typeof profiles.$inferSelect = {
    userId: "u", fullName: "Jordan Rivera", email: "j@x.com", phone: null, linkedin: null, website: null, location: "Seattle, WA",
    city: null, state: null, country: null, github: null, pronouns: null,
    workAuth: {}, willingToRelocate: null, remotePreference: null, heardAbout: null, salaryExpectation: null,
    earliestStartDate: null, noticePeriodWeeks: null,
    eeo: { gender: "decline", race: "decline", veteran: "decline", disability: "decline" },
    securityClearance: null, over18: null, onboarding: { step: "resume" },
    preferences: { github: "https://github.com/jr" } as never, rawResumeText: null, resumeAutoApprove: false,
    reviewBeforeSubmit: true, autopilot: "off", autoApplyDailyCap: 0, autoApplyMinScore: 0.7, updatedAt: new Date(),
  };

  it("builds country and github on the ApplicantProfile (legacy preferences keys)", () => {
    const p = toApplicantProfile(row);
    expect(p.country).toBe("US");
    expect(p.github).toBe("https://github.com/jr");
    expect(toApplicantProfile({ ...row, preferences: { country: "Canada" } as never }).country).toBe("CA");
  });

  it("prefers the new columns: country, github, city/state, screening answers", () => {
    const p = toApplicantProfile({
      ...row, location: null, city: "Austin", state: "TX", country: "United States", github: "https://github.com/col",
      workAuth: { authorizedUS: true, needsSponsorship: false, status: "permanent_resident", visaType: "" },
      heardAbout: "LinkedIn", salaryExpectation: { amount: 150000, currency: "USD", period: "year" }, noticePeriodWeeks: 2,
      earliestStartDate: "2026-12-01", over18: true, willingToRelocate: false, securityClearance: "None",
      eeo: { gender: "Female", race: "decline", veteran: "decline", disability: "decline" },
    });
    expect(p.country).toBe("US");
    expect(p.github).toBe("https://github.com/col");
    expect(p.location).toBe("Austin, TX, United States");
    expect(p.city).toBe("Austin");
    expect(p.state).toBe("TX");
    expect(p.workAuth).toEqual({ authorizedUS: true, needsSponsorship: false, notes: undefined, status: "permanent_resident", visaType: undefined });
    expect(p.salaryExpectation?.amount).toBe(150000);
    expect(p.noticePeriodWeeks).toBe(2);
    expect(p.over18).toBe(true);
    expect(p.eeo?.gender).toBe("Female");
    expect(toApplicantProfile({ ...row, country: "CA", preferences: { country: "US" } as never }).country).toBe("CA");
    expect(toApplicantProfile({ ...row, salaryExpectation: { amount: 0 } }).salaryExpectation).toBeUndefined();
  });
});

describe("heuristicAnswer (onboarding screening answers)", () => {
  const full = (p: Partial<ApplicantProfileFull>) => (f: FormField) =>
    heuristicAnswer(f, { ...base, ...p, workAuth: { ...base.workAuth, ...(p.workAuth ?? {}) } } as ApplicantProfileFull);

  it("salary: amount when known, blank when absent", () => {
    const a = full({ salaryExpectation: { amount: 150000, currency: "USD", period: "year" } });
    expect(a(sel("What are your salary expectations?", undefined, "text"))).toBe("150,000 USD per year");
    expect(a(sel("Desired compensation (numbers only)", undefined, "text"))).toBe("150000");
    expect(a(sel("Expected salary", ["$100,000 - $140,000", "$140,000 - $180,000", "$180k+"]))).toBe("$140,000 - $180,000");
    expect(ans(sel("What are your salary expectations?", undefined, "text"))).toBeNull();
  });

  it("start date and notice period", () => {
    const a = full({ earliestStartDate: "2026-12-01", noticePeriodWeeks: 2 });
    expect(a(sel("What is your earliest start date?", undefined, "text"))).toBe("2026-12-01");
    expect(a(sel("What is your notice period?", undefined, "text"))).toBe("2 weeks");
    expect(a(sel("Notice period", ["Immediately", "2 weeks", "1 month"]))).toBe("2 weeks");
    expect(full({ noticePeriodWeeks: 0 })(sel("When can you start?", undefined, "text"))).toBe("Immediately");
    expect(ans(sel("What is your notice period?", undefined, "text"))).toBeNull();
  });

  it("heard about, clearance, over 18, relocation", () => {
    const a = full({ heardAbout: "LinkedIn", securityClearance: "None", over18: true, willingToRelocate: true });
    expect(a(sel("How did you hear about us?", ["Referral", "LinkedIn", "Other"]))).toBe("LinkedIn");
    expect(a(sel("How did you hear about this job?", undefined, "text"))).toBe("LinkedIn");
    expect(a(sel("Do you hold an active security clearance?", ["Yes", "No"]))).toBe("No");
    expect(full({ securityClearance: "Top Secret" })(sel("Security clearance level", ["None", "Secret", "Top Secret"]))).toBe("Top Secret");
    expect(a(sel("Are you at least 18 years of age?", ["Yes", "No"]))).toBe("Yes");
    expect(a(sel("Are you willing to relocate?", ["Yes", "No"]))).toBe("Yes");
    expect(ans(sel("Are you at least 18 years of age?", ["Yes", "No"]))).toBeNull();
  });

  it("EEO uses the chosen value, else declines", () => {
    const a = full({ eeo: { gender: "Female", race: "Asian", veteran: "not a veteran", disability: "no" } });
    expect(a(sel("Gender", ["Male", "Female", "Decline to self-identify"]))).toBe("Female");
    expect(a(sel("Race", ["Asian", "White", "I don't wish to answer"]))).toBe("Asian");
    expect(a(sel("Veteran Status", ["I am a protected veteran", "I am not a protected veteran", "I prefer not to answer"]))).toBe("I am not a protected veteran");
    expect(a(sel("Disability Status", ["Yes, I have a disability", "No, I do not have a disability", "I do not want to answer"]))).toBe("No, I do not have a disability");
    expect(full({ eeo: { gender: "Nonbinary" } })(sel("Gender", ["Male", "Female", "Decline to self-identify"]))).toBe("Decline to self-identify");
    expect(full({ eeo: { gender: "decline" } })(sel("Gender", ["Male", "Female", "I prefer not to say"]))).toBe("I prefer not to say");
  });

  it("work authorization status picks citizen / permanent resident / visa wording", () => {
    const f = sel("What is your current work authorization status?", ["U.S. Citizen", "Lawful Permanent Resident (Green Card)", "H-1B Visa", "Other"]);
    expect(full({ workAuth: { status: "citizen" } })(f)).toBe("U.S. Citizen");
    expect(full({ workAuth: { status: "permanent_resident" } })(f)).toBe("Lawful Permanent Resident (Green Card)");
    expect(full({ workAuth: { status: "visa", visaType: "H1B" } })(f)).toBe("H-1B Visa");
    expect(full({ workAuth: { status: "other" } })(f)).toBe("Other");
    expect(full({ workAuth: { status: "citizen" } })(sel("Are you legally authorized to work in the United States?", ["Yes", "No"]))).toBe("Yes");
  });
});

describe("heuristicAnswer (Greenhouse-style required questions)", () => {
  it("country of residence picks the matching option", () => {
    const f = sel("What country do you currently reside in?", ["Canada", "United States", "United Kingdom"]);
    expect(ans(f)).toBe("United States");
    expect(ans(sel("Country of residence"))).toBe("United States");
    expect(ans(sel("Country", ["United States of America", "Mexico"]))).toBe("United States of America");
    expect(ans(f, { location: "Somewhere" })).toBeNull();
  });

  it("based in any of these countries", () => {
    const f = sel("Are you currently based in any of these countries: United States, Canada?", ["Yes", "No"]);
    expect(ans(f)).toBe("Yes");
    expect(ans(sel("Are you based in any of the following countries: Germany, France?", ["Yes", "No"]))).toBe("No");
  });

  it("visa sponsorship", () => {
    const f = sel("Will you now or in the future require visa sponsorship to work in the US?", ["Yes", "No"]);
    expect(ans(f)).toBe("No"); // authorizedUS true, needsSponsorship unknown
    expect(ans(f, { workAuth: { needsSponsorship: true } })).toBe("Yes");
    expect(ans(f, { workAuth: { authorizedUS: undefined } })).toBeNull();
  });

  it("work authorization choice", () => {
    const f = sel("What is your current work authorization status?", [
      "I require sponsorship", "I am not authorized to work in the US", "U.S. citizen or permanent resident", "Authorized with a visa",
    ]);
    expect(ans(f)).toBe("U.S. citizen or permanent resident");
    expect(ans(f, { workAuth: { authorizedUS: false } })).toBeNull();
    expect(ans(sel("Are you legally authorized to work in the United States?", ["Yes", "No"]))).toBe("Yes");
  });

  it("do you live in one of the following states", () => {
    const f = sel("Do you live in one of the following states: Colorado, New York, Washington?", ["Yes", "No"]);
    expect(ans(f)).toBe("No"); // California
    expect(ans(f, { location: "Seattle, WA" })).toBe("Yes");
    expect(ans(sel("Do you reside in any of these states: CA, NY?", ["Yes", "No"]))).toBe("Yes");
    expect(ans(f, { location: undefined })).toBe("No");
  });

  it("where did you first hear about this role", () => {
    expect(ans(sel("Where did you first hear about this role?", ["LinkedIn", "Job board (Indeed, etc.)", "Other"]))).toBe("Job board (Indeed, etc.)");
    expect(ans(sel("How did you hear about us?", ["Referral", "Other"]))).toBe("Other");
    expect(ans(sel("How did you hear about this job?", ["Referral", "Company website"]))).toBe("Company website");
    expect(ans(sel("Where did you first hear about this role?", undefined, "text"))).toBe("Job board");
  });

  it("acknowledgments and confirmations", () => {
    expect(ans(sel("I acknowledge that I have read the Candidate Privacy Notice", ["I acknowledge"], "checkbox"))).toBe("Yes");
    expect(ans(sel("Privacy notice acknowledgment", ["Yes, I acknowledge", "No"]))).toBe("Yes, I acknowledge");
    expect(ans(sel("Please double-check your application before submitting", undefined, "checkbox"))).toBe("Yes");
    expect(ans(sel("Please confirm: I agree to the terms and conditions", ["I agree, and confirm", "I do not agree"], "checkbox"))).toBe("I agree");
  });

  it("EEO questions decline", () => {
    expect(ans(sel("Gender", ["Male", "Female", "Decline to self-identify"]))).toBe("Decline to self-identify");
    expect(ans(sel("Race", ["Asian", "White", "I don't wish to answer"]))).toBe("I don't wish to answer");
    expect(ans(sel("Veteran Status", ["I am a protected veteran", "I prefer not to answer"]))).toBe("I prefer not to answer");
    expect(ans(sel("Disability Status", ["Yes, I have a disability", "No", "I do not want to answer"]))).toBe("I do not want to answer");
    expect(ans(sel("Gender", ["Male", "Female"]))).toBeNull();
  });

  it("contact links", () => {
    expect(ans(sel("GitHub URL", undefined, "text"))).toBe("https://github.com/jr");
    expect(ans(sel("LinkedIn Profile", undefined, "text"))).toBe("https://linkedin.com/in/jr");
    expect(ans(sel("Why do you want to work here?", undefined, "textarea"))).toBeNull();
  });
});

describe("educationAnswer (graph education nodes and the job title)", () => {
  const edu: EducationFact[] = [
    { label: "BS Computer Science, UT Austin", startDate: "2023-08", endDate: "2027-05" },
    { label: "High school", startDate: "2019-09", endDate: "2023-06" },
  ];
  const MONTH_OPTS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const YEAR_OPTS = ["2022", "2023", "2024", "2025", "2026", "2027", "2028"];
  const title = "Software Engineering Intern, Winter '27";
  const ea = (f: FormField, e = edu, t = title) => educationAnswer(f, e, t);

  it("start and end month/year from the most recent education", () => {
    expect(ea(sel("End date month", MONTH_OPTS))).toBe("May");
    expect(ea(sel("End date year", YEAR_OPTS))).toBe("2027");
    expect(ea(sel("Start date month", MONTH_OPTS))).toBe("August");
    expect(ea(sel("Start date year", YEAR_OPTS))).toBe("2023");
    expect(ea(sel("End date month", ["Jan", "Feb", "Mar", "Apr", "May", "Jun"]))).toBe("May");
    expect(ea(sel("Graduation month", ["01", "02", "03", "04", "05"]))).toBe("05");
    expect(ea(sel("Expected graduation date", undefined, "text"))).toBe("May 2027");
    // Year-only node: the year is known, the month is not.
    const yearOnly = [{ label: "BS", startDate: "2015", endDate: "2019" }];
    expect(ea(sel("End date year", ["2018", "2019"]), yearOnly)).toBe("2019");
    expect(ea(sel("End date month", MONTH_OPTS), yearOnly)).toBeNull();
    // Not education questions.
    expect(ea(sel("Start date", undefined, "text"))).toBeUndefined();
    expect(ea(sel("Why do you want to work here?", undefined, "textarea"))).toBeUndefined();
  });

  it("graduation window: Yes only if the end date falls inside it", () => {
    expect(ea(sel("Do you expect to graduate between December 2026 and June 2027?", ["Yes", "No"]))).toBe("Yes");
    expect(ea(sel("Do you expect to graduate between 12/2026 and 06/2027?", ["Yes", "No"]))).toBe("Yes");
    expect(ea(sel("Do you expect to graduate between September 2027 and June 2028?", ["Yes", "No"]))).toBe("No");
    expect(ea(sel("Do you expect to graduate between Jan 2025 and Dec 2026?", ["Yes", "No"]))).toBe("No");
    expect(ea(sel("Do you expect to graduate between May 2027 and May 2028?", ["Yes", "No"]))).toBe("Yes"); // inclusive
    expect(ea(sel("Do you expect to graduate between December 2026 and June 2027?", ["Yes", "No"]), [])).toBeNull();
  });

  it("term confirmation picks the option whose season the job title names", () => {
    expect(ea(sel("Please confirm which term you are applying for (Winter 2027 vs. Summer 2027)", ["Winter 2027", "Summer 2027"]))).toBe("Winter 2027");
    expect(ea(sel("Please confirm which term you are applying for (Winter 2027 vs. Summer 2027)", ["Winter 2027", "Summer 2027"]), edu, "Software Engineer Intern (Summer 2027)")).toBe("Summer 2027");
    expect(ea(sel("Which term are you applying for? (Winter 2027 or Summer 2027)", undefined, "text"))).toBe("Winter 2027");
    expect(ea(sel("Please confirm which term (Winter 2027 vs. Summer 2027)", ["Winter 2027", "Summer 2027"]), edu, "Software Engineer Intern")).toBeNull();
  });

  it("makeAnswerQuestion answers them instead of leaving them pending", async () => {
    const answer = makeAnswerQuestion({ profile: { ...base, earliestStartDate: "2026-12-01" } as ApplicantProfileFull, evidence: [], jobTitle: title, companyName: "Vercel", education: edu });
    expect(await answer(sel("Start date year", YEAR_OPTS), "")).toBe("2023"); // not the job start date from the profile
    expect(await answer(sel("End date month", MONTH_OPTS), "")).toBe("May");
    expect(await answer(sel("Do you expect to graduate between December 2026 and June 2027?", ["Yes", "No"]), "")).toBe("Yes");
    expect(await answer(sel("Please confirm which term (Winter 2027 vs. Summer 2027)", ["Winter 2027", "Summer 2027"]), "")).toBe("Winter 2027");
  });
});

describe("preferred name, pronouns and state", () => {
  const full = (p: Partial<ApplicantProfileFull>, f: FormField) => heuristicAnswer(f, { ...base, ...p, workAuth: base.workAuth } as ApplicantProfileFull);
  const text = (label: string): FormField => ({ label, kind: "text", required: true, selector: "#x" });

  it("answers preferred name with the first name, and not other kinds of name", () => {
    expect(full({}, text("Preferred Name"))).toBe("Jordan");
    expect(full({}, text("What name do you go by? (nickname)"))).toBe("Jordan");
    expect(full({}, text("Preferred first name"))).toBe("Jordan");
    expect(full({}, text("Legal last name"))).not.toBe("Jordan");
    expect(full({ firstName: "" }, text("Preferred Name"))).toBeNull();
  });

  it("answers pronouns only from the profile, matching the form's options", () => {
    expect(full({ pronouns: "they/them" }, text("Pronouns"))).toBe("they/them");
    expect(full({ pronouns: "they/them" }, sel("Pronouns", ["He/Him", "She/Her", "They/Them", "Prefer not to say"]))).toBe("They/Them");
    expect(full({}, sel("Pronouns", ["He/Him", "She/Her", "They/Them"]))).toBeNull(); // never guessed
    expect(full({ pronouns: "xe/xem" }, sel("Pronouns", ["He/Him", "She/Her", "They/Them"]))).toBeNull();
  });

  it("answers which state or province you live in from the profile or the location", () => {
    const provinces = ["Alabama", "California", "Texas", "Ontario", "British Columbia"];
    expect(full({}, sel("Which U.S. State or Canadian Province do you reside in?", provinces))).toBe("California");
    expect(full({ state: "TX" }, sel("Which U.S. State or Canadian Province do you reside in?", provinces))).toBe("Texas");
    expect(full({}, text("State you currently live in"))).toBe("California");
    expect(full({ location: "London, UK" }, sel("Which state do you live in?", provinces))).toBeNull();
    // the older "one of these states" yes/no phrasing is untouched
    expect(full({}, sel("Do you live in one of the following states: CA, NY?", ["Yes", "No"]))).toBe("Yes");
  });
});
