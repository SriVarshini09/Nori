import type { Metadata } from "next";
import { api } from "@/lib/api";
import { DiscoverPanel } from "@/components/DiscoverPanel";
import { JobBoard, type BoardApp } from "@/components/JobBoard";
import { JobDrawer } from "@/components/JobDrawer";
import { filtersToParams, parseFilters } from "@/components/jobMeta";
import { PageHeader, SectionHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Browse jobs" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function JobsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const jobId = one(sp.job);

  const [items, appList, detail] = await Promise.all([
    api.listJobs({ limit: 200 }),
    api.listApplications(),
    jobId ? api.getJob(jobId).catch(() => null) : Promise.resolve(null),
  ]);
  const apps: Record<string, BoardApp> = {};
  for (const a of appList) apps[a.job.id] = { id: a.application.id, status: a.application.status };

  const keep = filtersToParams(filters).toString();
  const closeHref = `/jobs${keep ? `?${keep}` : ""}`;
  const top = items.reduce((m, j) => Math.max(m, j.match?.score ?? 0), 0);

  return (
    <div>
      <PageHeader
        label="Jobs"
        title={<>Every open role,<br />ranked against you.</>}
        subtitle={`${items.length} role${items.length === 1 ? "" : "s"} scored against your career graph${items.length ? `, best match ${Math.round(top * 100)}%` : ""}.`}
      />

      <DiscoverPanel />

      <section className="mt-20 sm:mt-24">
        <SectionHeader index="02" label="Board" size="md" title={<>Best matches<br />first.</>} />
        <div className="mt-8">
          <JobBoard items={items} apps={apps} initial={filters} />
        </div>
      </section>

      {detail && <JobDrawer detail={detail} closeHref={closeHref} application={apps[detail.job.id] ?? null} />}
    </div>
  );
}
