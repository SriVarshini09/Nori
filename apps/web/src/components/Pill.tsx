import type { ReactNode } from "react";
import type { Tone } from "@/lib/format";
import { cx } from "./cx";
import { Square, type MarkTone } from "./IndexLabel";

/** Legacy tone names map onto marker styles; the pill itself is always stone with ink text. */
export const TONE_MARK: Record<Tone, MarkTone> = {
  amber: "accent",
  orange: "accent",
  green: "ink",
  teal: "ink",
  blue: "hollow",
  red: "outline",
  slate: "muted",
};

/** Soft tint per marker tone: green = done, amber = waiting on you, blue = the agent is working, rose = closed or failed. */
export const PILL_TONE: Record<MarkTone | "none", string> = {
  ink: "bg-emerald-50 text-emerald-900 ring-emerald-600/15",
  accent: "bg-amber-50 text-amber-900 ring-amber-600/20",
  hollow: "bg-sky-50 text-sky-900 ring-sky-600/15",
  outline: "bg-rose-50 text-rose-900 ring-rose-600/15",
  muted: "bg-stone text-ink-2 ring-black/5",
  none: "bg-stone text-ink ring-black/5",
};

/** Status pill: soft tint by tone, a small dot, readable text. */
export function Pill({ children, mark = "muted", pulse, className, title }: {
  children: ReactNode; mark?: MarkTone | "none"; pulse?: boolean; className?: string; title?: string;
}) {
  return (
    <span title={title} className={cx("inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[12px] font-medium ring-1 ring-inset", PILL_TONE[mark], className)}>
      {mark !== "none" && <Square tone={mark} size={6} pulse={pulse} />}
      {children}
    </span>
  );
}

/** Outlined tag (provenance, skills, metadata). Optional `kind` prefix in faint uppercase. */
export function Tag({ children, kind, mark, className, interactive }: {
  children: ReactNode; kind?: ReactNode; mark?: MarkTone; className?: string; interactive?: boolean;
}) {
  return (
    <span
      className={cx(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border border-black/10 bg-white px-2.5 py-[2px] text-[12px] leading-[1.35] text-ink-2",
        interactive && "transition-colors duration-150 hover:border-emerald-600/50 hover:text-ink",
        className,
      )}
    >
      {mark && <Square tone={mark} size={5} />}
      {kind && <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-faint">{kind}</span>}
      <span className="truncate">{children}</span>
    </span>
  );
}
