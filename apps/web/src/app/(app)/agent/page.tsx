import type { Metadata } from "next";
import { api } from "@/lib/api";
import { AgentView } from "@/components/agent/AgentView";
import { Notice, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Auto apply" };
export const dynamic = "force-dynamic";

export default async function AgentPage() {
  const [status, activity, lanes] = await Promise.allSettled([api.agentStatus(), api.agentActivity(50), api.lanes()]);
  return (
    <div>
      <PageHeader label="Auto apply" index="01" title={<>Applying while<br />you are away.</>} subtitle="Set it once. It applies to new matches for you." />
      {status.status === "fulfilled" ? (
        <AgentView initialStatus={status.value} initialActivity={activity.status === "fulfilled" ? activity.value : []}
          initialLanes={lanes.status === "fulfilled" ? lanes.value : []}
        />
      ) : (
        <Notice tone="red">{status.reason instanceof Error ? status.reason.message : "Agent status is unavailable."}</Notice>
      )}
    </div>
  );
}
