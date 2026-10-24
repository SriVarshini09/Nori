import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ApiError, api, USE_MOCK } from "@/lib/api";
import { EmptyState, LinkButton } from "@/components/ui";
import { ResumeStudio } from "@/components/resume/ResumeStudio";

export const metadata: Metadata = { title: "Edit resume" };
export const dynamic = "force-dynamic";

export default async function EditApplicationResumePage({ params }: { params: Promise<{ id: string }> }) {
  if (USE_MOCK) return <EmptyState title="The resume studio needs the live server">It renders real PDFs, so it does not run in demo mode. Start the API and turn demo mode off to use it.</EmptyState>;
  const { id } = await params;
  const [detail, options] = await Promise.all([
    api.getApplication(id).catch((e: unknown) => { if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound(); throw e; }),
    api.resumeTemplates(),
  ]);
  if (!detail.resume || detail.application.status !== "resume_review") {
    return (
      <EmptyState title="This resume can no longer be edited">
        You can edit a tailored resume while it waits for your review, before the form is filled.
        <div className="mt-4"><LinkButton href={`/applications/${id}`} variant="secondary">Back to the application</LinkButton></div>
      </EmptyState>
    );
  }
  return <ResumeStudio key={detail.resume.id} mode="application" applicationId={id} resume={detail.resume} jobTitle={detail.job.title.trim()} companyName={detail.job.companyName} options={options} />;
}
