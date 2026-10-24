import * as Sentry from "@sentry/nextjs";

/** Next loads this once per runtime; it pulls in the matching Sentry config. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("../sentry.server.config");
  if (process.env.NEXT_RUNTIME === "edge") await import("../sentry.edge.config");
}

/** Errors thrown while rendering a request on the server. */
export const onRequestError = Sentry.captureRequestError;
