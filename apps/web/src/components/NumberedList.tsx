import Link from "next/link";
import type { ReactNode } from "react";
import { cx, idx } from "./cx";

export type NumberedItem = {
  id: string;
  title: ReactNode;
  meta?: ReactNode;
  aside?: ReactNode;
  /** Replaces the index number (e.g. a check marker). */
  marker?: ReactNode;
  href?: string;
};

/** Numbered rows (01, 02, 03) separated by hairlines. */
export function NumberedList({ items, start = 1, dense, className, empty }: {
  items: NumberedItem[]; start?: number; dense?: boolean; className?: string; empty?: ReactNode;
}) {
  if (items.length === 0 && empty) return <p className="border-y border-line py-6 text-body-sm text-muted">{empty}</p>;
  return (
    <ol className={cx("border-t border-line", className)}>
      {items.map((it, i) => (
        <li
          key={it.id}
          className={cx(
            "grid grid-cols-[2rem_minmax(0,1fr)] items-baseline gap-x-3 border-b border-line sm:grid-cols-[2.75rem_minmax(0,1fr)_auto] sm:gap-x-4",
            dense ? "py-2.5" : "py-4",
          )}
        >
          <span className="text-label font-medium text-faint tnum">{it.marker ?? idx(start + i)}</span>
          <div className="min-w-0">
            {it.href ? (
              <Link href={it.href} className="text-body-sm font-medium text-ink decoration-line-strong underline-offset-4 hover:underline">{it.title}</Link>
            ) : (
              <div className={cx("text-ink", dense ? "text-meta" : "text-body-sm font-medium")}>{it.title}</div>
            )}
            {it.meta && <div className="mt-0.5 text-meta text-muted">{it.meta}</div>}
          </div>
          {it.aside && <div className="col-start-2 mt-2 sm:col-start-3 sm:mt-0 sm:self-center sm:text-right">{it.aside}</div>}
        </li>
      ))}
    </ol>
  );
}
