import type { Metadata } from "next";
import { api } from "@/lib/api";
import { AgentToday } from "@/components/agent/AgentToday";
import { JobCard } from "@/components/JobCard";
import { SearchX } from "lucide-react";
import { EmptyState, Frame, LinkButton, PageHeader, SectionHeader, Stat } from "@/components/ui";

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
  const week = isoWeek(new Date());

  return (
    <div>
      <PageHeader
        label="Overview"
        index={`Wk ${week}`}
        title={<>Good to see you, {first}.<br />Here is your week.</>}
        subtitle="Live from the agent's queue."
      />

      {/* hero band: the one photograph on the site, with the week in numbers underneath */}
      <Frame as="section" className="overflow-hidden">
        <div className="relative h-[200px] sm:h-[300px] lg:h-[340px]">
          <div aria-hidden="true" className="hero-golden absolute inset-0" />
          <p className="absolute bottom-4 left-4 right-4 flex items-end justify-between gap-4 text-[#fbf3e6] sm:bottom-6 sm:left-6 sm:right-6">
            <span className="text-label font-medium uppercase opacity-90">Fig. 01 &mdash; Week {week}, at a glance</span>
          </p>
        </div>
        <div className="grid grid-cols-2 border-t border-line lg:grid-cols-4">
          {[
            { label: "Applied this week", value: applied },
            { label: "Replied", value: w.replied ?? 0 },
            { label: "Interviews", value: w.interview ?? 0 },
            { label: "Hours saved", value: w.hoursSaved ?? Math.round(applied * 0.8 * 10) / 10, hint: "vs applying by hand" },
          ].map((s, i) => (
            <div key={s.label} className={["p-5 sm:p-6", i % 2 === 1 ? "border-l border-line" : "", i >= 2 ? "border-t border-line lg:border-t-0" : "", i === 2 ? "lg:border-l" : ""].join(" ")}>
              <Stat index={String(i + 1).padStart(2, "0")} label={s.label} value={s.value} hint={s.hint} />
            </div>
          ))}
        </div>
      </Frame>

      <section className="mt-24 sm:mt-28">
        <SectionHeader
          index="01"
          label="Matches"
          title={<>Roles worth<br />your time.</>}
          actions={<LinkButton href="/jobs" variant="secondary" arrow>All jobs</LinkButton>}
        />
        <div className="mt-10">
          {top.length === 0 ? (
            <EmptyState icon={SearchX} title="No new matches yet">Run Discover on the jobs page.</EmptyState>
          ) : (
            <div className="grid grid-cols-12 gap-4 sm:gap-6">
                {top.map((item, i) => (
                  <div key={item.job.id} className={i === 2 ? "col-span-12 sm:col-span-6 sm:col-start-4 lg:col-span-4 lg:col-start-auto" : "col-span-12 sm:col-span-6 lg:col-span-4"}>
                    <JobCard item={item} index={i + 1} />
                  </div>
                ))}
            </div>
          )}
        </div>
      </section>

      <div className="mt-24 sm:mt-28">
        <AgentToday status={agentStatus} activity={agentActivity} />
      </div>
    </div>
  );
}
