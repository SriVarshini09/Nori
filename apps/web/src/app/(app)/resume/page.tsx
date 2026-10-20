import type { Metadata } from "next";
import { api, USE_MOCK } from "@/lib/api";
import { EmptyState, Notice, PageHeader } from "@/components/ui";
import { ResumeLibrary } from "@/components/resume/ResumeLibrary";

export const metadata: Metadata = { title: "Resume" };
export const dynamic = "force-dynamic";

export default async function ResumePage() {
  if (USE_MOCK) {
    return (
      <div>
        <PageHeader label="Resume" title={<>Your resumes,<br />your look.</>} subtitle="Edit, restyle and export." />
        <EmptyState title="Needs the live API">The resume studio runs on the real renderer. Set NEXT_PUBLIC_USE_MOCK=0 and start apps/api.</EmptyState>
      </div>
    );
  }
  const [docs, options] = await Promise.all([api.resumeDocs(), api.resumeTemplates()]);
  return (
    <div>
      <PageHeader label="Resume" title={<>Your resumes,<br />your look.</>} subtitle="Edit every line, pick a template, export to PDF or Word." />
      {docs.length === 0 && <div className="mb-8"><Notice label="Start here">Your first resume is created automatically when you add one in onboarding. You can also build one from your career graph.</Notice></div>}
      <ResumeLibrary docs={docs} options={options} />
    </div>
  );
}
