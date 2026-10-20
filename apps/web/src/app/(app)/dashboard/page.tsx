import type { Metadata } from "next";
import { api } from "@/lib/api";
import { IN_FLIGHT, NEEDS_YOU } from "@/lib/format";
import { Feed, Hero, Matches, NeedsYou, Pipeline, Recent, Ticker, WeekChart } from "@/components/dash/parts";

export const metadata: Metadata = { title: "Dashboard" };

function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((+t - +yearStart) / 86400000 + 1) / 7);
}

export default async function DashboardPage() {
  const [jobs, apps, stats, me, agentStatus, agentActivity] = await Promise.all([
    api.listJobs({ limit: 30 }),
    api.listApplications(),
    api.trackerStats(),
    api.me(),
    api.agentStatus().catch(() => null),
    api.agentActivity(20).catch(() => []),
  ]);
  const appliedJobIds = new Set(apps.map((a) => a.job.id));
  const top = jobs
    .filter((j) => !appliedJobIds.has(j.job.id) && !j.applicationStatus)
    .sort((a, b) => (b.match?.score ?? 0) - (a.match?.score ?? 0))
    .slice(0, 3);
  const w = stats.thisWeek;
  const applied = w.applied ?? 0;
  const first = (me.profile?.fullName ?? me.user.name ?? "there").split(" ")[0];
  const needs = apps.filter((a) => NEEDS_YOU.includes(a.application.status));
  const inFlight = apps.filter((a) => IN_FLIGHT.includes(a.application.status)).length;

  return (
    <div className="space-y-8 sm:space-y-10">
      <Hero
        first={first}
        status={agentStatus}
        week={isoWeek(new Date())}
        applied={applied}
        replied={w.replied ?? 0}
        interviews={w.interview ?? 0}
        hoursSaved={w.hoursSaved ?? Math.round(applied * 0.8 * 10) / 10}
        needsYou={needs.length}
      />
      <Ticker activity={agentActivity} />
      <NeedsYou items={needs} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
        <Pipeline byStatus={stats.byStatus} inFlight={inFlight} needsYou={needs.length} />
        <WeekChart apps={apps} />
      </div>
      <Matches items={top} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
        <Feed activity={agentActivity} />
        <Recent apps={apps} />
      </div>
    </div>
  );
}
