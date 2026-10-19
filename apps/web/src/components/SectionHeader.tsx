import type { ReactNode } from "react";
import { cx } from "./cx";
import { IndexLabel, type MarkTone } from "./IndexLabel";

/**
 * Editorial section header on the 12-column grid:
 *   [3 cols] index + square marker + label   [6 cols] two-line display heading   [3 cols] one muted sentence
 * `size="xl"` + `as="h1"` is the page header; `size="lg"` (default) is a section inside a page.
 */
export function SectionHeader({ index, label, title, description, actions, as: H = "h2", size = "lg", rule = true, marker = true, className }: {
  index?: string | number;
  label: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  as?: "h1" | "h2" | "h3";
  size?: "xl" | "lg" | "md";
  rule?: boolean;
  marker?: boolean | MarkTone;
  className?: string;
}) {
  return (
    <header className={cx("grid grid-cols-12 gap-x-6 gap-y-3", rule && "border-t border-line pt-4", className)}>
      <div className="col-span-12 lg:col-span-3 lg:pt-2">
        <IndexLabel index={index} marker={marker}>{label}</IndexLabel>
      </div>
      <H
        className={cx(
          "col-span-12 font-display font-medium text-balance text-ink lg:col-span-6",
          size === "xl" && "text-[2.375rem] leading-[1] tracking-[-0.04em] sm:text-display-xl",
          size === "lg" && "text-[1.875rem] leading-[1.04] tracking-[-0.035em] sm:text-display-lg",
          size === "md" && "text-display-md",
        )}
      >
        {title}
      </H>
      {(description || actions) && (
        <div className="col-span-12 flex flex-col gap-4 lg:col-span-3 lg:items-end lg:self-end lg:text-right">
          {description && <p className="max-w-[36ch] text-body-sm text-muted">{description}</p>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
    </header>
  );
}
