/**
 * The tone guide for every answer the agent writes on the user's behalf. The LLM path gets VOICE_SYSTEM
 * as its system prompt; the heuristic templates are written to the same rules; lint() checks both.
 */

export const LONG_MIN_WORDS = 60;
export const LONG_MAX_WORDS = 140;
export const SHORT_MAX_WORDS = 45;

export const VOICE_RULES = [
  "Write in the first person as the applicant, the way a real person types into a form: plain, specific, a little informal.",
  "Use contractions (I'm, I've, it's, that's). Keep sentences short. No semicolons, no em dashes, no bullet points, no headings.",
  "Use concrete nouns and numbers from the applicant's own evidence: the product, the stack, the metric. Name the company they did it at.",
  "Mention exactly one specific thing about the company or its product, taken from the research or the job description. Never invent products, customers, funding, news or facts beyond those sources.",
  "Never claim anything that is not in the evidence. No made-up employers, numbers, skills, dates, titles or results. If a detail is missing, leave it out.",
  "Do not open with \"I am excited to\", \"I'm excited to\", \"I am passionate about\", \"As a highly motivated\", \"I am writing to\" or any similar stock opener. Start with the substance.",
  "Do not close with \"I look forward to\", \"Thank you for your consideration\" or any sign-off. Just stop when the point is made.",
  "No buzzwords: synergy, leverage, dynamic, fast-paced, passionate, cutting-edge, world-class, results-driven, detail-oriented, self-starter, team player, thrilled, delve.",
  `Long-form questions (textareas, stories, motivation): ${LONG_MIN_WORDS} to ${LONG_MAX_WORDS} words. Short fields: one or two sentences.`,
  "No greeting, no sign-off, no quotation of the question, no markdown.",
] as const;

export const VOICE_SYSTEM = `You write answers to job application questions for a specific applicant, in their own voice.

Rules:
${VOICE_RULES.map((r, i) => `${i + 1}. ${r}`).join("\n")}

You get the question, a summary of the job, what is known about the company (with citations), and evidence rows from the applicant's career graph. Each evidence row has a nodeId. Ground every claim in those rows and list the nodeIds you actually used in sourcesUsed. If the evidence cannot support an honest answer, write the most honest short answer you can from what is there; never pad it with invented detail.`;

/** Phrases that make an answer read like a template. Matched case-insensitively. */
export const BANNED_PHRASES: { re: RegExp; label: string }[] = [
  { re: /\bI am excited to\b/i, label: "I am excited to" },
  { re: /\bI'?m (so |really )?excited to\b/i, label: "I'm excited to" },
  { re: /\bI am passionate about\b/i, label: "I am passionate about" },
  { re: /\bI'?m passionate about\b/i, label: "I'm passionate about" },
  { re: /\bas a highly motivated\b/i, label: "As a highly motivated" },
  { re: /\bhighly motivated\b/i, label: "highly motivated" },
  { re: /\bI am writing to\b/i, label: "I am writing to" },
  { re: /\bI would like to express\b/i, label: "I would like to express" },
  { re: /\bI look forward to\b/i, label: "I look forward to" },
  { re: /\bI'?m looking forward to\b/i, label: "I'm looking forward to" },
  { re: /\bthank you for (your )?(time|consideration|considering)\b/i, label: "thank you for your consideration" },
  { re: /\bsynerg(y|ies|istic)\b/i, label: "synergy" },
  { re: /\bleverag(e|ed|es|ing)\b/i, label: "leverage" },
  { re: /\bdynamic\b/i, label: "dynamic" },
  { re: /\bfast[- ]paced\b/i, label: "fast-paced" },
  { re: /\bpassionate\b/i, label: "passionate" },
  { re: /\bcutting[- ]edge\b/i, label: "cutting-edge" },
  { re: /\bworld[- ]class\b/i, label: "world-class" },
  { re: /\bresults[- ]driven\b/i, label: "results-driven" },
  { re: /\bdetail[- ]oriented\b/i, label: "detail-oriented" },
  { re: /\bself[- ]starter\b/i, label: "self-starter" },
  { re: /\bteam player\b/i, label: "team player" },
  { re: /\bthrilled\b/i, label: "thrilled" },
  { re: /\bdelve\b/i, label: "delve" },
  { re: /\bgame[- ]chang(er|ing)\b/i, label: "game-changer" },
  { re: /\bbest[- ]in[- ]class\b/i, label: "best-in-class" },
  { re: /\bthink outside the box\b/i, label: "think outside the box" },
];

export const wordCount = (s: string) => (s.trim().match(/[A-Za-z0-9$][^\s]*/g) ?? []).length;
export const sentenceCount = (s: string) => s.split(/(?<=[.!?])\s+(?=[A-Z0-9"$])/).map((x) => x.trim()).filter(Boolean).length;

export type LintMode = "long" | "short";

/**
 * Problems with an answer against the voice rules: banned phrases, length, and formatting tells.
 * Empty array means it passes. `mode` picks the length rule (long-form 60 to 140 words, short 1 to 2 sentences).
 */
export function lint(answer: string, mode: LintMode = "long"): string[] {
  const out: string[] = [];
  const text = answer.trim();
  if (!text) return ["empty answer"];
  for (const b of BANNED_PHRASES) if (b.re.test(text)) out.push(`banned phrase: "${b.label}"`);
  if (/[—–]/.test(text)) out.push("em dash: use a period or comma instead");
  if (/^\s*([-*•]|\d+\.)\s/m.test(text) || /^#/m.test(text)) out.push("formatting: no bullets, lists or headings");
  if (/^(dear|hi|hello|to whom)\b/i.test(text)) out.push("greeting: start with the substance");
  if (/\b(sincerely|best regards|kind regards|cheers),?\s*$/i.test(text)) out.push("sign-off: just stop when the point is made");
  const words = wordCount(text);
  if (mode === "long") {
    if (words < LONG_MIN_WORDS) out.push(`too short: ${words} words, need ${LONG_MIN_WORDS} to ${LONG_MAX_WORDS}`);
    if (words > LONG_MAX_WORDS) out.push(`too long: ${words} words, need ${LONG_MIN_WORDS} to ${LONG_MAX_WORDS}`);
  } else {
    const sentences = sentenceCount(text);
    if (sentences > 2) out.push(`too long for a short field: ${sentences} sentences, use one or two`);
    if (words > SHORT_MAX_WORDS) out.push(`too long for a short field: ${words} words`);
  }
  return out;
}

/** True when the only problems are about length (the content itself is fine). */
export const onlyLengthIssues = (issues: string[]) => issues.every((i) => /^too (short|long)/.test(i));
