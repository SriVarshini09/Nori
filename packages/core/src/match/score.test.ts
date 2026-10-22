import { describe, expect, it } from "vitest";
import { scoreMatch } from "./score.js";

describe("soft-skill placeholders", () => {
  it("count neither for nor against a must-have, and never as proof", () => {
    const reqs = { skills: [{ name: "React", required: true }], mustHaves: ["Strong communication skills"], niceToHaves: [], keywords: [], disqualifiers: [] } as never;
    const react = { requirement: "React", nodeId: "r", nodeType: "role", label: "Engineer", text: "Built the app in React", score: 1 };
    const placeholder = { requirement: "Strong communication skills", nodeId: "r", nodeType: "role", label: "Engineer", text: "General strength across 2 roles: Strong communication skills", score: 0.2, inferred: true };
    const r = scoreMatch(reqs, [react, placeholder]);
    expect(r.matched.map((m) => m.requirement)).not.toContain("Strong communication skills");
    expect(r.missing.map((m) => m.requirement)).not.toContain("Strong communication skills");
    expect(r.score).toBe(1); // React fully covered; the soft must-have is neutral, not a free point and not a penalty
  });
});
