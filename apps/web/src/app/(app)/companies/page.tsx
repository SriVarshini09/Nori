import type { Metadata } from "next";
import { api, USE_MOCK } from "@/lib/api";
import { CompaniesView } from "@/components/CompaniesView";
import { EmptyState, PageHeader, TextLink } from "@/components/ui";

export const metadata: Metadata = { title: "Companies" };
export const dynamic = "force-dynamic";

export default async function CompaniesPage() {
  const header = (
    <PageHeader
      title="Followed companies"
      subtitle="Follow a company and its new roles are scored for you within the hour. Add any company by pasting its careers link."
      actions={<TextLink href="/jobs">Back to jobs</TextLink>}
    />
  );
  if (USE_MOCK) {
    return (
      <div>
        {header}
        <EmptyState title="Company lists need the live server">They come from the real job boards, so they do not run in demo mode.</EmptyState>
      </div>
    );
  }
  const initial = await api.listCompanies({ limit: 60 });
  return (
    <div>
      {header}
      <CompaniesView initial={initial} />
    </div>
  );
}
