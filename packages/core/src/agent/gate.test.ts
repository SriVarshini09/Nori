import { describe, expect, it } from "vitest";
import type { JobRequirements } from "../db/schema.js";
import { checkDisqualifiers, parseSalaryRange, type GateJob, type GateProfile } from "./gate.js";

const req = (over: Partial<JobRequirements> = {}): JobRequirements => ({
  skills: [], seniority: "senior", roleFamily: "frontend", yearsMin: null, mustHaves: [], niceToHaves: [], disqualifiers: [],
  keywords: [], summary: "", ...over,
});
const job = (descriptionText: string, over: Partial<GateJob> = {}): GateJob => ({
  companyName: "Acme", title: "Senior Frontend Engineer", location: "Remote", remote: true, descriptionText, ...over,
});
const citizen: GateProfile = {
  workAuth: { status: "citizen", authorizedUS: true, needsSponsorship: false },
  location: "San Francisco, CA", city: "San Francisco", state: "CA", country: "US", remotePreference: "flexible",
};
const visa: GateProfile = { ...citizen, workAuth: { status: "visa", authorizedUS: true, needsSponsorship: true, visaType: "H-1B" } };
const NOW = new Date("2026-10-01T00:00:00Z");

describe("checkDisqualifiers", () => {
  it("1. passes a plain remote job", () => {
    expect(checkDisqualifiers(job("Build React apps with TypeScript."), req(), visa)).toEqual({ ok: true, reasons: [] });
  });

  it("2. rejects US citizenship required for a visa holder", () => {
    const r = checkDisqualifiers(job("Must be a U.S. citizen due to government contracts."), req(), visa);
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("Requires US citizenship");
  });

  it("3. allows US citizenship required for a citizen", () => {
    expect(checkDisqualifiers(job("US citizenship is required."), req(), citizen).ok).toBe(true);
  });

  it("4. rejects an active security clearance requirement without one, accepts with one", () => {
    const j = job("Candidates must hold an active Secret clearance.");
    expect(checkDisqualifiers(j, req(), citizen).reasons).toContain("Requires an active security clearance");
    expect(checkDisqualifiers(j, req(), { ...citizen, securityClearance: "Secret" }).ok).toBe(true);
  });

  it("5. rejects no-sponsorship postings when the user needs sponsorship", () => {
    const j = job("We are unable to provide visa sponsorship for this role.");
    expect(checkDisqualifiers(j, req(), visa).reasons).toContain("No visa sponsorship offered and you need it");
    expect(checkDisqualifiers(j, req(), citizen).ok).toBe(true);
  });

  it("6. reads disqualifiers from the extracted requirements too", () => {
    const r = checkDisqualifiers(job("Great team."), req({ disqualifiers: ["Applicants must be authorized to work without sponsorship"] }), visa);
    expect(r.reasons).toContain("No visa sponsorship offered and you need it");
  });

  it("7. rejects 'must be located in' a place the user is not, unless willing to relocate", () => {
    const j = job("Remote, but you must be located in Canada.");
    expect(checkDisqualifiers(j, req(), citizen).reasons[0]).toMatch(/Must be located in Canada/);
    expect(checkDisqualifiers(j, req(), { ...citizen, willingToRelocate: true }).ok).toBe(true);
    expect(checkDisqualifiers(job("You must be located in the United States."), req(), citizen).ok).toBe(true);
  });

  it("8. rejects on-site roles for remote-only users and far-away on-site roles", () => {
    const onsite = job("This is an on-site role in our office.", { location: "New York, NY", remote: false });
    expect(checkDisqualifiers(onsite, req(), { ...citizen, remotePreference: "remote" }).reasons[0]).toMatch(/On-site role in New York, NY and you want remote only/);
    expect(checkDisqualifiers(onsite, req(), citizen).reasons[0]).toMatch(/On-site in New York, NY/);
    const local = job("This is an on-site role.", { location: "San Francisco, California", remote: false });
    expect(checkDisqualifiers(local, req(), citizen).ok).toBe(true);
  });

  it("9. compares years of experience with the earliest role start", () => {
    const graph = { nodes: [
      { id: "r1", type: "role", label: "Engineer", props: {}, startDate: "2023-06", endDate: null },
      { id: "r2", type: "role", label: "Intern", props: {}, startDate: "2022-01", endDate: "2022-08" },
    ] };
    const r = checkDisqualifiers(job("x"), req({ yearsMin: 8 }), citizen, { graph, now: NOW });
    // The 2022 internship does not count: experience starts with the 2023-06 role (about 3.4 years).
    expect(r.reasons[0]).toMatch(/Asks for 8\+ years of experience; you have about 3/);
    expect(checkDisqualifiers(job("x"), req({ yearsMin: 4 }), citizen, { graph, now: NOW }).ok).toBe(true); // 3.4 years, one year grace
    expect(checkDisqualifiers(job("x"), req({ yearsMin: 8 }), citizen, { now: NOW }).ok).toBe(true); // unknown history never disqualifies
  });

  it("10. rejects excluded companies, case and suffix insensitive", () => {
    const r = checkDisqualifiers(job("x", { companyName: "Stripe, Inc." }), req(), { ...citizen, preferences: { excludeCompanies: ["stripe"] } });
    expect(r.reasons).toEqual(["Stripe, Inc. is on your excluded companies list"]);
  });

  it("11. rejects a stated salary range below the floor", () => {
    const p = { ...citizen, preferences: { salaryMin: 180_000 } };
    expect(checkDisqualifiers(job("Salary: $120,000 - $150,000 per year."), req(), p).reasons[0]).toMatch(/Pays up to \$150k, below your \$180k minimum/);
    expect(checkDisqualifiers(job("Range 170k–210k plus equity."), req(), p).ok).toBe(true);
    expect(checkDisqualifiers(job("Competitive pay."), req(), p).ok).toBe(true);
  });

  it("12. parses salary formats and ignores hourly or unrelated numbers", () => {
    expect(parseSalaryRange("$120,000 - $150,000")).toEqual({ min: 120_000, max: 150_000 });
    expect(parseSalaryRange("120k–150k")).toEqual({ min: 120_000, max: 150_000 });
    expect(parseSalaryRange("$140 - 180K base")).toEqual({ min: 140_000, max: 180_000 });
    expect(parseSalaryRange("$45 - $60 per hour")).toBeNull();
    expect(parseSalaryRange("3-5 years of experience")).toBeNull();
  });

  it("13. skips entry-level roles for someone with several years behind them", () => {
    const graph = { nodes: [{ id: "r1", type: "role", label: "Engineer", props: {}, startDate: "2018-06" }] as never };
    const intern = checkDisqualifiers(job("x", { title: "Software Engineering Intern, Frontend" }), req(), citizen, { graph, now: NOW });
    expect(intern.reasons[0]).toMatch(/^Entry-level role \(intern\); you have about 8 years/);
    expect(checkDisqualifiers(job("x", { title: "Software Engineer, New Grad - Frontend" }), req(), citizen, { graph, now: NOW }).ok).toBe(false);
    expect(checkDisqualifiers(job("x", { title: "Software Engineer, Early Career" }), req(), citizen, { graph, now: NOW }).ok).toBe(false);
    expect(checkDisqualifiers(job("x", { title: "Junior Web Developer" }), req(), citizen, { graph, now: NOW }).ok).toBe(false);
    // the model's own read of seniority counts when the title is silent
    expect(checkDisqualifiers(job("x", { title: "Frontend Engineer" }), req({ seniority: "intern" }), citizen, { graph, now: NOW }).ok).toBe(false);
    // ordinary titles, and words that merely contain the letters, pass
    expect(checkDisqualifiers(job("x", { title: "Senior Frontend Engineer" }), req(), citizen, { graph, now: NOW }).ok).toBe(true);
    expect(checkDisqualifiers(job("x", { title: "Internal Tools Engineer" }), req(), citizen, { graph, now: NOW }).ok).toBe(true);
    // someone early in their career, or with no history on file, is never filtered out
    const fresh = { nodes: [{ id: "r2", type: "role", label: "Intern", props: {}, startDate: "2026-01" }] as never };
    expect(checkDisqualifiers(job("x", { title: "Software Engineering Intern" }), req(), citizen, { graph: fresh, now: NOW }).ok).toBe(true);
    expect(checkDisqualifiers(job("x", { title: "Software Engineering Intern" }), req(), citizen, { now: NOW }).ok).toBe(true);
  });
});

describe("years of experience", () => {
  it("do not count internships or student jobs, so new-grad roles stay open to students", async () => {
    const { earliestRoleStart, isEarlyCareerRole } = await import("./gate.js");
    const node = (label: string, startDate: string, employmentType?: string) => ({ id: label, type: "role", label, startDate, props: { title: label, employmentType } });
    const student = { nodes: [node("Software Engineering Intern", "2022-06", "internship"), node("Teaching Assistant", "2023-01"), node("Junior Developer", "2025-07", "full-time")] } as never;
    expect(earliestRoleStart(student)).toBe("2025-07");
    expect(earliestRoleStart({ nodes: [node("Summer Intern", "2022-06")] } as never)).toBeNull();
    expect(isEarlyCareerRole("Senior Engineer", "full-time")).toBe(false);
    expect(isEarlyCareerRole("Barista", "part-time")).toBe(true);
  });
});
