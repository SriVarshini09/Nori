import type { Metadata } from "next";
import { api } from "@/lib/api";
import { CompanionView } from "@/components/agent/CompanionView";

export const metadata: Metadata = { title: "Companion" };
export const dynamic = "force-dynamic";

/** 360x560 tray popover. No shell: loaded straight into an Electron BrowserWindow with the session cookie. */
export default async function CompanionPage() {
  const [status, activity] = await Promise.allSettled([api.agentStatus(), api.agentActivity(3)]);
  return (
    <CompanionView
      initialStatus={status.status === "fulfilled" ? status.value : null}
      initialActivity={activity.status === "fulfilled" ? activity.value : []}
      initialError={status.status === "rejected" ? (status.reason instanceof Error ? status.reason.message : "Agent status is unavailable.") : null}
    />
  );
}
