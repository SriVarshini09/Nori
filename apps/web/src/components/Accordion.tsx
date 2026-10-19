import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cx } from "./cx";
import { Icon } from "./Icon";

/** Disclosure chevron; rotates when the parent <details> (a `group`) opens. */
export function SquareToggle({ className }: { className?: string }) {
  return <Icon icon={ChevronDown} className={cx("text-ink transition-transform duration-150 ease-[var(--ease)] group-open:rotate-180", className)} />;
}

/** Native <details> accordion with hairline separators. Works in server components. */
export function Accordion({ title, meta, index, children, defaultOpen, className }: {
  title: ReactNode; meta?: ReactNode; index?: string; children: ReactNode; defaultOpen?: boolean; className?: string;
}) {
  return (
    <details className={cx("group border-y border-line", className)} open={defaultOpen}>
      <summary className="flex cursor-pointer select-none items-center gap-4 py-3.5">
        {index && <span className="text-label font-medium text-faint tnum">{index}</span>}
        <span className="min-w-0 flex-1 text-body-sm font-medium text-ink">{title}</span>
        {meta && <span className="text-meta text-muted tnum">{meta}</span>}
        <SquareToggle />
      </summary>
      <div className="pb-5">{children}</div>
    </details>
  );
}
