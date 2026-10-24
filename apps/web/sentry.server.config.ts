import * as Sentry from "@sentry/nextjs";

/** Server-side (Node runtime) error reporting for the dashboard. No-op without NEXT_PUBLIC_SENTRY_DSN. */
const dsn = process.env.SENTRY_DSN_WEB || process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV,
    release: process.env.VERCEL_GIT_COMMIT_SHA || undefined,
    tracesSampleRate: 0,
  });
}
