import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { graphNodes } from "../db/schema.js";

/**
 * Taking claims back. Ingestion only ever adds, so a corrected resume (a fixed number, a removed role) left the old
 * facts in the graph, still used as evidence for tailoring and answers. Edges go with their nodes (ON DELETE CASCADE).
 */

/** Delete one node the user owns. False when it does not exist or is someone else's. */
export async function deleteGraphNode(db: Db, userId: string, nodeId: string): Promise<boolean> {
  const gone = await db.delete(graphNodes).where(and(eq(graphNodes.id, nodeId), eq(graphNodes.userId, userId))).returning();
  return gone.length > 0;
}

/** Forget everything earlier resumes said, before ingesting a new one. Facts added in chat or by hand stay. */
export async function clearResumeNodes(db: Db, userId: string): Promise<number> {
  const gone = await db.delete(graphNodes).where(and(eq(graphNodes.userId, userId), eq(graphNodes.source, "resume"))).returning();
  return gone.length;
}
