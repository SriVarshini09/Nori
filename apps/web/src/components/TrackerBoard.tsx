"use client";

import { ExternalLink, Sheet } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { STATUS_LABEL } from "@/lib/format";
import type { ApplicationListItem, ApplicationStatus, TrackerStats } from "@/lib/types";
import { DataTable, type Column } from "./DataTable";
import { STATUS_MARK, StatusPill } from "./StatusPill";
import { TimeAgo } from "./TimeAgo";
import { Button, Frame, Icon, Notice, Square, cx, idx } from "./ui";

const COLUMNS: { id: string; label: string; statuses: ApplicationStatus[] }[] = [
  { id: "progress", label: "In progress", statuses: ["queued", "tailoring", "filling", "submitting"] },
  { id: "needs", label: "Needs you", statuses: ["resume_review", "form_review", "awaiting_code", "needs_user"] },
  { id: "submitted", label: "Submitted", statuses: ["submitted", "viewed"] },
  { id: "replied", label: "Replied", statuses: ["replied"] },
  { id: "interview", label: "Interview", statuses: ["interview"] },
  { id: "offer", label: "Offer", statuses: ["offer"] },
  { id: "rejected", label: "Rejected", statuses: ["rejected"] },
  { id: "failed", label: "Failed / skipped", statuses: ["failed", "skipped"] },
];

export function TrackerBoard({ items, stats }: { items: ApplicationListItem[]; stats: TrackerStats }) {
  const [view, setView] = useState<"board" | "table">("board");
  const [syncing, setSyncing] = useState(false);
  const [sheet, setSheet] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function sync() {
    setSyncing(true);
    setError(null);
    try {
      setSheet((await api.syncSheet()).spreadsheetUrl);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  const countFor = (statuses: ApplicationStatus[]) => {
    const fromStats = statuses.reduce((n, s) => n + (stats.byStatus[s] ?? 0), 0);
    const fromItems = items.filter((i) => statuses.includes(i.application.status)).length;
    return Math.max(fromStats, fromItems);
  };

  const columns: Column<ApplicationListItem>[] = [
    {
      key: "pos", header: "Position",
      cell: (i) => (
        <Link href={`/applications/${i.application.id}`} className="group block min-w-0 max-w-[190px] sm:max-w-none">
          <span className="block truncate font-medium text-ink decoration-line-strong underline-offset-4 group-hover:underline">{i.job.title}</span>
          <span className="text-meta text-muted">{i.job.companyName}</span>
        </Link>
      ),
    },
    { key: "status", header: "Status", cell: (i) => <StatusPill status={i.application.status} /> },
    { key: "ats", header: "ATS", hideOnMobile: true, className: "tnum", cell: (i) => i.resume?.atsScore ?? "–" },
    { key: "when", header: "Updated", hideOnMobile: true, className: "whitespace-nowrap text-right text-muted", cell: (i) => <TimeAgo iso={i.application.updatedAt} /> },
  ];

  return (
    <div className="space-y-8">
      {/* totals strip: plain numbers on a hairline grid */}
      <dl className="grid grid-cols-2 gap-px border-y border-line bg-line sm:grid-cols-4 xl:grid-cols-8">
        {COLUMNS.map((c) => (
          <div key={c.id} className="bg-canvas px-4 py-4">
            <dt className="text-label font-medium uppercase text-muted">{c.label}</dt>
            <dd className="mt-2 font-display text-[28px] font-medium leading-none tracking-[-0.03em] text-ink tnum">{countFor(c.statuses)}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-full border border-line p-[3px]" role="group" aria-label="View">
          {(["board", "table"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={cx(
                "h-[28px] rounded-full px-4 text-[12px] font-medium uppercase tracking-[0.09em] transition-colors duration-150",
                view === v ? "bg-ink text-paper" : "text-muted hover:text-ink",
              )}
            >
              {v}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {sheet && (
            <a href={sheet} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-meta font-medium text-ink underline decoration-line-strong underline-offset-4">Open sheet <Icon icon={ExternalLink} /></a>
          )}
          <Button icon={Sheet} onClick={sync} disabled={syncing}>{syncing ? "Syncing..." : "Sync to Google Sheet"}</Button>
        </div>
      </div>

      {sheet && <Notice tone="green">Synced. Spreadsheet: <a className="break-all underline underline-offset-4" href={sheet} target="_blank" rel="noreferrer">{sheet}</a></Notice>}
      {error && <Notice tone="red">{error}</Notice>}

      {view === "board" ? (
        <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
          <div className="flex min-w-max border-l border-line">
            {COLUMNS.map((col, ci) => {
              const colItems = items.filter((i) => col.statuses.includes(i.application.status));
              return (
                <section key={col.id} className="w-60 shrink-0 border-r border-line px-3 pb-4">
                  <header className="flex items-center justify-between border-b border-line py-3">
                    <h3 className="flex items-center gap-2 text-label font-medium uppercase text-ink">
                      <span className="text-faint tnum">{idx(ci + 1)}</span>
                      <Square tone={STATUS_MARK[col.statuses[0]]} size={6} />
                      {col.label}
                    </h3>
                    <span className="text-meta text-muted tnum">{countFor(col.statuses)}</span>
                  </header>
                  <div className="mt-3 space-y-3">
                    {colItems.length === 0 && <div className="border border-dashed border-line px-2 py-5 text-center text-[12px] text-faint">Empty</div>}
                    {colItems.map((i) => (
                      <Link key={i.application.id} href={`/applications/${i.application.id}`} className="group block">
                        <Frame className="p-3 transition-colors duration-150 group-hover:border-line-strong">
                          <div className="text-label font-medium uppercase text-muted">{i.job.companyName}</div>
                          <div className="mt-1.5 text-body-sm font-medium leading-snug text-ink">{i.job.title}</div>
                          <div className="mt-3 flex items-center justify-between border-t border-line pt-2 text-[12px] text-muted">
                            <span>{STATUS_LABEL[i.application.status]}</span>
                            <TimeAgo iso={i.application.updatedAt} />
                          </div>
                        </Frame>
                      </Link>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      ) : (
        <Frame>
          <DataTable columns={columns} rows={items} rowKey={(i) => i.application.id} empty="No applications yet." />
        </Frame>
      )}
    </div>
  );
}
