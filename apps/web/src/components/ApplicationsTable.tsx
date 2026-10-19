"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { FAILED, IN_FLIGHT, NEEDS_YOU, SUBMITTED } from "@/lib/format";
import type { ApplicationListItem } from "@/lib/types";
import { api, USE_MOCK } from "@/lib/api";
import { DataTable, type Column } from "./DataTable";
import { StatusPill } from "./StatusPill";
import { TimeAgo } from "./TimeAgo";
import { cx } from "./ui";

const TABS = [
  { id: "all", label: "All", match: () => true },
  { id: "flight", label: "In flight", match: (i: ApplicationListItem) => IN_FLIGHT.includes(i.application.status) },
  { id: "needs", label: "Needs you", match: (i: ApplicationListItem) => NEEDS_YOU.includes(i.application.status) },
  { id: "submitted", label: "Submitted", match: (i: ApplicationListItem) => SUBMITTED.includes(i.application.status) },
  { id: "failed", label: "Failed", match: (i: ApplicationListItem) => FAILED.includes(i.application.status) },
] as const;

const linkCls = "text-ink underline decoration-line-strong underline-offset-4 transition-colors duration-150 hover:decoration-ink";

export function ApplicationsTable({ items, limit }: { items: ApplicationListItem[]; limit?: number }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("all");
  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.id, items.filter(t.match).length])), [items]);
  const active = TABS.find((t) => t.id === tab)!;
  const rows = items
    .filter(active.match)
    .sort((a, b) => +new Date(b.application.updatedAt) - +new Date(a.application.updatedAt))
    .slice(0, limit ?? items.length);

  const columns: Column<ApplicationListItem>[] = [
    {
      key: "position",
      header: "Position",
      cell: (i) => (
        <Link href={`/applications/${i.application.id}`} className="group block min-w-0 max-w-[190px] sm:max-w-none">
          <span className="block truncate font-medium text-ink decoration-line-strong underline-offset-4 group-hover:underline">{i.job.title}</span>
          <span className="block truncate text-meta text-muted">{i.job.companyName}</span>
        </Link>
      ),
    },
    {
      key: "resume",
      header: "Resume",
      hideOnMobile: true,
      cell: (i) => {
        if (!i.application.resumeId) return <span className="text-faint">Not yet</span>;
        const label = (
          <>Tailored{i.resume?.atsScore != null && <span className="ml-1.5 text-muted tnum">ATS {i.resume.atsScore}</span>}</>
        );
        return USE_MOCK ? (
          <Link href={`/applications/${i.application.id}#resume`} className={linkCls}>{label}</Link>
        ) : (
          <a href={api.resumePdfUrl(i.application.resumeId)} target="_blank" rel="noreferrer" className={linkCls}>{label}</a>
        );
      },
    },
    { key: "status", header: "Status", cell: (i) => <StatusPill status={i.application.status} /> },
    {
      key: "applied",
      header: "Applied",
      hideOnMobile: true, className: "whitespace-nowrap text-right text-muted",
      cell: (i) => <TimeAgo iso={i.application.submittedAt ?? i.application.createdAt} />,
    },
  ];

  return (
    <div>
      <div className="flex gap-6 overflow-x-auto border-b border-line px-4 sm:px-5" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cx(
              "-mb-px flex items-center gap-2 whitespace-nowrap border-b py-3 text-[11.5px] font-medium uppercase tracking-[0.09em] transition-colors duration-150",
              tab === t.id ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {t.label}
            <span className={cx("tracking-normal tnum", tab === t.id ? "text-muted" : "text-faint")}>{counts[t.id]}</span>
          </button>
        ))}
      </div>
      <DataTable columns={columns} rows={rows} rowKey={(i) => i.application.id} empty="No applications in this view." />
    </div>
  );
}
