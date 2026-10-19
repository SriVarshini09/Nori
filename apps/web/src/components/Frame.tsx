import type { CSSProperties, ReactNode } from "react";
import { cx } from "./cx";

type FrameTag = "div" | "section" | "article" | "aside" | "li" | "figure" | "header";

/** Four 6px L-shaped crop marks drawn over the corners of the nearest `relative` parent. */
export function Ticks({ className }: { className?: string }) {
  const base = "pointer-events-none absolute h-[var(--tick)] w-[var(--tick)] border-ink";
  return (
    <>
      <span aria-hidden="true" className={cx(base, "-left-px -top-px border-l border-t", className)} />
      <span aria-hidden="true" className={cx(base, "-right-px -top-px border-r border-t", className)} />
      <span aria-hidden="true" className={cx(base, "-bottom-px -left-px border-b border-l", className)} />
      <span aria-hidden="true" className={cx(base, "-bottom-px -right-px border-b border-r", className)} />
    </>
  );
}

/**
 * The base surface: 1px hairline outline with crop ticks at the four corners.
 * `surface="paper"` (default) fills with the card colour, `"none"` stays transparent on the canvas.
 */
export function Frame({ as: Tag = "div", children, className, ticks = true, surface = "paper", pad, id, style }: {
  as?: FrameTag;
  children?: ReactNode;
  className?: string;
  ticks?: boolean;
  surface?: "paper" | "none" | "stone";
  /** Shorthand padding: "sm" 16px, "md" 24px, "lg" 32px. Omit to pad yourself. */
  pad?: "sm" | "md" | "lg";
  id?: string;
  style?: CSSProperties;
}) {
  return (
    <Tag
      id={id}
      style={style}
      className={cx(
        "relative border border-line",
        surface === "paper" && "bg-paper",
        surface === "stone" && "bg-stone",
        pad === "sm" && "p-4",
        pad === "md" && "p-5 sm:p-6",
        pad === "lg" && "p-6 sm:p-8",
        className,
      )}
    >
      {ticks && <Ticks />}
      {children}
    </Tag>
  );
}
