import type { Metadata } from "next";
import { api } from "@/lib/api";
import { ApplicationsTable } from "@/components/ApplicationsTable";
import { Frame, PageHeader } from "@/components/ui";
import { NEEDS_YOU } from "@/lib/format";

export const metadata: Metadata = { title: "Applications" };

export default async function ApplicationsPage() {
  const items = await api.listApplications();
  const needs = items.filter((i) => NEEDS_YOU.includes(i.application.status)).length;
  return (
    <div>
      <PageHeader
        label="Applications"
        title={needs > 0 ? <>{needs} waiting<br />on you.</> : <>Everything<br />in motion.</>}
        subtitle={needs > 0 ? "Open one to review it before it goes out." : undefined}
      />
      <Frame>
        <ApplicationsTable items={items} />
      </Frame>
    </div>
  );
}
