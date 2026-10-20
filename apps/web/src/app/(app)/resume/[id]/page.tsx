import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ApiError, api, USE_MOCK } from "@/lib/api";
import { EmptyState } from "@/components/ui";
import { ResumeStudio } from "@/components/resume/ResumeStudio";

export const metadata: Metadata = { title: "Resume studio" };
export const dynamic = "force-dynamic";

export default async function ResumeStudioPage({ params }: { params: Promise<{ id: string }> }) {
  if (USE_MOCK) return <EmptyState title="Needs the live API">The resume studio runs on the real renderer. Set NEXT_PUBLIC_USE_MOCK=0 and start apps/api.</EmptyState>;
  const { id } = await params;
  const [doc, options] = await Promise.all([
    api.resumeDoc(id).catch((e: unknown) => { if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound(); throw e; }),
    api.resumeTemplates(),
  ]);
  return <ResumeStudio key={doc.id} mode="doc" doc={doc} options={options} />;
}
