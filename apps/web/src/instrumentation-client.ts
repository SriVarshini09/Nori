import * as Sentry from "@sentry/nextjs";

/**
 * Browser-side error reporting. Active only when NEXT_PUBLIC_SENTRY_DSN is set at build time; otherwise a no-op.
 * Events go through this app's own /monitoring route (see next.config.ts), so the page's connect-src stays 'self'.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV,
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
