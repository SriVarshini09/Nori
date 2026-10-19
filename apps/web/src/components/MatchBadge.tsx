import { pct } from "@/lib/format";
import { cx } from "./cx";

/** Match score as a tabular figure with a 2px hairline meter underneath. Monochrome. */
export function MatchBadge({ score, size = "md" }: { score: number | null | undefined; size?: "sm" | "md" | "lg" }) {
  if (score == null) return <span className="text-meta text-faint">No score</span>;
  const p = pct(score);
  const num = { sm: "text-[15px]", md: "text-[22px]", lg: "text-[44px]" }[size];
  return (
    <span title={`${p}% match with your career graph`} className="inline-flex flex-col items-start gap-1.5">
      <span className={cx("font-display font-medium leading-none tracking-[-0.03em] text-ink tnum", num)}>
        {p}<span className="ml-0.5 align-top text-[0.45em] font-normal tracking-normal text-muted">%</span>
      </span>
      <span aria-hidden="true" className={cx("relative block h-[2px] bg-line", size === "lg" ? "w-24" : "w-10")}>
        <span className="absolute inset-y-0 left-0 bg-ink" style={{ width: `${p}%` }} />
      </span>
    </span>
  );
}
