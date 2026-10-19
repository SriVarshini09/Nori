"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import type { ResumeChange } from "@/lib/types";
import { cx, idx } from "./cx";
import { Icon } from "./Icon";
import { Tag } from "./Pill";

/**
 * One resume change on one line: index | before (struck, muted) -> after (ink) | "why".
 * Hovering the row (or pinning it with "why") reveals the reason and the graph nodes it came from.
 */
export function DiffRow({ change, nodeLabels, index }: {
  change: ResumeChange; nodeLabels: Record<string, { label: string; type: string }>; index: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="group border-b border-line">
      <div className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 py-3 sm:grid-cols-[2.5rem_minmax(0,1fr)_auto]">
        <span className="text-label font-medium text-faint tnum">{idx(index)}</span>
        <p className="flex min-w-0 items-center gap-2.5 text-body-sm">
          <span className="hidden min-w-0 max-w-[38%] shrink-0 truncate text-muted line-through decoration-line-strong sm:inline" title={change.before}>{change.before}</span>
          <Icon icon={ArrowRight} className="hidden text-faint sm:block" />
          <span className={cx("min-w-0 text-ink", open ? "" : "truncate group-hover:whitespace-normal")} title={change.after}>{change.after}</span>
        </p>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={cx(
            "h-6 rounded-full border px-2.5 text-[11.5px] font-medium transition-colors duration-150",
            open ? "border-ink bg-ink text-paper" : "border-line text-ink-2 hover:border-ink hover:text-ink",
          )}
        >
          why
        </button>
      </div>
      <div className={cx("grid-cols-[2rem_minmax(0,1fr)] gap-x-3 pb-3 sm:grid-cols-[2.5rem_minmax(0,1fr)]", open ? "grid" : "hidden group-hover:grid")}>
        <div className="col-start-2 space-y-2">
          <p className="text-meta text-muted line-through decoration-line-strong sm:hidden">{change.before}</p>
          <p className="text-meta text-ink-2">{change.reason}</p>
          {change.nodeIds.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {change.nodeIds.map((id) => {
                const n = nodeLabels[id];
                return (
                  <Link key={id} href={`/graph?node=${encodeURIComponent(id)}`} className="max-w-full">
                    <Tag kind={n?.type ?? "node"} interactive>{n?.label ?? id}</Tag>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
