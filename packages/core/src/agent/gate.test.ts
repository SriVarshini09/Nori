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
    expect(r.reasons[0]).toMatch(/Asks for 8\+ years of experience; you have about 4/);
    expect(checkDisqualifiers(job("x"), req({ yearsMin: 5 }), citizen, { graph, now: NOW }).ok).toBe(true); // 4.7 years, one year grace
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
});
