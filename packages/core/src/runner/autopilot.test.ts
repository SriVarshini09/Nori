import { describe, expect, it, vi, afterEach } from "vitest";
import { unprovenConstraints, checkDisqualifiers } from "../agent/gate.js";
import {
  AUTOPILOT_MIN_ATS_SCORE, AUTOPILOT_MIN_HUMAN_APPROVALS, AUTOPILOT_PLATFORMS, autopilotVerdict, describeVerdict, type AutopilotInput,
} from "./autopilot.js";

/** An input where every check passes; each test breaks exactly one thing. */
const good: AutopilotInput = {
  mode: "safe", atsType: "greenhouse", submitLockOpen: true, score: 0.82, minScore: 0.7,
  gate: { ok: true, reasons: [] }, unproven: [], filled: true, pendingQuestions: 0, writtenAnswers: [],
  atsScore: 92, humanApprovals: AUTOPILOT_MIN_HUMAN_APPROVALS, recentSameCompany: 0,
};
const only = (patch: Partial<AutopilotInput>, id: string) => {
  const v = autopilotVerdict({ ...good, ...patch });
  expect(v.checks.filter((c) => !c.ok).map((c) => c.id), JSON.stringify(patch)).toEqual([id]);
  return v;
};

describe("autopilotVerdict", () => {
  it("approves only when every check passes, and says so", () => {
    const v = autopilotVerdict(good);
    expect(v.allow).toBe(true);
    expect(v.reasons).toEqual([]);
    expect(v.checks).toHaveLength(11);
    expect(describeVerdict(v)).toBe("Autopilot approved this form: all 11 checks passed");
  });

  it("holds when Autopilot is off", () => {
    expect(only({ mode: "off" }, "enabled").allow).toBe(false);
  });

  it("holds on any platform that is not on the account-free list", () => {
    expect(AUTOPILOT_PLATFORMS).toEqual(["greenhouse", "lever", "ashby"]);
    for (const atsType of ["workday", "web", "manual", "smartrecruiters"] as const) only({ atsType }, "platform");
    for (const atsType of AUTOPILOT_PLATFORMS) expect(autopilotVerdict({ ...good, atsType }).allow).toBe(true);
  });

  it("holds when the server would not really submit", () => {
    expect(only({ submitLockOpen: false }, "lock").reasons[0]).toMatch(/ALLOW_REAL_SUBMIT/);
  });

  it("holds below the match bar, at no score, and passes exactly at the bar", () => {
    expect(only({ score: 0.69 }, "match").reasons[0]).toMatch(/69% is below your bar of 70%/);
    only({ score: null }, "match");
    expect(autopilotVerdict({ ...good, score: 0.7 }).allow).toBe(true);
  });

  it("holds on a disqualifier and shows its reasons", () => {
    const v = only({ gate: { ok: false, reasons: ["Requires US citizenship", "On-site in Austin, away from where you live"] } }, "eligible");
    expect(v.reasons[0]).toBe("Requires US citizenship; On-site in Austin, away from where you live");
  });

  it("holds when eligibility cannot be proven from the profile", () => {
    expect(only({ unproven: ["The posting requires US citizenship and your profile does not say your status"] }, "proven").allow).toBe(false);
  });

  it("holds when the form is incomplete or has open questions", () => {
    only({ pendingQuestions: 2 }, "complete");
    only({ filled: false }, "complete");
  });

  it("holds when Nori wrote free-text answers, unless the person allowed written answers", () => {
    const writtenAnswers = ["Why are you interested in this role?"];
    expect(only({ writtenAnswers }, "answers").reasons[0]).toMatch(/wrote 1 free-text answer/);
    expect(autopilotVerdict({ ...good, mode: "written", writtenAnswers }).allow).toBe(true);
  });

  it("holds on a resume applicant systems may misread", () => {
    only({ atsScore: AUTOPILOT_MIN_ATS_SCORE - 1 }, "resume");
    only({ atsScore: null }, "resume");
    expect(autopilotVerdict({ ...good, atsScore: AUTOPILOT_MIN_ATS_SCORE }).allow).toBe(true);
  });

  it("holds until the person has approved enough applications by hand (the trust ladder)", () => {
    const v = only({ humanApprovals: 2 }, "trust");
    expect(v.reasons[0]).toBe("Autopilot starts after you approve 3 applications yourself (2 so far)");
    expect(autopilotVerdict({ ...good, humanApprovals: 0, minHumanApprovals: 0 }).allow).toBe(true);
  });

  it("holds on a second application to the same company in the cooldown window", () => {
    expect(only({ recentSameCompany: 1 }, "duplicate").reasons[0]).toMatch(/already applied to this company/);
  });

  it("reports every failing reason at once, not just the first", () => {
    const v = autopilotVerdict({ ...good, score: 0.3, humanApprovals: 0, atsType: "workday" });
    expect(v.reasons).toHaveLength(3);
    expect(describeVerdict(v)).toMatch(/^Autopilot held this for your review: .*workday.*below your bar.*approve 3 applications/);
  });
});

describe("unprovenConstraints", () => {
  const job = { companyName: "Acme", descriptionText: "" };
  const req = (text: string) => ({ ...job, descriptionText: text });

  it("flags citizenship, clearance and sponsorship statements the profile cannot answer", () => {
    expect(unprovenConstraints(req("US citizenship is required for this role."), null, { workAuth: {} })).toHaveLength(1);
    expect(unprovenConstraints(req("Must hold an active secret clearance."), null, { workAuth: {} })[0]).toMatch(/clearance/);
    expect(unprovenConstraints(req("We are unable to provide visa sponsorship."), null, { workAuth: {} })[0]).toMatch(/sponsorship/);
  });

  it("is silent once the profile answers, and for postings that state nothing", () => {
    expect(unprovenConstraints(req("US citizenship is required."), null, { workAuth: { status: "citizen" } })).toEqual([]);
    expect(unprovenConstraints(req("No visa sponsorship."), null, { workAuth: { needsSponsorship: false } })).toEqual([]);
    expect(unprovenConstraints(req("Build great React apps with a friendly team."), null, { workAuth: {} })).toEqual([]);
  });

  it("is stricter than the disqualifier gate on purpose: unknown passes the gate, not Autopilot", () => {
    const text = "Applicants must be a US citizen.";
    expect(checkDisqualifiers(req(text), null, { workAuth: {} }).ok).toBe(true);
    expect(unprovenConstraints(req(text), null, { workAuth: {} })).toHaveLength(1);
  });
});

describe("the trust ladder setting", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
  const load = async () => (await import("./autopilot.js")).AUTOPILOT_MIN_HUMAN_APPROVALS;

  it("is 3 by default and AUTOPILOT_MIN_APPROVALS sets it; junk falls back to 3", async () => {
    vi.resetModules();
    expect(await load()).toBe(3);
    for (const [raw, want] of [["1", 1], ["0", 0], ["5", 5], ["abc", 3], ["-2", 3], ["1.5", 3], ["", 3]] as const) {
      vi.stubEnv("AUTOPILOT_MIN_APPROVALS", raw);
      vi.resetModules();
      expect(await load(), `AUTOPILOT_MIN_APPROVALS=${raw}`).toBe(want);
    }
  });
});
