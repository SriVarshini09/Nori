import { EventEmitter } from "node:events";
import type { Db } from "../db/client.js";
import { runEvents } from "../db/schema.js";
import type { RunEvent } from "../contracts.js";

/** A stored run event as streamed to clients: the RunEvent contract plus row id and timestamp. */
export type RunEventRow = RunEvent & { id: string; ts: string; level: "info" | "warn" | "error"; data: Record<string, unknown> };

/**
 * In-process bus. Every emitted event is published on "event" and on the application id, so the API
 * can stream one application's events over SSE. Cross-process consumers read run_events instead.
 */
export const runnerEvents = new EventEmitter();
runnerEvents.setMaxListeners(0);

export function toRunEvent(row: typeof runEvents.$inferSelect): RunEventRow {
  return {
    id: row.id, applicationId: row.applicationId, ts: new Date(row.ts).toISOString(),
    step: row.step, message: row.message, level: row.level, data: row.data ?? {},
  };
}

/** Append a run_events row and publish it in-process. Never throws (events must not break a run). */
export async function emit(
  db: Db, applicationId: string, step: string, message: string,
  data: Record<string, unknown> = {}, level: "info" | "warn" | "error" = "info",
): Promise<RunEventRow | null> {
  try {
    const [row] = await db.insert(runEvents).values({ applicationId, step, message, data, level }).returning();
    const ev = toRunEvent(row);
    runnerEvents.emit("event", ev);
    runnerEvents.emit(applicationId, ev);
    return ev;
  } catch (err) {
    console.warn(`[runner] emit failed for ${applicationId}:`, (err as Error).message);
    return null;
  }
}

/** Subscribe to one application's events. Returns an unsubscribe function. */
export function onRunEvent(applicationId: string, fn: (ev: RunEventRow) => void): () => void {
  runnerEvents.on(applicationId, fn);
  return () => { runnerEvents.off(applicationId, fn); };
}
