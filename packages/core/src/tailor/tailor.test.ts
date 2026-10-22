import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLLM, type LLM } from "../llm/index.js";
import { FLUFF_RE } from "./fluff.js";
import { LEFT_OUT, tailorResume, validateBullet, bulletSupport, keywordCoverage, yearsOfExperience } from "./rewrite.js";
import { renderHtml } from "./template.js";
import { atsChecks } from "./ats.js";
import { strengthenOpener, startsWithVerb } from "./verbs.js";
import { sampleBaseline, sampleEvidence, sampleRequirements } from "./sample.fixture.js";
import type { TailorInput } from "../contracts.js";

const offline: LLM = {
  provider: "none", model: "none", available: false,
  async json() { throw new Error("offline"); }, async text() { throw new Error("offline"); },
};

const input: TailorInput = {
  baseline: sampleBaseline, requirements: sampleRequirements, evidence: sampleEvidence,
  jobTitle: "Senior Full-Stack Engineer", companyName: "Omega Pay",
};

function bulletsById(c: TailorInput["baseline"]) {
  return new Map(c.experience.flatMap((r) => r.bullets).map((b) => [b.id, b]));
}

describe("tailorResume (heuristic, offline)", () => {
  beforeEach(() => setLLM(offline));
  afterEach(() => setLLM(null));

  it("records a change exactly for each bullet whose text changed", async () => {
    const r = await tailorResume(input);
    expect(r.usedLLM).toBe(false);
    const before = bulletsById(sampleBaseline);
    const after = bulletsById(r.content);
    const changed = [...after.values()].filter((b) => before.get(b.id)!.text !== b.text).map((b) => b.id).sort();
    // Bullets left out of this version are recorded too (see the next test); here only reworded bullets count.
    const bulletChanges = r.changes.filter((c) => before.has(c.bulletId) && c.after !== LEFT_OUT);
    expect(bulletChanges.map((c) => c.bulletId).sort()).toEqual(changed);
    expect(changed.length).toBeGreaterThan(0);
    for (const c of bulletChanges) {
      expect(c.before).toBe(before.get(c.bulletId)!.text);
      expect(c.after).toBe(after.get(c.bulletId)!.text);
      expect(c.before).not.toBe(c.after);
      expect(c.reason.length).toBeGreaterThan(10);
      expect(c.nodeIds).toEqual(before.get(c.bulletId)!.nodeIds);
    }
    // a bullet that is kept and not reworded produces no change entry
    expect(r.changes.find((c) => c.bulletId === "b6")).toBeUndefined();
  });

  it("leaves out older bullets that say nothing about the job, never the latest role, and records each one", async () => {
    const r = await tailorResume(input);
    const kept = bulletsById(r.content);
    const leftOut = r.changes.filter((c) => c.after === LEFT_OUT);
    expect(leftOut.map((c) => c.bulletId).sort()).toEqual(["b7", "b9"]);
    for (const c of leftOut) {
      expect(kept.has(c.bulletId)).toBe(false);
      expect(c.before).toBe(bulletsById(sampleBaseline).get(c.bulletId)!.text);
      expect(c.reason).toMatch(/^Left out of this version/);
    }
    // the latest role keeps every bullet, and no role is emptied
    for (const id of ["b1", "b2", "b3", "b4"]) expect(kept.has(id)).toBe(true);
    for (const role of r.content.experience) expect(role.bullets.length).toBeGreaterThan(0);
    // a short resume is left whole: there is no padding to cut
    const short = structuredClone(sampleBaseline);
    short.experience = short.experience.slice(0, 2).map((x) => ({ ...x, bullets: x.bullets.slice(0, 2) }));
    const rs = await tailorResume({ ...input, baseline: short });
    expect(rs.changes.some((c) => c.after === LEFT_OUT)).toBe(false);
  });

  it("only adds skills backed by the bullet's own evidence, and fixes weak openers", async () => {
    const r = await tailorResume(input);
    const after = bulletsById(r.content);
    expect(after.get("b1")!.text).toMatch(/^Built the merchant dashboard/);
    expect(after.get("b1")!.text).toMatch(/\(React, TypeScript\)$/);
    expect(after.get("b5")!.text).toMatch(/\(Node\.js\)$/);
    // b6 mentions no evidence-backed required skill: never gets one
    expect(after.get("b6")!.text).toBe(bulletsById(sampleBaseline).get("b6")!.text);
  });

  it("preserves provenance for every bullet that is kept, and the left-out ones stay on record", async () => {
    const r = await tailorResume(input);
    const before = bulletsById(sampleBaseline);
    const kept = bulletsById(r.content);
    expect(Object.keys(r.provenance).sort()).toEqual([...kept.keys()].sort());
    for (const id of kept.keys()) expect(r.provenance[id]).toEqual(before.get(id)!.nodeIds);
    for (const b of kept.values()) expect(b.nodeIds).toEqual(before.get(b.id)!.nodeIds);
    const leftOut = r.changes.filter((c) => c.after === LEFT_OUT).map((c) => c.bulletId);
    expect([...kept.keys(), ...leftOut].sort()).toEqual([...before.keys()].sort()); // nothing vanishes without a record
  });

  it("puts required skills first, writes a factual summary and reports coverage", async () => {
    const r = await tailorResume(input);
    const first = r.content.skills[0];
    expect(first.group).toBe("Frameworks");
    expect(first.items).toEqual(["React", "Node.js", "Express", "Jest"]); // Node.js added from the graph
    expect(r.content.skills[1].items[0]).toBe("TypeScript");
    expect(r.content.skills.flatMap((g) => g.items)).toEqual(expect.arrayContaining(["React", "TypeScript", "PostgreSQL"]));
    const yrs = yearsOfExperience(sampleBaseline.experience)!;
    // two plain sentences: the latest real title, real years and the skills the job asks for that the resume proves; then real results
    expect(r.content.summary).toMatch(new RegExp(`^Senior Software Engineer with ${yrs} years of experience in React, TypeScript and Node\\.js\\. Recent results: `));
    expect(r.content.summary).toMatch(/built the merchant dashboard used by 12,000 businesses/);
    expect(r.content.summary).toMatch(/cut p95 API latency from 900ms to 250ms/);
    expect(r.content.summary).not.toMatch(/Experience spans|hands-on|\(React/); // no employer list, no filler, no keyword tag
    expect(r.content.summary).not.toMatch(FLUFF_RE);
    expect(r.content.summary).not.toMatch(/\b(I|my|we)\b/);
    expect(r.changes.some((c) => c.bulletId === "summary")).toBe(true);
    expect(r.keywordCoverage).toBeGreaterThanOrEqual(0.83);
    expect(keywordCoverage(sampleBaseline, sampleRequirements)).toBeLessThanOrEqual(r.keywordCoverage);
  });

  it("summary dedupes skills case-insensitively, leads with results, and never repeats the title", async () => {
    const req = {
      ...sampleRequirements,
      skills: [{ name: "React", required: true }, { name: "Mentoring", required: true }],
      keywords: ["mentoring", "Mentoring", "code review", "accessibility", "Code Review", "pairing", "WCAG"],
    };
    const baseline = structuredClone(sampleBaseline);
    baseline.skills = [{ group: "Frameworks", items: ["React"] }];
    const r = await tailorResume({ ...input, baseline, requirements: req, jobTitle: "Senior Software Engineer" });
    const s = r.content.summary!;
    expect(s.match(/Senior Software Engineer/g)).toHaveLength(1);
    expect(s).toMatch(/^Senior Software Engineer with \d+ years of experience in React and Mentoring\. Recent results: mentored 3 engineers; /);
    expect(s).not.toMatch(/Mentoring and Mentoring|mentoring.*Mentoring/i);
    expect(yearsOfExperience([{ title: "x", company: "y", start: "2019-03", bullets: [] }], new Date(2026, 9, 1))).toBe(7);
    expect(yearsOfExperience([{ title: "x", company: "y", bullets: [] }])).toBeNull();
  });

  it("reorders bullets inside a role by requirement keywords without dropping any", async () => {
    const r = await tailorResume(input);
    const ids = r.content.experience[0].bullets.map((b) => b.id);
    expect(ids.sort()).toEqual(["b1", "b2", "b3", "b4"]);
    expect(r.content.experience[0].bullets[0].id).toBe("b1");
    expect(r.content.experience[0].bullets.at(-1)!.id).toBe("b4");
  });
});

describe("validator", () => {
  const orig = sampleBaseline.experience[0].bullets[1]; // b2: 900ms -> 250ms
  const support = bulletSupport(orig, sampleEvidence);
  const vocab = ["React", "TypeScript", "Node.js", "PostgreSQL", "Kubernetes", "Redis"];

  it("accepts a faithful rewrite", () => {
    expect(validateBullet(orig, { text: "Reduced p95 API latency from 900ms to 250ms with PostgreSQL query indexes and a Redis read-through cache", nodeIds: orig.nodeIds }, support, vocab)).toEqual({ ok: true });
  });
  it("rejects invented numbers", () => {
    const v = validateBullet(orig, { text: "Reduced p95 API latency by 85% for 3M users with PostgreSQL indexes and caching", nodeIds: orig.nodeIds }, support, vocab);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.reason).toMatch(/85|3/);
  });
  it("rejects nodeIds outside the original bullet", () => {
    const v = validateBullet(orig, { text: "Reduced p95 API latency from 900ms to 250ms with PostgreSQL query indexes", nodeIds: [...orig.nodeIds, "m99"] }, support, vocab);
    expect(v.ok).toBe(false);
  });
  it("rejects tools the evidence never mentions", () => {
    const v = validateBullet(orig, { text: "Reduced p95 API latency from 900ms to 250ms by moving PostgreSQL onto Kubernetes", nodeIds: orig.nodeIds }, support, vocab);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.reason).toMatch(/Kubernetes/);
  });

  it("falls back to the heuristic for a fabricated LLM bullet and keeps the good ones", async () => {
    const fake: LLM = {
      provider: "anthropic", model: "fake", available: true,
      async text() { return ""; },
      async json<T>(): Promise<T> {
        const exp = sampleBaseline.experience.map((r) => ({ bullets: r.bullets.map((b) => ({ id: b.id, text: b.text, nodeIds: b.nodeIds })) }));
        exp[0].bullets[0] = { id: "b1", text: "Built a merchant dashboard in React and TypeScript adopted by 50,000 businesses and generating $10M revenue", nodeIds: ["r1", "m1"] };
        exp[0].bullets[1] = { id: "b2", text: "Reduced p95 API latency from 900ms to 250ms with PostgreSQL query indexes and a read-through cache", nodeIds: ["r1", "m2", "s-pg"] };
        return { experience: exp, summary: "Senior Software Engineer with hands-on experience in React, TypeScript, Node.js and PostgreSQL.", skillsOrder: ["React", "TypeScript"] } as T;
      },
    };
    setLLM(fake);
    try {
      const r = await tailorResume(input);
      expect(r.usedLLM).toBe(true);
      expect(r.rejected.map((x) => x.bulletId)).toEqual(["b1"]);
      const after = bulletsById(r.content);
      expect(after.get("b1")!.text).not.toMatch(/50,000|10M/);
      expect(after.get("b1")!.text).toMatch(/^Built the merchant dashboard/); // heuristic version
      expect(after.get("b2")!.text).toMatch(/^Reduced p95 API latency/);
      expect(r.provenance.b1).toEqual(["r1", "m1", "s-react"]);
      expect(r.changes.find((c) => c.bulletId === "b2")!.reason).toMatch(/PostgreSQL|wording/);
    } finally {
      setLLM(null);
    }
  });
});

describe("template + ats", () => {
  it("renders ATS-safe single-column HTML with ordered headings", () => {
    const html = renderHtml(sampleBaseline);
    expect(html).not.toMatch(/<table|<img|<svg/i);
    expect(html).toMatch(/<h1>Jordan Rivera<\/h1>/);
    const heads = [...html.matchAll(/<h2>(.*?)<\/h2>/g)].map((m) => m[1]);
    expect(heads).toEqual(["Summary", "Experience", "Education", "Skills", "Certifications"]);
    expect(html).toMatch(/@page \{ size: Letter; margin: [\d.]+in; \}/);
    expect(html).toContain("Apr 2021 – Present");
    const bodySize = (h: string) => Number(/body \{[^}]*?font-size: ([\d.]+)pt/.exec(h)![1]);
    expect(bodySize(renderHtml(sampleBaseline, "tight"))).toBeLessThan(bodySize(renderHtml(sampleBaseline, "compact")));
    expect(bodySize(renderHtml(sampleBaseline, "compact"))).toBeLessThan(bodySize(html));
  });

  it("scores a clean tailored resume high and flags problems", async () => {
    setLLM(offline);
    const r = await tailorResume(input);
    setLLM(null);
    const good = atsChecks(r.content, renderHtml(r.content), sampleRequirements, 1);
    expect(good.checks.filter((c) => !c.pass)).toEqual([]);
    expect(good.score).toBe(100);
    const bad = structuredClone(r.content);
    bad.experience[0].bullets[0].text = "I was on the team";
    bad.experience[1].start = undefined; bad.experience[1].end = undefined;
    const rep = atsChecks(bad, renderHtml(bad).replace("</body>", "<img src=x></body>"), sampleRequirements, 2);
    const failed = rep.checks.filter((c) => !c.pass).map((c) => c.id).sort();
    expect(failed).toEqual(["action_verbs", "bullet_length", "dates", "layout", "one_page", "pronouns"]);
    expect(rep.score).toBeLessThan(50);
  });

  it("verb helpers", () => {
    expect(strengthenOpener("Responsible for managing a team of 4")).toBe("Managed a team of 4");
    expect(strengthenOpener("Responsible for the billing platform")).toBe("Owned the billing platform");
    expect(strengthenOpener("Responsible for juggling things")).toBe("Responsible for juggling things");
    expect(startsWithVerb("Architected a system")).toBe(true);
    expect(startsWithVerb("The system")).toBe(false);
  });

  it("shrinks the prompt until a small-window model can take it, and still checks the output against the full evidence", async () => {
    const sizes: number[] = [];
    // The first two sizes do not fit this window; the third does.
    const small: LLM = {
      provider: "openai-compatible", model: "tiny-4k", available: true,
      async text() { return ""; },
      async json<T>(call: { prompt: string }): Promise<T> {
        sizes.push(call.prompt.length);
        if (sizes.length < 3) throw new Error("The prompt needs about 5000 tokens but tiny-4k runs with a 4096-token context, so it would be cut off.");
        const exp = sampleBaseline.experience.map((r) => ({ bullets: r.bullets.map((b) => ({ id: b.id, text: b.text, nodeIds: b.nodeIds })) }));
        exp[0].bullets[0] = { id: "b1", text: "Built a merchant dashboard in React and TypeScript adopted by 50,000 businesses", nodeIds: ["r1", "m1"] };
        return { experience: exp, summary: "Senior Software Engineer with hands-on experience in React, TypeScript, Node.js and PostgreSQL.", skillsOrder: ["React"] } as T;
      },
    };
    setLLM(small);
    try {
      const r = await tailorResume(input);
      expect(r.usedLLM).toBe(true);
      expect(sizes.length).toBe(3); // full, compact, bullets only
      expect(sizes[0]).toBeGreaterThan(sizes[1]);
      expect(sizes[1]).toBeGreaterThan(sizes[2]);
      expect(r.rejected.map((x) => x.bulletId)).toContain("b1"); // the invented number is still caught
      expect(bulletsById(r.content).get("b1")!.text).not.toMatch(/50,000/);
    } finally {
      setLLM(null);
    }
  });

  it("does not hide a failure that has nothing to do with the window", async () => {
    let calls = 0;
    setLLM({ provider: "openai-compatible", model: "x", available: true, async text() { return ""; }, async json() { calls++; throw new Error("LLM 500: boom"); } });
    try {
      const r = await tailorResume(input);
      expect(calls).toBe(1);
      expect(r.usedLLM).toBe(false); // heuristic fallback, as before
    } finally {
      setLLM(null);
    }
  });
});

describe("ownership and scope upgrades", () => {
  const orig = { text: "Contributed to the migration of the checkout flow to React", nodeIds: ["n1"] };
  it("rejects a rewrite that turns 'contributed to' into 'led' or adds company-wide scope", () => {
    expect(validateBullet(orig, { text: "Led the migration of the checkout flow to React for the web team", nodeIds: ["n1"] }, "", ["React"]).ok).toBe(false);
    expect(validateBullet(orig, { text: "Contributed to a company-wide migration of the checkout flow to React", nodeIds: ["n1"] }, "", ["React"]).ok).toBe(false);
  });
  it("keeps a rewrite whose wording the evidence supports", () => {
    expect(validateBullet(orig, { text: "Contributed to moving the checkout flow to React across the storefront", nodeIds: ["n1"] }, "", ["React"]).ok).toBe(true);
    expect(validateBullet(orig, { text: "Led the migration of the checkout flow to React for the web team", nodeIds: ["n1"] }, "Led a team of four on the checkout rewrite", ["React"]).ok).toBe(true);
  });
});
