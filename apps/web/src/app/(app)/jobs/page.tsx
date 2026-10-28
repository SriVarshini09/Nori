import type { Metadata } from "next";
import { api } from "@/lib/api";
import { DiscoverPanel } from "@/components/DiscoverPanel";
import { JobBoard, type BoardApp } from "@/components/JobBoard";
import { JobDrawer } from "@/components/JobDrawer";
import { JobViewBar } from "@/components/JobViewBar";
import { filtersToParams, parseFilters, parseView, viewToParams } from "@/components/jobMeta";
import { Notice, PageHeader, TextLink } from "@/components/ui";

export const metadata: Metadata = { title: "Jobs" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function JobsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const jobId = one(sp.job);
  const state = parseView(sp);
  const viewQuery = viewToParams(state).toString();

  // The chosen view is fetched on the server: Best match uses the server's lane filter; Newest and New today are
  // ordered by posting time in SQL. Older than 60 days is left out unless "Include older postings" is on.
  const [items, summary, appList, detail] = await Promise.all([
    api.listJobs({
      limit: 200,
      sort: state.view === "best" ? "best" : "new",
      lanes: state.view === "best",
      maxAgeDays: state.view === "today" ? 1 : state.older ? 0 : undefined,
      clearance: state.hideClearance ? "hide" : undefined,
    }).catch(() => null),
    api.jobsSummary().catch(() => null),
    api.listApplications().catch(() => []),
    jobId ? api.getJob(jobId).catch(() => null) : Promise.resolve(null),
  ]);
  const apps: Record<string, BoardApp> = {};
  for (const a of appList) apps[a.job.id] = { id: a.application.id, status: a.application.status };

  const keep = new URLSearchParams([...filtersToParams(filters), ...viewToParams(state)]).toString();
  const closeHref = `/jobs${keep ? `?${keep}` : ""}`;
  const count = (n: number) => n.toLocaleString("en-US");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Jobs"
        subtitle="Every open role Nori knows about, scored against your career graph."
        actions={<TextLink href="/companies">Followed companies</TextLink>}
      />
      <DiscoverPanel />
      <JobViewBar state={state} />
      {summary && (
        <p className="text-meta text-muted tnum" aria-live="polite">
          <span className="font-semibold text-ink">{count(summary.newToday)}</span> new today
          {summary.hasLanes && <> · <span className="font-semibold text-ink">{count(summary.fitsLanes)}</span> fit your lanes</>}
        </p>
      )}
      {items === null
        ? <Notice tone="red">Cannot load jobs right now. Try again in a moment.</Notice>
        : <JobBoard items={items} apps={apps} initial={filters} view={state.view} viewQuery={viewQuery} />}
      {detail && <JobDrawer detail={detail} closeHref={closeHref} application={apps[detail.job.id] ?? null} />}
    </div>
  );
}
