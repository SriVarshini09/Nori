import type { ModelSettings, ModelUsage as Usage } from "@/lib/types";
import { Frame, IndexLabel } from "./ui";

const fmt = (n: number) => n.toLocaleString("en-US");

/** One line on today's token use and, on the hosted key, how much of the daily allowance is left. */
export function usageText(u: Usage | undefined): string | null {
  if (!u) return null;
  if (u.shared && u.capTokens !== null) {
    if (u.exhausted) return `Today's model allowance of ${fmt(u.capTokens)} tokens is used up. Nori writes with its rule-based fallback until midnight UTC.`;
    return `Model use today: ${fmt(u.totalTokens)} of ${fmt(u.capTokens)} tokens. Resets at midnight UTC.`;
  }
  if (u.totalTokens === 0) return null;
  return `Model use today: ${fmt(u.totalTokens)} tokens over ${u.calls} call${u.calls === 1 ? "" : "s"}.`;
}

/**
 * Which model does the work. There is nothing to configure: Nori's own model serves every account, and the daily
 * allowance is part of the plan. Shown in Settings.
 */
export function ModelUsage({ initial }: { initial: ModelSettings | null }) {
  const mode = initial?.mode ?? "heuristic";
  const model = initial?.tiers?.quality.model ?? null;
  const line = mode === "heuristic"
    ? "No model is configured on this server, so Nori works from rules alone."
    : `Nori's model does the work${model ? ` (${model})` : ""}. Nothing to set up.`;
  const usage = usageText(initial?.usage);
  return (
    <Frame className="p-5 sm:p-6">
      <IndexLabel marker={mode === "heuristic" ? "hollow" : "ink"} tone="ink">
        <span role="status">{line}</span>
      </IndexLabel>
      {usage && <p className={`mt-2 text-meta tnum ${initial?.usage?.exhausted ? "text-accent-ink" : "text-muted"}`} role="status">{usage}</p>}
      <p className="mt-4 text-body-sm text-muted">Every resume line and answer it writes is checked against your career graph before it is used. When the allowance runs out for the day, the rule-based version takes over and the log says so.</p>
    </Frame>
  );
}
