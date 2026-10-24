import type { Metadata } from "next";
import { api } from "@/lib/api";
import { AgentView } from "@/components/agent/AgentView";
import { Notice, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Lanes and autopilot" };
export const dynamic = "force-dynamic";

export default async function LanesPage() {
  const [status, lanes] = await Promise.allSettled([api.agentStatus(), api.lanes()]);
  return (
    <div>
      <PageHeader title="Lanes and autopilot" subtitle="The rules Nori follows: which jobs it may queue, how many a day, and when it must ask you." />
      {status.status === "fulfilled" ? (
        <AgentView initialStatus={status.value} initialLanes={lanes.status === "fulfilled" ? lanes.value : []} />
      ) : (
        <Notice tone="red">{status.reason instanceof Error ? status.reason.message : "Agent status is unavailable."}</Notice>
      )}
    </div>
  );
}
