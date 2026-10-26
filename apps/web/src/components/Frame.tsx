import type { CSSProperties, ReactNode } from "react";
import { cx } from "./cx";

type FrameTag = "div" | "section" | "article" | "aside" | "li" | "figure" | "header";

export function Ticks(props: { className?: string }) {
  void props;
  return null;
}

/**
 * Base surface card: luminous white elevated card on the sunlit botanical canvas.
 */
export function Frame({ as: Tag = "div", children, className, ticks, surface = "paper", tone, pad, id, style }: {
  as?: FrameTag;
  children?: ReactNode;
  className?: string;
  ticks?: boolean;
  surface?: "paper" | "none" | "stone";
  tone?: "attn";
  pad?: "sm" | "md" | "lg";
  id?: string;
  style?: CSSProperties;
}) {
  void ticks;
  return (
    <Tag
      id={id}
      style={style}
      className={cx(
        "relative rounded-card",
        surface === "paper" && "border border-line bg-surface/95 shadow-[0_8px_24px_-8px_rgba(19,28,24,0.06),0_1px_3px_rgba(19,28,24,0.03)]",
        surface === "stone" && "border border-line/70 bg-sunken/85",
        surface === "none" && "border border-dashed border-control/50 bg-surface/65",
        tone === "attn" && "border-2 border-attn bg-gradient-to-br from-[#fff7f2] to-white shadow-[0_6px_20px_rgba(192,75,14,0.09)]",
        pad === "sm" && "p-4",
        pad === "md" && "p-5",
        pad === "lg" && "p-6 sm:p-7",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
