import type { Metadata } from "next";
import { api, USE_MOCK } from "@/lib/api";
import { CompaniesView } from "@/components/CompaniesView";
import { EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Companies" };
export const dynamic = "force-dynamic";

export default async function CompaniesPage() {
  if (USE_MOCK) return <EmptyState title="Needs the live API">The company list comes from the real job boards. Set NEXT_PUBLIC_USE_MOCK=0 and start apps/api.</EmptyState>;
  const initial = await api.listCompanies({ limit: 60 });
  return (
    <div>
      <PageHeader
        label="Companies"
        title={<>Who Nori<br />is watching.</>}
        subtitle="Follow the companies you care about and their new roles are scored for you within the hour. Add any company by pasting its careers link."
      />
      <CompaniesView initial={initial} />
    </div>
  );
}
