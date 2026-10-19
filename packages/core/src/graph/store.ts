import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { graphNodes, graphEdges, type NodeType, type EdgeType } from "../db/schema.js";

export type NodeSpec = {
  type: NodeType;
  label: string;
  props?: Record<string, unknown>;
  startDate?: string | null;
  endDate?: string | null;
  source?: string;
  sourceQuote?: string | null;
};

const key = (type: string, label: string) => `${type}|${label.trim().toLowerCase()}`;

/**
 * Dedupe-aware writer for one user's graph. Nodes match on (type, lowercased label); edges on (src, dst, type).
 * Existing rows are loaded once, so re-ingesting reuses them instead of creating duplicates.
 */
export class GraphWriter {
  nodesCreated = 0;
  edgesCreated = 0;
  private nodes = new Map<string, string>();
  private edges = new Set<string>();

  private constructor(private db: Db, private userId: string) {}

  static async open(db: Db, userId: string): Promise<GraphWriter> {
    const w = new GraphWriter(db, userId);
    const rows = await db.select({ id: graphNodes.id, type: graphNodes.type, label: graphNodes.label }).from(graphNodes).where(eq(graphNodes.userId, userId));
    for (const r of rows) w.nodes.set(key(r.type, r.label), r.id);
    const es = await db.select({ src: graphEdges.src, dst: graphEdges.dst, type: graphEdges.type }).from(graphEdges).where(eq(graphEdges.userId, userId));
    for (const e of es) w.edges.add(`${e.src}|${e.dst}|${e.type}`);
    return w;
  }

  find(type: NodeType, label: string): string | undefined {
    return this.nodes.get(key(type, label));
  }

  /** Create the node, or return the existing one's id. */
  async node(spec: NodeSpec): Promise<{ id: string; created: boolean }> {
    const label = spec.label.trim();
    const existing = this.nodes.get(key(spec.type, label));
    if (existing) return { id: existing, created: false };
    const [row] = await this.db.insert(graphNodes).values({
      userId: this.userId, type: spec.type, label,
      props: spec.props ?? {}, startDate: spec.startDate ?? null, endDate: spec.endDate ?? null,
      source: spec.source ?? null, sourceQuote: spec.sourceQuote ?? null,
    }).returning();
    this.nodes.set(key(spec.type, label), row.id);
    this.nodesCreated++;
    return { id: row.id, created: true };
  }

  async edge(src: string, dst: string, type: EdgeType): Promise<boolean> {
    const k = `${src}|${dst}|${type}`;
    if (this.edges.has(k)) return false;
    const rows = await this.db.insert(graphEdges).values({ userId: this.userId, src, dst, type }).onConflictDoNothing().returning();
    this.edges.add(k);
    if (rows.length) { this.edgesCreated++; return true; }
    return false;
  }

  /** Merge props into an existing node (only keys that are absent or empty). */
  async fillProps(id: string, props: Record<string, unknown>, dates?: { startDate?: string | null; endDate?: string | null }) {
    const [row] = await this.db.select().from(graphNodes).where(and(eq(graphNodes.id, id), eq(graphNodes.userId, this.userId)));
    if (!row) return;
    const merged: Record<string, unknown> = { ...row.props };
    let changed = false;
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === "") continue;
      if (merged[k] == null || merged[k] === "") { merged[k] = v; changed = true; }
    }
    const patch: Partial<typeof graphNodes.$inferInsert> = {};
    if (changed) patch.props = merged;
    if (dates?.startDate && !row.startDate) patch.startDate = dates.startDate;
    if (dates?.endDate && !row.endDate) patch.endDate = dates.endDate;
    if (Object.keys(patch).length) await this.db.update(graphNodes).set(patch).where(eq(graphNodes.id, id));
  }
}
