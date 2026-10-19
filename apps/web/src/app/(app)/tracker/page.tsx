import type { Metadata } from "next";
import { api } from "@/lib/api";
import { TrackerBoard } from "@/components/TrackerBoard";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Tracker" };

export default async function TrackerPage() {
  const [items, stats] = await Promise.all([api.listApplications(), api.trackerStats()]);
  return (
    <div>
      <PageHeader
        label="Tracker"
        title={<>Every application,<br />by stage.</>}
        subtitle="Replies move cards on their own."
      />
      <TrackerBoard items={items} stats={stats} />
    </div>
  );
}
