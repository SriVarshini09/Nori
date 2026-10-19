import type { Metadata } from "next";
import { api } from "@/lib/api";
import { ExportGraphButton } from "@/components/ExportGraphButton";
import { GraphInputs, GraphView } from "@/components/GraphView";
import { PageHeader, SectionHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Career graph" };

export default async function GraphPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const node = Array.isArray(sp.node) ? sp.node[0] : sp.node;
  const graph = await api.graph();
  return (
    <div>
      <PageHeader
        label="Career graph"
        title={<>Everything the<br />agent knows.</>}
        subtitle="Every resume line traces back to a node here."
        actions={<ExportGraphButton />}
      />
      <section aria-label="Graph">
        <GraphView key={node ?? "none"} graph={graph} focus={node} />
      </section>
      <section id="teach" className="mt-20 scroll-mt-20 sm:mt-24">
        <SectionHeader index="02" label="Teach" size="md" title={<>Add a fact, or<br />paste a resume.</>} />
        <div className="mt-8"><GraphInputs /></div>
      </section>
    </div>
  );
}
