import { useId } from "react";
import { pct } from "@/lib/format";
import { cx } from "./cx";

/**
 * Match score as a thin circular arc on a hairline track. Ink below 70%, amber at 70% and above
 * (the one place a score earns the accent: "this one is worth your time").
 */
export function MatchRing({ score, size = 44, className }: { score: number | null | undefined; size?: number; className?: string }) {
  const gid = useId().replace(/:/g, "");
  if (score == null) {
    return (
      <span className={cx("inline-flex items-center justify-center rounded-full border border-dashed border-line-strong text-[10px] uppercase tracking-[0.1em] text-faint", className)} style={{ width: size, height: size }}>
        n/a
      </span>
    );
  }
  const p = pct(score);
  const stroke = 3.5;
  const r = (size - stroke) / 2 - 1;
  const c = 2 * Math.PI * r;
  const strong = p >= 70;
  return (
    <span className={cx("relative inline-flex shrink-0 items-center justify-center", className)} style={{ width: size, height: size }} title={`${p}% match with your career graph`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="-rotate-90">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={strong ? "#34d399" : "#60a5fa"} />
            <stop offset="1" stopColor={strong ? "#fbbf24" : "#818cf8"} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(20,19,17,0.09)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${gid})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${(c * p) / 100} ${c}`}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-display text-[13px] font-medium leading-none tracking-[-0.02em] text-ink tnum">
        {p}
        <span className="text-[0.62em] font-normal text-muted">%</span>
      </span>
    </span>
  );
}
