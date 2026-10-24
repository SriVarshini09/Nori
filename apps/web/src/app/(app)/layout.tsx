import { redirect } from "next/navigation";
import { api, ApiError, USE_MOCK } from "@/lib/api";
import { NEEDS_YOU } from "@/lib/format";
import { Shell, type ShellData } from "@/components/Shell";

async function shellData(): Promise<ShellData> {
  const data: ShellData = {
    applicationsCount: 0, needsYouCount: 0, unreadCount: 0, appliedThisWeek: 0, repliedThisWeek: 0, interviewsThisWeek: 0,
    hoursSaved: 0, userName: "you", mock: USE_MOCK, liveSubmit: true,
  };
  const [apps, inbox, stats, me, status] = await Promise.allSettled([api.listApplications(), api.listInbox(), api.trackerStats(), api.me(), api.agentStatus()]);
  if (apps.status === "fulfilled") {
    data.applicationsCount = apps.value.length;
    data.needsYouCount = apps.value.filter((a) => NEEDS_YOU.includes(a.application.status)).length;
  }
  if (inbox.status === "fulfilled") data.unreadCount = inbox.value.filter((m) => !m.read).length;
  if (stats.status === "fulfilled") {
    const w = stats.value.thisWeek;
    data.appliedThisWeek = w.applied ?? 0;
    data.repliedThisWeek = w.replied ?? 0;
    data.interviewsThisWeek = w.interview ?? 0;
    data.hoursSaved = w.hoursSaved ?? Math.round((w.applied ?? 0) * 0.8 * 10) / 10;
  }
  if (me.status === "fulfilled") data.userName = me.value.profile?.fullName ?? me.value.user.name ?? me.value.user.email;
  // Demo mode never sends; an older API without the field is treated as live (no band) rather than guessed.
  if (status.status === "fulfilled") data.liveSubmit = status.value.liveSubmit !== false && !USE_MOCK;
  else if (USE_MOCK) data.liveSubmit = false;
  return data;
}

/** Signed-in app chrome. Sends a stale session to /login and an unfinished onboarding to /onboarding. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ob = await api.onboarding().catch((e: unknown) => e);
  if (ob instanceof ApiError && ob.status === 401) redirect("/session-expired");
  // Any other failure (API down, older API without the route) falls through to the pages, which show their own errors.
  if (!(ob instanceof Error) && ob && typeof ob === "object" && "step" in ob && ob.step !== "done") redirect("/onboarding");
  const data = await shellData();
  return <Shell data={data}>{children}</Shell>;
}
