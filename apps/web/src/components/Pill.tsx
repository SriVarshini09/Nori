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

/** Status pill: tinted stone, ink text, small square marker. */
export function Pill({ children, mark = "muted", pulse, className, title }: {
  children: ReactNode; mark?: MarkTone | "none"; pulse?: boolean; className?: string; title?: string;
}) {
  return (
    <span title={title} className={cx("inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full bg-stone px-2.5 text-[12px] font-medium text-ink", className)}>
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
        "inline-flex max-w-full items-center gap-1.5 rounded-[var(--radius-tag)] border border-line px-1.5 py-[2px] text-[12px] leading-[1.35] text-ink-2",
        interactive && "transition-colors duration-150 hover:border-ink hover:text-ink",
        className,
      )}
    >
      {mark && <Square tone={mark} size={5} />}
      {kind && <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-faint">{kind}</span>}
      <span className="truncate">{children}</span>
    </span>
  );
}
