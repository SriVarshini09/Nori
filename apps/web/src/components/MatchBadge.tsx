import { pct } from "@/lib/format";
import { cx } from "./cx";

/** Visual match pill with mini circular progress ring and tier coloring. */
export function MatchBadge({ score, className }: { score: number | null | undefined; size?: "sm" | "md" | "lg"; className?: string }) {
  if (score == null) return <span className={cx("text-meta text-muted", className)}>Not scored</span>;
  const p = pct(score);
  const r = 5.5;
  const circ = 2 * Math.PI * r;
  const dash = Math.max(0, Math.min(1, p / 100)) * circ;

  const tier =
    p >= 80
      ? "border-[#a7dfc3] bg-[#e2f7ec] text-[#064f39]"
      : p >= 65
        ? "border-[#bdd7f7] bg-[#e8f2ff] text-[#153f75]"
        : "border-line bg-sunken text-ink-2";

  return (
    <span
      title={`${p}% match with your career graph`}
      className={cx(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-semibold shadow-2xs tnum",
        tier,
        className,
      )}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="-ml-0.5 shrink-0 -rotate-90">
        <circle cx="7" cy="7" r={r} fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
        <circle
          cx="7"
          cy="7"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeDasharray={`${dash.toFixed(1)} ${circ.toFixed(1)}`}
          strokeLinecap="round"
        />
      </svg>
      {p}% match
    </span>
  );
}
