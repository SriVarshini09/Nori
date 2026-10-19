import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { graphEdges, graphNodes, users } from "../db/schema.js";
import { getProfile } from "../users.js";

/**
 * Everything the user owns in the career graph, as one JSON document: nodes, edges, and the profile.
 * Never includes the password hash or model credentials (those live in other tables and are not read here).
 */
export async function exportGraph(db: Db, userId: string) {
  const [user] = await db.select({ id: users.id, email: users.email, name: users.name, createdAt: users.createdAt }).from(users).where(eq(users.id, userId)).limit(1);
  const profile = await getProfile(db, userId);
  const nodes = await db.select().from(graphNodes).where(eq(graphNodes.userId, userId)).orderBy(graphNodes.createdAt);
  const edges = await db.select().from(graphEdges).where(eq(graphEdges.userId, userId));
  return {
    format: "jobgraph.graph.v1",
    exportedAt: new Date().toISOString(),
    user: user ?? null,
    profile,
    nodes,
    edges,
  };
}
