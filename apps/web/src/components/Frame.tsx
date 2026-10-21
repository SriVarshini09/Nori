import type { CSSProperties, ReactNode } from "react";
import { cx } from "./cx";

type FrameTag = "div" | "section" | "article" | "aside" | "li" | "figure" | "header";

/** The crop marks were retired with the aurora look. Kept as a no-op so existing callers still compile. */
export function Ticks(props: { className?: string }) {
  void props;
  return null;
}

/**
 * The base surface: a soft rounded card.
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
        "relative rounded-[22px] border",
        surface === "paper" && "border-black/[0.06] bg-white shadow-[0_1px_2px_rgba(20,19,17,0.04),0_16px_36px_-24px_rgba(20,19,17,0.2)]",
        surface === "stone" && "border-black/[0.05] bg-stone/70",
        surface === "none" && "border-dashed border-black/15 bg-white/40",
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
