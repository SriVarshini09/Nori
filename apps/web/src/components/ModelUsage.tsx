import type { ModelSettings, ModelUsage as Usage } from "@/lib/types";
import { Frame } from "./ui";
import { Square } from "./IndexLabel";

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
  const u = initial?.usage;
  const line = mode === "heuristic"
    ? "No model is configured on this server, so Nori works from rules alone."
    : `Nori's model does the work${model ? ` (${model})` : ""}. Nothing to set up.`;
  const usage = usageText(u);
  const share = u?.shared && u.capTokens ? Math.min(1, u.totalTokens / u.capTokens) : null;
  return (
    <Frame className="p-4 sm:p-5">
      <p className="flex items-center gap-2 text-body-sm font-medium text-ink" role="status">
        <Square tone={mode === "heuristic" ? "hollow" : "ink"} />
        {line}
      </p>
      {share !== null && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
          <div className={u?.exhausted ? "h-full bg-attn" : "h-full bg-accent"} style={{ width: `${Math.round(share * 100)}%` }} />
        </div>
      )}
      {usage && <p className={`mt-2 text-meta tnum ${u?.exhausted ? "text-attn-fg" : "text-muted"}`} role="status">{usage}</p>}
      <p className="mt-3 max-w-prose text-meta text-muted">Every resume line and answer it writes is checked against your career graph before it is used. When the allowance runs out for the day, the rule-based version takes over and the run log says so.</p>
    </Frame>
  );
}
