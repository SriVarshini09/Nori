"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, CircleX } from "lucide-react";
import { formatTime } from "@/lib/format";
import type { RunEventRow } from "@/lib/types";
import { Square } from "./IndexLabel";
import { Icon } from "./Icon";
import { cx } from "./cx";

const levelClass = { info: "text-ink-2", warn: "text-ink", error: "text-accent-ink" } as const;

/** Run log. Shows the last `collapsedTo` lines until "Show all" is pressed. */
export function EventLog({ events, mode, collapsedTo = 3 }: {
  events: RunEventRow[]; mode: "live" | "polling" | "simulated" | "idle"; collapsedTo?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length, all]);

  const modeLabel = { live: "Live", polling: "Polling", simulated: "Simulated", idle: "Idle" }[mode];
  const active = mode === "live" || mode === "simulated";
  const shown = all ? events : events.slice(-collapsedTo);
  const hidden = events.length - shown.length;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="inline-flex items-center gap-2 text-label font-medium uppercase text-muted">
          <Square tone={active ? "accent" : mode === "polling" ? "hollow" : "muted"} size={6} pulse={active} />
          Log &middot; {modeLabel}
        </span>
        {(hidden > 0 || all) && events.length > collapsedTo && (
          <button type="button" onClick={() => setAll((a) => !a)} className="inline-flex min-h-6 items-center gap-1 py-1 text-[12px] font-medium text-ink-2 hover:text-ink">
            {all ? "Show less" : `Show all ${events.length}`}
            <Icon icon={all ? ChevronUp : ChevronDown} />
          </button>
        )}
      </div>
      <div ref={ref} className={cx("border-t border-line font-mono text-[11.5px] leading-relaxed", all && "max-h-96 overflow-y-auto")} aria-live="polite">
        {events.length === 0 && <div className="py-2 text-faint">Waiting for events...</div>}
        {shown.map((e, i) => (
          <div key={e.id ?? `${e.ts}-${i}`} className="grid grid-cols-[4.25rem_minmax(0,1fr)] gap-x-2 border-b border-line py-1.5">
            <span className="text-faint tnum">{formatTime(e.ts)}</span>
            <span className={cx("flex min-w-0 items-start gap-1.5 break-words font-sans text-meta", levelClass[e.level])} title={e.step}>
              {e.level === "error" && <Icon icon={CircleX} className="mt-[2px]" />}
              {e.message}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
