import type { AtsType } from "../db/schema.js";
import type { GateResult } from "../agent/gate.js";

/**
 * Autopilot: after Nori has filled a form (a dry run, nothing sent), decide whether it may approve that form itself
 * instead of waiting for the person. This module is pure: every input is passed in, so every rule is tested on its own.
 *
 * The principle is that Autopilot only ever skips the "are you sure?" step when there is nothing left to be sure about.
 * Any single failed check holds the application for the person, with the reason written in plain words.
 */
export type AutopilotMode = "off" | "safe" | "written";

/** Platforms whose forms need no account, CAPTCHA or assessment. Everything else is always held for the person. */
export const AUTOPILOT_PLATFORMS: readonly AtsType[] = ["greenhouse", "lever", "ashby"];

/** How many applications the person must have approved by hand before Autopilot may send any (the trust ladder). */
export const AUTOPILOT_MIN_HUMAN_APPROVALS = 3;
/** Autopilot will not apply to a company again within this many days of an earlier application. */
export const AUTOPILOT_COMPANY_COOLDOWN_DAYS = 30;
/** The tailored resume must be at least this ATS-readable. */
export const AUTOPILOT_MIN_ATS_SCORE = 70;

export type AutopilotInput = {
  mode: AutopilotMode;
  atsType: AtsType;
  /** Whether the server will really click submit (ALLOW_REAL_SUBMIT). If not, approving would change nothing. */
  submitLockOpen: boolean;
  /** The job's match score (0 to 1) and the person's bar for auto apply. */
  score: number | null;
  minScore: number;
  /** checkDisqualifiers on this job and profile. */
  gate: GateResult;
  /** unprovenConstraints: things the posting states that the profile cannot answer. */
  unproven: string[];
  /** What the driver reported after filling the form. */
  filled: boolean;
  pendingQuestions: number;
  /** Free-text answers Nori wrote with a model (as opposed to answers taken from the person's profile). */
  writtenAnswers: string[];
  atsScore: number | null;
  /** Applications the person approved themselves and that went out, and the bar for trusting Autopilot. */
  humanApprovals: number;
  minHumanApprovals?: number;
  /** Other applications to the same company inside the cooldown window (not counting this one). */
  recentSameCompany: number;
};

export type AutopilotCheck = { id: string; ok: boolean; detail: string };
export type AutopilotVerdict = { allow: boolean; checks: AutopilotCheck[]; /** Plain sentences for the checks that failed. */ reasons: string[] };

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function autopilotVerdict(i: AutopilotInput): AutopilotVerdict {
  const minApprovals = i.minHumanApprovals ?? AUTOPILOT_MIN_HUMAN_APPROVALS;
  const checks: AutopilotCheck[] = [
    i.mode === "off"
      ? { id: "enabled", ok: false, detail: "Autopilot is off" }
      : { id: "enabled", ok: true, detail: "Autopilot is on" },
    AUTOPILOT_PLATFORMS.includes(i.atsType)
      ? { id: "platform", ok: true, detail: `${i.atsType} forms need no account` }
      : { id: "platform", ok: false, detail: `${i.atsType} is not on the list Autopilot may send on its own (${AUTOPILOT_PLATFORMS.join(", ")})` },
    i.submitLockOpen
      ? { id: "lock", ok: true, detail: "This server is allowed to submit" }
      : { id: "lock", ok: false, detail: "This server's submit lock (ALLOW_REAL_SUBMIT) is off, so nothing can be sent" },
    i.score !== null && i.score >= i.minScore
      ? { id: "match", ok: true, detail: `Match ${pct(i.score)} meets your bar of ${pct(i.minScore)}` }
      : { id: "match", ok: false, detail: i.score === null ? "The job has no match score" : `Match ${pct(i.score)} is below your bar of ${pct(i.minScore)}` },
    i.gate.ok
      ? { id: "eligible", ok: true, detail: "No conflict with citizenship, clearance, sponsorship, location, experience or pay" }
      : { id: "eligible", ok: false, detail: i.gate.reasons.join("; ") },
    i.unproven.length === 0
      ? { id: "proven", ok: true, detail: "Nothing in the posting depends on a profile answer you have not given" }
      : { id: "proven", ok: false, detail: i.unproven.join("; ") },
    i.filled && i.pendingQuestions === 0
      ? { id: "complete", ok: true, detail: "Every required question is answered" }
      : { id: "complete", ok: false, detail: i.pendingQuestions > 0 ? `${i.pendingQuestions} question(s) still need your answer` : "The form was not filled completely" },
    i.writtenAnswers.length === 0 || i.mode === "written"
      ? { id: "answers", ok: true, detail: i.writtenAnswers.length ? `${i.writtenAnswers.length} short written answer(s) allowed by your setting` : "Every answer comes from your profile" }
      : { id: "answers", ok: false, detail: `Nori wrote ${i.writtenAnswers.length} free-text answer(s) (${i.writtenAnswers.slice(0, 2).join("; ").slice(0, 120)}) and your setting needs you to read those first` },
    i.atsScore !== null && i.atsScore >= AUTOPILOT_MIN_ATS_SCORE
      ? { id: "resume", ok: true, detail: `Resume reads cleanly for applicant systems (score ${i.atsScore})` }
      : { id: "resume", ok: false, detail: `Resume ATS score ${i.atsScore ?? "unknown"} is under ${AUTOPILOT_MIN_ATS_SCORE}` },
    i.humanApprovals >= minApprovals
      ? { id: "trust", ok: true, detail: `You approved ${i.humanApprovals} applications yourself` }
      : { id: "trust", ok: false, detail: `Autopilot starts after you approve ${minApprovals} applications yourself (${i.humanApprovals} so far)` },
    i.recentSameCompany === 0
      ? { id: "duplicate", ok: true, detail: "No other application to this company in the last " + AUTOPILOT_COMPANY_COOLDOWN_DAYS + " days" }
      : { id: "duplicate", ok: false, detail: `You already applied to this company in the last ${AUTOPILOT_COMPANY_COOLDOWN_DAYS} days` },
  ];
  const failed = checks.filter((c) => !c.ok);
  return { allow: failed.length === 0, checks, reasons: failed.map((c) => c.detail) };
}

/** One line for the timeline. */
export function describeVerdict(v: AutopilotVerdict): string {
  return v.allow
    ? `Autopilot approved this form: all ${v.checks.length} checks passed`
    : `Autopilot held this for your review: ${v.reasons.join("; ")}`;
}
