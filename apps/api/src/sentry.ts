import * as Sentry from "@sentry/node";
import { runnerEvents, type RunEventRow } from "@jobgraph/core";

/**
 * Error reporting for the API and the embedded worker. Active only when SENTRY_DSN_API (or SENTRY_DSN) is set;
 * without it every helper here is a no-op, so development and tests never need an account.
 * Import this module right after the env loader so the SDK is up before anything can fail.
 */

const dsn = process.env.SENTRY_DSN_API || process.env.SENTRY_DSN || "";
let enabled = false;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
    // Fly sets FLY_IMAGE_REF per deploy (registry.fly.io/app:deployment-xxx). Sentry refuses release names with a
    // slash, so only the tag after the colon is used.
    release: process.env.SENTRY_RELEASE || process.env.FLY_IMAGE_REF?.split(":").pop() || undefined,
    tracesSampleRate: 0,
  });
  enabled = true;
}

export const sentryEnabled = () => enabled;

/** Report an unexpected error with a few plain tags. Never throws. */
export function captureError(err: unknown, context: { ref?: string; method?: string; path?: string; userId?: string; where?: string } = {}): void {
  if (!enabled) return;
  try {
    Sentry.withScope((scope) => {
      if (context.ref) scope.setTag("ref", context.ref);
      if (context.where) scope.setTag("where", context.where);
      if (context.method && context.path) scope.setTag("route", `${context.method} ${context.path}`);
      if (context.userId) scope.setUser({ id: context.userId });
      Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
    });
  } catch { /* reporting must never break a request */ }
}

/** The sink for failed runner steps; replaceable in tests. */
export type RunEventSink = (message: string, data: { applicationId: string; step: string; data: Record<string, unknown> }) => void;

const defaultSink: RunEventSink = (message, info) => {
  Sentry.withScope((scope) => {
    scope.setTag("where", "runner");
    scope.setTag("step", info.step);
    scope.setTag("applicationId", info.applicationId);
    scope.setContext("run", info.data);
    Sentry.captureMessage(message, "error");
  });
};

/** Forward error-level run events (a step that failed, a driver that gave up) so they show up as issues. */
export function reportRunEvent(ev: RunEventRow, sink: RunEventSink = defaultSink): void {
  if (ev.level !== "error") return;
  try { sink(`${ev.step}: ${ev.message}`, { applicationId: ev.applicationId, step: ev.step, data: ev.data }); } catch { /* never break the run */ }
}

let watching = false;
/** Subscribe to the in-process runner bus once. Does nothing without a DSN. */
export function watchRunner(sink?: RunEventSink): () => void {
  if (!enabled && !sink) return () => {};
  if (watching && !sink) return () => {};
  watching = !sink;
  const handler = (ev: RunEventRow) => reportRunEvent(ev, sink);
  runnerEvents.on("event", handler);
  return () => { runnerEvents.off("event", handler); if (!sink) watching = false; };
}

/** Send one message and wait for delivery; for a wiring check from a shell. */
export async function sentrySelfTest(): Promise<boolean> {
  if (!enabled) return false;
  Sentry.captureMessage("Nori API: Sentry wiring check", "info");
  return Sentry.flush(5000);
}
