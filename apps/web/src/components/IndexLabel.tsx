import type { ReactNode } from "react";
import { cx } from "./cx";

export type MarkTone = "ink" | "accent" | "muted" | "hollow" | "outline";

/** Small square marker. `hollow` = muted outline (in progress), `outline` = ink outline (closed, negative). */
export function Square({ tone = "ink", size = 7, pulse, className }: { tone?: MarkTone; size?: number; pulse?: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={cx(
        "inline-block shrink-0 rounded-full",
        tone === "ink" && "bg-emerald-500",
        tone === "accent" && "bg-amber-500",
        tone === "muted" && "bg-faint",
        tone === "hollow" && "border-[1.5px] border-sky-500",
        tone === "outline" && "border-[1.5px] border-rose-500",
        pulse && "animate-pulse",
        className,
      )}
    />
  );
}

/** 11px uppercase index label: optional "01" number, optional square marker, then the label. */
export function IndexLabel({ index, marker, children, className, tone = "muted" }: {
  index?: string | number;
  marker?: boolean | MarkTone;
  children?: ReactNode;
  className?: string;
  tone?: "muted" | "ink";
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-2 text-label font-medium uppercase tnum",
        tone === "ink" ? "text-ink" : "text-muted",
        className,
      )}
    >
      {index !== undefined && <span className="text-faint">{typeof index === "number" ? String(index).padStart(2, "0") : index}</span>}
      {marker && <Square tone={marker === true ? "ink" : marker} />}
      {children}
    </span>
  );
}
