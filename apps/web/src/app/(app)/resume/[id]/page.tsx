import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ApiError, api, USE_MOCK } from "@/lib/api";
import { EmptyState } from "@/components/ui";
import { ResumeStudio } from "@/components/resume/ResumeStudio";

export const metadata: Metadata = { title: "Resume studio" };
export const dynamic = "force-dynamic";

export default async function ResumeStudioPage({ params }: { params: Promise<{ id: string }> }) {
  if (USE_MOCK) return <EmptyState title="The resume studio needs the live server">It renders real PDFs, so it does not run in demo mode. Start the API and turn demo mode off to use it.</EmptyState>;
  const { id } = await params;
  const [doc, options] = await Promise.all([
    api.resumeDoc(id).catch((e: unknown) => { if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound(); throw e; }),
    api.resumeTemplates(),
  ]);
  return <ResumeStudio key={doc.id} mode="doc" doc={doc} options={options} />;
}
