"use client";

import Link from "next/link";
import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { NoriMark } from "@/components/Logo";
import { Button, Frame, buttonClass } from "@/components/ui";

const DEV = process.env.NODE_ENV !== "production";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("[nori] page error", error.digest ?? "", error.message); Sentry.captureException(error); }, [error]);
  return (
    <Frame className="mx-auto mt-6 max-w-2xl p-6 text-center sm:mt-16 sm:p-10">
      <span className="mx-auto flex w-fit rotate-[-6deg] opacity-90"><NoriMark size={72} /></span>
      <h1 className="mt-5 font-display text-display-md font-medium text-ink">That did not load.</h1>
      <p className="mx-auto mt-3 max-w-md text-body-sm text-ink-2" role="alert">
        {DEV && error.message ? error.message : "Nori could not reach the server just now. Your data is safe. Try again in a moment."}
      </p>
      {error.digest && <p className="mt-2 text-meta text-muted">Reference: {error.digest}</p>}
      {DEV && (
        <p className="mt-2 text-meta text-muted">
          If the API is not running, start apps/api on port 4000 or set NEXT_PUBLIC_USE_MOCK=1 in apps/web/.env.local.
        </p>
      )}
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <Button variant="primary" arrow onClick={reset}>Try again</Button>
        <Link href="/" className={buttonClass({ variant: "secondary" })}>Back to the start</Link>
      </div>
    </Frame>
  );
}
