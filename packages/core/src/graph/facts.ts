import { z } from "zod";
import type { Db } from "../db/client.js";
import { NODE_TYPES, EDGE_TYPES, type NodeType, type EdgeType } from "../db/schema.js";
import type { GraphNodeRef } from "../contracts.js";
import { getLLM, withFallback } from "../llm/index.js";
import { findSkills, normalizeSkill } from "./skills.js";
import { extractQuantity, normalizeDate, isPresent } from "./metrics.js";
import { GraphWriter } from "./store.js";
import { getGraph } from "./query.js";

const nstr = z.string().nullish();

const FactSchema = z.object({
  summary: z.string(),
  nodes: z.array(z.object({
    /** Local handle other edges can point at. */
    ref: z.string(),
    type: z.enum(NODE_TYPES),
    label: z.string(),
    /** metric: the achievement as one sentence. */
    statement: nstr,
    value: z.union([z.string(), z.number()]).nullish(),
    unit: nstr,
    start: nstr,
    end: nstr,
  })),
  edges: z.array(z.object({
    /** A ref from nodes, or the exact label of an existing role/project/company/skill. */
    src: z.string(),
    dst: z.string(),
    type: z.enum(EDGE_TYPES),
  })),
});
type Fact = z.infer<typeof FactSchema>;

const SYSTEM = `You turn one sentence a job seeker says about their career into career-graph nodes and edges.
Node types: role, company, project, skill, tool, metric, education, certification, award.
Edges (src -> dst): worked_at role->company, part_of project->role, used role|project->skill|tool, achieved role|project->metric, studied_at education->company, earned role|education->certification|award.
Rules: a metric node's statement is the user's sentence, verbatim; value/unit capture its main number. Attach it with "achieved" to the role or project it happened in, reusing an existing label from the context when the user's words match one. Create a new role or company only if the user clearly names one that is not in the context. Never invent facts.`;

const str = (v: string | null | undefined) => (v ?? "").replace(/\s+/g, " ").trim();

function metricProps(text: string, order: number, extra?: { value?: string | null; unit?: string | null }) {
  const q = extra?.value ? { value: extra.value, unit: extra.unit ?? "" } : extractQuantity(text);
  return { statement: text, value: q?.value ?? null, unit: q?.unit || null, hasNumber: !!q, skills: findSkills(text), order, metrics: [{ statement: text, value: q?.value ?? null, unit: q?.unit || null }] };
}

function newestFirst(a: GraphNodeRef, b: GraphNodeRef): number {
  const ea = a.endDate ?? "9999-12", eb = b.endDate ?? "9999-12";
  if (ea !== eb) return ea < eb ? 1 : -1;
  const sa = a.startDate ?? "", sb = b.startDate ?? "";
  return sa < sb ? 1 : sa > sb ? -1 : 0;
}

/**
 * Conversational intake: turn one sentence ("I led a migration that cut costs 30% at Acme last year")
 * into graph nodes. Returns how many nodes were created and a short confirmation for the user.
 */
export async function addFact(db: Db, userId: string, text: string): Promise<{ nodesCreated: number; summary: string }> {
  const fact = text.replace(/\s+/g, " ").trim();
  if (!fact) return { nodesCreated: 0, summary: "Nothing to add." };

  const graph = await getGraph(db, userId);
  const w = await GraphWriter.open(db, userId);

  const { value } = await withFallback<{ summary: string } | null>(
    async () => {
      const ctx = graph.nodes.filter((n) => ["role", "company", "project"].includes(n.type)).map((n) => `${n.type}: ${n.label}`).join("\n");
      const res = await getLLM().json({ name: "extract_fact", system: SYSTEM, prompt: `Existing context:\n${ctx || "(empty)"}\n\nUser says: ${fact}`, schema: FactSchema, maxTokens: 2000, effort: "low" });
      if (!res.nodes.length) throw new Error("no nodes extracted");
      return applyLLMFact(w, graph.nodes, graph.edges, res, fact);
    },
    () => null,
    "addFact",
  );
  if (value) return { nodesCreated: w.nodesCreated, summary: value.summary };

  // ----- heuristic path -----
  const roles = graph.nodes.filter((n) => n.type === "role").sort(newestFirst);
  const lower = fact.toLowerCase();
  const byCompany = roles.find((r) => {
    const company = str(r.props.company as string | undefined).toLowerCase();
    return company.length >= 2 && lower.includes(company);
  });
  let owner: { id: string; label: string; created: boolean };
  const target = byCompany ?? roles[0];
  if (target) {
    owner = { id: target.id, label: target.label, created: false };
  } else {
    const name = fact.length <= 80 ? fact : `${fact.slice(0, 80).replace(/\s+\S*$/, "")}...`;
    const proj = await w.node({ type: "project", label: name, props: { description: fact }, source: "chat", sourceQuote: fact });
    owner = { id: proj.id, label: name, created: proj.created };
  }

  const order = graph.edges.filter((e) => e.src === owner.id && e.type === "achieved").length;
  const metric = await w.node({ type: "metric", label: fact, props: metricProps(fact, order), source: "chat", sourceQuote: fact });
  await w.edge(owner.id, metric.id, "achieved");
  for (const s of findSkills(fact)) {
    const sk = await w.node({ type: "skill", label: s, source: "chat", sourceQuote: fact });
    await w.edge(owner.id, sk.id, "used");
  }

  const snippet = fact.length > 90 ? `${fact.slice(0, 87)}...` : fact;
  const summary = w.nodesCreated === 0
    ? `That is already in your graph: "${snippet}"`
    : `Added to ${owner.label}: "${snippet}"`;
  return { nodesCreated: w.nodesCreated, summary };
}

async function applyLLMFact(
  w: GraphWriter, existing: GraphNodeRef[], existingEdges: { src: string; dst: string; type: string }[], res: Fact, fact: string,
): Promise<{ summary: string }> {
  const rank: Record<string, number> = { role: 0, project: 1, company: 2, skill: 3, tool: 4, education: 5 };
  const byLabel = new Map<string, string>();
  for (const n of [...existing].sort((a, b) => (rank[b.type] ?? 9) - (rank[a.type] ?? 9))) byLabel.set(n.label.toLowerCase(), n.id);

  const refs = new Map<string, string>();
  const created: string[] = [];
  for (const n of res.nodes) {
    const label = str(n.type === "metric" ? n.statement || n.label : n.label);
    if (!label) continue;
    const type = n.type as NodeType;
    let props: Record<string, unknown> = {};
    if (type === "metric") {
      const owner = res.edges.find((e) => e.dst === n.ref && e.type === "achieved");
      const ownerId = owner ? refs.get(owner.src) ?? byLabel.get(owner.src.toLowerCase()) : undefined;
      const order = ownerId ? existingEdges.filter((e) => e.src === ownerId && e.type === "achieved").length : 0;
      props = metricProps(label, order, { value: n.value == null ? null : String(n.value), unit: n.unit });
    } else if (type === "skill") {
      props = {};
    }
    const labelFinal = type === "skill" ? normalizeSkill(label) : label;
    const start = normalizeDate(n.start, "start");
    const end = isPresent(n.end) ? null : normalizeDate(n.end, "end");
    const r = await w.node({ type, label: labelFinal, props, startDate: start, endDate: end, source: "chat", sourceQuote: fact });
    refs.set(n.ref, r.id);
    if (r.created) created.push(`${type} "${labelFinal.length > 60 ? `${labelFinal.slice(0, 57)}...` : labelFinal}"`);
  }
  for (const e of res.edges) {
    const src = refs.get(e.src) ?? byLabel.get(e.src.toLowerCase());
    const dst = refs.get(e.dst) ?? byLabel.get(e.dst.toLowerCase());
    if (src && dst && src !== dst) await w.edge(src, dst, e.type as EdgeType);
  }
  return { summary: created.length ? `${str(res.summary) || "Added to your graph"}: ${created.join(", ")}` : `That is already in your graph. ${str(res.summary)}`.trim() };
}

