"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search, Sheet } from "lucide-react";
import { api } from "@/lib/api";
import { FAILED, IN_FLIGHT, NEEDS_YOU } from "@/lib/format";
import type { ApplicationListItem, ApplicationStatus } from "@/lib/types";
import { Monogram } from "./Monogram";
import { StatusPill } from "./StatusPill";
import { TimeAgo } from "./TimeAgo";
import { Button, EmptyState, Icon, Notice, cx } from "./ui";

const DAY = 86_400_000;
/** No reply this long after sending: call it ghosted. A follow-up is suggested a week after sending. */
export const GHOST_DAYS = 21;
const FOLLOW_UP_DAYS = 7;
const AWAITING_REPLY: ApplicationStatus[] = ["submitted", "viewed"];

const sentAt = (i: ApplicationListItem) => (i.application.submittedAt ? new Date(i.application.submittedAt).getTime() : null);
export const isGhosted = (i: ApplicationListItem, now: number) => {
  const t = sentAt(i);
  return AWAITING_REPLY.includes(i.application.status) && t !== null && now - t >= GHOST_DAYS * DAY;
};

type Filter = { id: string; label: string; match: (i: ApplicationListItem) => boolean };

function makeFilters(now: number): Filter[] {
  return [
    { id: "all", label: "All", match: () => true },
    { id: "needs", label: "Waiting on you", match: (i) => NEEDS_YOU.includes(i.application.status) },
    { id: "flight", label: "In progress", match: (i) => IN_FLIGHT.includes(i.application.status) },
    { id: "sent", label: "Sent", match: (i) => AWAITING_REPLY.includes(i.application.status) && !isGhosted(i, now) },
    { id: "replied", label: "Replied", match: (i) => i.application.status === "replied" },
    { id: "interview", label: "Interview", match: (i) => i.application.status === "interview" },
    { id: "offer", label: "Offer", match: (i) => i.application.status === "offer" },
    { id: "ghosted", label: "Ghosted", match: (i) => isGhosted(i, now) },
    { id: "rejected", label: "Rejected", match: (i) => i.application.status === "rejected" },
    { id: "skipped", label: "Skipped", match: (i) => i.application.status === "skipped" },
    { id: "failed", label: "Failed", match: (i) => FAILED.includes(i.application.status) },
  ];
}

function nextStep(i: ApplicationListItem, now: number): string {
  const a = i.application;
  if (a.status === "resume_review") return "Review the resume";
  if (a.status === "form_review") return "Review the form";
  if (a.status === "needs_user") return `Answer ${a.pendingQuestions.length || "a"} question${a.pendingQuestions.length === 1 ? "" : "s"}`;
  if (a.status === "awaiting_code") return "Enter the code";
  if (IN_FLIGHT.includes(a.status)) return "Nori is on it";
  if (isGhosted(i, now)) return "Nudge or archive";
  if (AWAITING_REPLY.includes(a.status)) return "Wait for a reply";
  if (a.status === "replied") return "Read the reply";
  if (a.status === "interview") return "Prepare";
  if (a.status === "failed") return "Try again";
  return "Nothing";
}

function FollowUp({ item, now }: { item: ApplicationListItem; now: number }) {
  const t = sentAt(item);
  if (!AWAITING_REPLY.includes(item.application.status) || t === null) return <span className="text-muted">Not yet sent</span>;
  if (isGhosted(item, now)) return <span className="text-muted">Passed</span>;
  const due = t + FOLLOW_UP_DAYS * DAY;
  if (due <= now) return <span className="font-semibold text-ink">Due now</span>;
  return <span className="text-ink-2" suppressHydrationWarning>{new Date(due).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>;
}

function Stage({ item, now }: { item: ApplicationListItem; now: number }) {
  if (isGhosted(item, now)) {
    return <span className="inline-flex h-6 items-center rounded-full px-2.5 text-[12px] font-medium text-muted ring-1 ring-inset ring-control [border-style:dashed]">Ghosted</span>;
  }
  return <StatusPill status={item.application.status} />;
}

export function ApplicationsView({ items }: { items: ApplicationListItem[] }) {
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [sheet, setSheet] = useState<{ busy: boolean; url?: string; error?: string }>({ busy: false });
  // One clock reading per visit: ghosted and follow-up dates stay consistent while the page is open.
  const [now] = useState(() => Date.now());
  const FILTERS = useMemo(() => makeFilters(now), [now]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, items.filter(f.match).length])), [items, FILTERS]);
  const active = FILTERS.find((f) => f.id === filter)!;
  const term = q.trim().toLowerCase();
  const rows = items
    .filter(active.match)
    .filter((i) => !term || `${i.job.title} ${i.job.companyName}`.toLowerCase().includes(term))
    .sort((a, b) => Number(NEEDS_YOU.includes(b.application.status)) - Number(NEEDS_YOU.includes(a.application.status)) || +new Date(b.application.updatedAt) - +new Date(a.application.updatedAt));

  async function exportSheet() {
    setSheet({ busy: true });
    try {
      setSheet({ busy: false, url: (await api.syncSheet()).spreadsheetUrl });
    } catch (e) {
      setSheet({ busy: false, error: (e as Error).message });
    }
  }

  const settled = [
    { label: "Interview", n: counts.interview, line: "Prepare from the job page; replies land in Inbox." },
    { label: "Sent, waiting", n: counts.sent, line: `A follow-up is suggested ${FOLLOW_UP_DAYS} days after sending.` },
    { label: "Ghosted", n: counts.ghosted, line: `No reply in ${GHOST_DAYS} days. Nudge with a short note, or let it go.` },
    { label: "Skipped", n: counts.skipped, line: "Each keeps the reason it was skipped." },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-0 flex-1 sm:max-w-xs">
          <span className="sr-only">Search applications</span>
          <Icon icon={Search} size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Company or title" className="h-10 w-full rounded-control border border-control bg-surface pl-9 pr-3 text-body-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25" />
        </label>
        <div className="flex-1" />
        <Button variant="secondary" icon={Sheet} onClick={exportSheet} disabled={sheet.busy}>{sheet.busy ? "Exporting..." : "Export to Google Sheets"}</Button>
      </div>
      {sheet.url && <Notice tone="green">Exported. <a href={sheet.url} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-4">Open the sheet</a></Notice>}
      {sheet.error && <Notice tone="red">{sheet.error}</Notice>}

      <div role="group" aria-label="Filter by stage" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {FILTERS.filter((f) => f.id === "all" || counts[f.id] > 0 || f.id === filter).map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={cx(
              "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium transition-colors",
              filter === f.id ? "border-ink bg-ink text-on-ink" : "border-line bg-surface text-ink-2 hover:border-control",
              f.id === "needs" && filter !== f.id && "border-attn text-attn-fg",
            )}
          >
            {f.label}
            <span className={cx("tnum", filter === f.id ? "text-on-ink/80" : "text-muted")}>{counts[f.id]}</span>
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState title={items.length === 0 ? "No applications yet" : "Nothing in this view"}>
          {items.length === 0 ? <>Apply to a job from <Link href="/jobs" className="font-medium text-accent underline-offset-4 hover:underline">Jobs</Link>, or add a lane so Nori queues matches itself.</> : "Try another filter."}
        </EmptyState>
      ) : (
        <>
          {/* desktop table */}
          <div className="hidden overflow-x-auto rounded-card border border-line bg-surface md:block">
            <table className="w-full text-left text-body-sm">
              <thead>
                <tr className="border-b border-line text-[12px] text-muted">
                  <th scope="col" className="px-4 py-2.5 font-medium">Role</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Stage</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Resume</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Next step</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Follow up</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((i) => {
                  const waiting = NEEDS_YOU.includes(i.application.status);
                  return (
                    <tr key={i.application.id} className={cx("hover:bg-sunken/50", waiting && "bg-attn-tint/30")}>
                      <td className="px-4 py-3">
                        <Link href={`/applications/${i.application.id}`} className="group flex min-w-0 items-center gap-3">
                          <Monogram name={i.job.companyName} size={34} />
                          <span className="min-w-0">
                            <span className="block truncate font-semibold text-ink underline-offset-4 group-hover:underline">{i.job.title}</span>
                            <span className="block truncate text-meta text-muted">{i.job.companyName}</span>
                          </span>
                        </Link>
                      </td>
                      <td className="px-3 py-3"><Stage item={i} now={now} /></td>
                      <td className="px-3 py-3 text-meta text-ink-2 tnum">{i.resume?.atsScore != null ? `ATS ${i.resume.atsScore}` : <span className="text-muted">Not yet</span>}</td>
                      <td className={cx("px-3 py-3 text-meta", waiting ? "font-semibold text-attn-fg" : "text-ink-2")}>{nextStep(i, now)}</td>
                      <td className="px-3 py-3 text-meta"><FollowUp item={i} now={now} /></td>
                      <td className="px-4 py-3 text-right text-meta text-muted"><TimeAgo iso={i.application.updatedAt} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* phone cards */}
          <ul className="flex flex-col gap-2.5 md:hidden">
            {rows.map((i) => {
              const waiting = NEEDS_YOU.includes(i.application.status);
              return (
                <li key={i.application.id}>
                  <Link href={`/applications/${i.application.id}`} className={cx("flex flex-col gap-1.5 rounded-card border bg-surface p-3.5", waiting ? "border-2 border-attn" : "border-line")}>
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-ink">{i.job.title}</span>
                        <span className="block truncate text-meta text-muted">{i.job.companyName}</span>
                      </span>
                      <Stage item={i} now={now} />
                    </div>
                    <p className={cx("text-meta", waiting ? "font-semibold text-attn-fg" : "text-ink-2")}>{nextStep(i, now)}</p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {items.length > 0 && (
        <section aria-label="Settled" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {settled.map((s) => (
            <div key={s.label} className="rounded-card bg-sunken p-4">
              <p className="text-body-sm font-semibold text-ink">{s.label} <span className="font-normal text-muted tnum">{s.n}</span></p>
              <p className="mt-1 text-meta text-muted">{s.line}</p>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
