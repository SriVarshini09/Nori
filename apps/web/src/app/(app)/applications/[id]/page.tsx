import type { Metadata } from "next";
import { api } from "@/lib/api";
import { ApplicationReview } from "@/components/ApplicationReview";

export const metadata: Metadata = { title: "Application" };

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [detail, graph] = await Promise.all([api.getApplication(id), api.graph().catch(() => ({ nodes: [], edges: [] }))]);
  const nodeLabels = Object.fromEntries(graph.nodes.map((n) => [n.id, { label: n.label, type: n.type }]));
  return <ApplicationReview key={detail.application.id} initial={detail} nodeLabels={nodeLabels} />;
}
