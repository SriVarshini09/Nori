import type { ApplicationListItem, ModelMode } from "@/lib/types";

/** What a waiting item asks of the person, in one line, and the label of the button that answers it. */
export function describeWaiting(item: ApplicationListItem): { kind: string; line: string; action: string } {
  const a = item.application;
  if (a.status === "resume_review") {
    const n = item.resume?.changes.length ?? 0;
    const ats = item.resume?.atsScore;
    return {
      kind: "Resume",
      line: `${n} line${n === 1 ? "" : "s"} changed, each from your graph${ats != null ? `. ATS ${ats}` : ""}.`,
      action: "Review resume",
    };
  }
  if (a.status === "form_review") {
    const n = Object.keys(a.answers ?? {}).length;
    return { kind: "Form", line: `${n} field${n === 1 ? "" : "s"} filled. Check them before anything is sent.`, action: "Review form" };
  }
  if (a.status === "awaiting_code") {
    return { kind: "Code", line: "The site sent a verification code to your email.", action: "Enter code" };
  }
  const q = a.pendingQuestions[0]?.label;
  const more = a.pendingQuestions.length - 1;
  return {
    kind: "Question",
    line: q ? `${q}${more > 0 ? ` (and ${more} more)` : ""}` : "The form asked something your profile cannot answer.",
    action: "Answer",
  };
}

/** The model mode in words a person understands. */
export const MODE_LABEL: Record<ModelMode, string> = {
  cline: "Nori's model",
  ollama: "Local model on this computer",
  "openai-compatible": "Nori's model",
  anthropic: "Nori's model",
  heuristic: "Rules only, no model",
};
