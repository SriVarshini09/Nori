import type { Metadata } from "next";
import { api, USE_MOCK } from "@/lib/api";
import { EmptyState, Notice, PageHeader } from "@/components/ui";
import { ResumeLibrary } from "@/components/resume/ResumeLibrary";

export const metadata: Metadata = { title: "Resumes" };
export const dynamic = "force-dynamic";

export default async function ResumePage() {
  const header = <PageHeader title="Resumes" subtitle="Your base resumes. Nori tailors a copy of the default one for each job; edit lines, template and style here." />;
  if (USE_MOCK) {
    return (
      <div>
        {header}
        <EmptyState title="The resume studio needs the live server">It renders real PDFs, so it does not run in demo mode. Start the API and turn demo mode off to use it.</EmptyState>
      </div>
    );
  }
  const [docs, options] = await Promise.all([api.resumeDocs(), api.resumeTemplates()]);
  return (
    <div>
      {header}
      {docs.length === 0 && <div className="mb-6"><Notice label="Start here">Your first resume is created when you add one during set-up. You can also build one from your career graph.</Notice></div>}
      <ResumeLibrary docs={docs} options={options} />
    </div>
  );
}
