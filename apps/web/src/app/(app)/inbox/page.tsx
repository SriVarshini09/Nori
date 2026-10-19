import type { Metadata } from "next";
import { api } from "@/lib/api";
import { InboxView } from "@/components/InboxView";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Inbox" };

export default async function InboxPage() {
  const [messages, apps] = await Promise.all([api.listInbox(), api.listApplications()]);
  const appTitles = Object.fromEntries(apps.map((a) => [a.application.id, `${a.job.title} at ${a.job.companyName}`]));
  const sorted = messages.slice().sort((a, b) => +new Date(b.receivedAt) - +new Date(a.receivedAt));
  const unread = messages.filter((m) => !m.read).length;
  return (
    <div>
      <PageHeader
        label="Inbox"
        title={unread > 0 ? <>{unread} new since<br />you last looked.</> : <>Mail, sorted<br />and linked.</>}
      />
      <InboxView initial={sorted} appTitles={appTitles} />
    </div>
  );
}
