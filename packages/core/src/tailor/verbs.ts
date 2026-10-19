/** Action verbs recruiters and ATS parsers expect at the start of a bullet. */
export const ACTION_VERBS = new Set(
  (
    "accelerated achieved acquired adapted added administered advanced advised advocated analyzed architected arranged " +
    "assembled assessed audited authored automated balanced benchmarked boosted briefed built calculated captured " +
    "championed changed clarified closed coached coded collaborated combined communicated compiled completed composed " +
    "computed conceived conducted configured consolidated constructed consulted contributed controlled converted " +
    "coordinated created cultivated curated customized cut debugged decreased defined delivered deployed designed " +
    "detected determined developed devised diagnosed directed discovered documented doubled drafted drove earned edited " +
    "educated eliminated enabled enforced engineered enhanced established evaluated exceeded executed expanded expedited " +
    "experimented explored extended extracted facilitated fixed forecasted formalized formed formulated founded " +
    "generated grew guided halved handled headed helped hired identified implemented improved increased influenced " +
    "initiated innovated inspected installed instituted instrumented integrated interviewed introduced invented " +
    "investigated launched led leveraged localized maintained managed mapped maximized measured mentored merged " +
    "migrated minimized modeled modernized monitored motivated negotiated onboarded operated optimized orchestrated " +
    "organized outperformed overhauled oversaw owned partnered performed piloted pioneered planned prepared presented " +
    "prioritized processed produced profiled programmed promoted prototyped proposed provided published raised ran " +
    "rebuilt recruited redesigned reduced refactored refined reengineered released remediated reorganized replaced " +
    "reported researched resolved restructured revamped reviewed revised rewrote saved scaled secured selected served " +
    "shaped shipped simplified solved sourced spearheaded specified sped standardized started steered streamlined " +
    "strengthened structured supervised supported surpassed synthesized taught tested tracked trained transformed " +
    "translated triaged tripled troubleshot tuned unified upgraded validated verified visualized won wrote " +
    "build design develop lead manage own drive deliver create implement"
  ).split(/\s+/),
);

/** True when the bullet opens with an action verb (list, or a regular past-tense form). */
export function startsWithVerb(text: string): boolean {
  const first = (text.trim().match(/^[A-Za-z][A-Za-z-]*/)?.[0] ?? "").toLowerCase();
  if (!first) return false;
  if (ACTION_VERBS.has(first)) return true;
  return first.length > 4 && first.endsWith("ed") && !/(need|seed|feed|speed|bed)$/.test(first);
}

const GERUND_TO_PAST: Record<string, string> = {
  building: "Built", leading: "Led", managing: "Managed", developing: "Developed", designing: "Designed",
  maintaining: "Maintained", creating: "Created", running: "Ran", writing: "Wrote", implementing: "Implemented",
  coordinating: "Coordinated", overseeing: "Oversaw", handling: "Handled", supporting: "Supported", testing: "Tested",
  delivering: "Delivered", driving: "Drove", owning: "Owned", planning: "Planned", analyzing: "Analyzed",
  monitoring: "Monitored", training: "Trained", mentoring: "Mentored", reviewing: "Reviewed", deploying: "Deployed",
};

/**
 * Replace weak openers ("Responsible for building X") with the verb they hide ("Built X").
 * Only rewrites patterns whose meaning is unambiguous; returns the input otherwise.
 */
export function strengthenOpener(text: string): string {
  const m = /^\s*(?:was\s+|were\s+)?(?:responsible\s+for|in\s+charge\s+of|tasked\s+with|duties\s+included)\s+(\S+)\s*/i.exec(text);
  if (!m) return text;
  const next = m[1].toLowerCase();
  const rest = text.slice(m[0].length);
  if (GERUND_TO_PAST[next]) return `${GERUND_TO_PAST[next]} ${rest}`.trim();
  if (next.endsWith("ing")) return text; // unknown gerund: do not guess
  const opener = /in\s+charge\s+of/i.test(m[0]) ? "Led" : "Owned";
  return `${opener} ${m[1]} ${rest}`.trim();
}
