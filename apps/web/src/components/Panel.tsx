import type { ReactNode } from "react";
import { cx } from "./cx";
import { Frame } from "./Frame";
import { Square } from "./IndexLabel";

/**
 * Hairline panel with a numbered heading row: "01 ■ Title ............ aside", then the body.
 * Used for the input panels (Discover, Add by URL, Tell the agent a fact, Paste resume).
 */
export function Panel({ index, title, aside, children, className, bodyClassName, as = "section" }: {
  index: string;
  title: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  as?: "section" | "div";
}) {
  return (
    <Frame as={as} className={cx("flex flex-col", className)}>
      <header className="flex min-h-12 items-center justify-between gap-4 border-b border-line px-5 py-3 sm:px-6">
        <h3 className="inline-flex min-w-0 items-baseline gap-3">
          <span className="font-display text-[22px] font-medium leading-none tracking-[-0.03em] text-faint tnum">{index}</span>
          <span className="inline-flex items-center gap-2 text-label font-medium uppercase text-ink">
            <Square tone="ink" size={6} />
            {title}
          </span>
        </h3>
        {aside && <span className="hidden shrink-0 text-[12px] text-faint sm:inline">{aside}</span>}
      </header>
      <div className={cx("flex-1 p-5 sm:p-6", bodyClassName)}>{children}</div>
    </Frame>
  );
}
