import { describe, expect, it } from "vitest";
import type { FormField } from "../contracts.js";
import { classifyQuestion, type QuestionKind } from "./classify.js";

const ta = (label: string): FormField => ({ label, kind: "textarea", required: true, selector: "" });
const tx = (label: string): FormField => ({ label, kind: "text", required: true, selector: "" });

const CASES: [string, FormField["kind"], QuestionKind][] = [
  ["Why are you interested in interning at Vercel? What about us, our products, and/or the way we build interests you?", "textarea", "motivation_company"],
  ["What's your favorite or most technically challenging project you've built?", "textarea", "project_story"],
  ["Why do you want to work here?", "textarea", "motivation_company"],
  ["Why Stripe?", "text", "motivation_company"],
  ["What excites you about our mission?", "textarea", "motivation_company"],
  ["Why are you interested in this role?", "textarea", "motivation_role"],
  ["What interests you about this position?", "textarea", "motivation_role"],
  ["Tell us about a project you're proud of.", "textarea", "project_story"],
  ["Describe a difficult technical problem you solved and how you approached it.", "textarea", "challenge_story"],
  ["Tell us about a time you failed.", "textarea", "challenge_story"],
  ["What are your greatest strengths?", "textarea", "strengths"],
  ["Why should we hire you?", "textarea", "strengths"],
  ["What is your biggest weakness?", "textarea", "weaknesses"],
  ["Why are you looking to leave your current role?", "textarea", "why_leaving"],
  ["Reason for leaving your last job", "text", "why_leaving"],
  ["Describe your ideal team environment.", "textarea", "team_fit"],
  ["How do you like to collaborate with designers and product managers?", "textarea", "team_fit"],
  ["When can you start?", "text", "availability"],
  ["What is your notice period?", "text", "availability"],
  ["What are your salary expectations?", "text", "salary"],
  ["Cover Letter", "textarea", "cover_letter"],
  ["Is there anything else you'd like us to know?", "textarea", "anything_else"],
  ["Additional information", "textarea", "anything_else"],
  ["How did you hear about us?", "text", "referral_source"],
  ["Are you willing to relocate to New York?", "text", "relocation"],
  ["Portfolio URL", "text", "portfolio_link"],
  ["Link to your GitHub", "text", "portfolio_link"],
  ["Please provide two professional references with contact details", "textarea", "reference_contact"],
  ["Social Security Number", "text", "legal_identifier"],
  ["Passport number", "text", "legal_identifier"],
  ["Date of birth", "text", "legal_identifier"],
  ["What is your GPA?", "text", "unknown"],
];

describe("classifyQuestion", () => {
  it.each(CASES)("%s -> %s", (label, kind, expected) => {
    expect(classifyQuestion(label, kind === "textarea" ? ta(label) : tx(label))).toBe(expected);
  });

  it("has at least 30 labelled examples", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(30);
  });

  it("works without a field and on empty labels", () => {
    expect(classifyQuestion("Why are you interested in this role?")).toBe("motivation_role");
    expect(classifyQuestion("")).toBe("unknown");
  });
});
