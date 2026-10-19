import { desc, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agentEvents, type AgentEventKind } from "../db/schema.js";

export type AgentEvent = typeof agentEvents.$inferSelect;

export type AgentEventInput = {
  userId: string;
  kind: AgentEventKind;
  message: string;
  applicationId?: string | null;
  jobId?: string | null;
  data?: Record<string, unknown>;
};

/** Append one entry to the agent's timeline. */
export async function logAgentEvent(db: Db, e: AgentEventInput): Promise<AgentEvent> {
  const [row] = await db.insert(agentEvents).values({
    userId: e.userId, kind: e.kind, message: e.message,
    applicationId: e.applicationId ?? null, jobId: e.jobId ?? null, data: e.data ?? {},
  }).returning();
  return row;
}

/** The agent timeline, newest first. */
export async function getActivity(db: Db, userId: string, opts: { limit?: number } = {}): Promise<AgentEvent[]> {
  return db.select().from(agentEvents).where(eq(agentEvents.userId, userId))
    .orderBy(desc(agentEvents.ts)).limit(Math.min(Math.max(opts.limit ?? 50, 1), 500));
}
