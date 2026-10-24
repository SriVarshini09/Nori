import type { Metadata } from "next";
import { api } from "@/lib/api";
import { DiscoverPanel } from "@/components/DiscoverPanel";
import { JobBoard, type BoardApp } from "@/components/JobBoard";
import { JobDrawer } from "@/components/JobDrawer";
import { filtersToParams, parseFilters } from "@/components/jobMeta";
import { Notice, PageHeader, TextLink } from "@/components/ui";

export const metadata: Metadata = { title: "Jobs" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function JobsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const jobId = one(sp.job);

  const [items, appList, detail] = await Promise.all([
    api.listJobs({ limit: 200 }).catch(() => null),
    api.listApplications().catch(() => []),
    jobId ? api.getJob(jobId).catch(() => null) : Promise.resolve(null),
  ]);
  const apps: Record<string, BoardApp> = {};
  for (const a of appList) apps[a.job.id] = { id: a.application.id, status: a.application.status };

  const keep = filtersToParams(filters).toString();
  const closeHref = `/jobs${keep ? `?${keep}` : ""}`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Jobs"
        subtitle="Every open role Nori knows about, scored against your career graph."
        actions={<TextLink href="/companies">Followed companies</TextLink>}
      />
      <DiscoverPanel />
      {items === null ? <Notice tone="red">Cannot load jobs right now. Try again in a moment.</Notice> : <JobBoard items={items} apps={apps} initial={filters} />}
      {detail && <JobDrawer detail={detail} closeHref={closeHref} application={apps[detail.job.id] ?? null} />}
    </div>
  );
}
