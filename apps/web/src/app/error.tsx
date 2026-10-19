"use client";

import { Button, Frame, IndexLabel } from "@/components/ui";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Frame className="max-w-2xl p-6 sm:p-8">
      <IndexLabel marker="accent" tone="ink">Error</IndexLabel>
      <h1 className="mt-5 font-display text-display-md font-medium text-ink">Something went wrong.</h1>
      <p className="mt-3 text-body-sm text-ink-2">{error.message || "Unexpected error."}</p>
      <p className="mt-2 text-meta text-muted">
        If the jobgraph API is not running, start apps/api on port 4000 or set NEXT_PUBLIC_USE_MOCK=1 in apps/web/.env.local.
      </p>
      <div className="mt-6 border-t border-line pt-5">
        <Button variant="primary" arrow onClick={reset}>Try again</Button>
      </div>
    </Frame>
  );
}
