import { Frame, IndexLabel, LinkButton } from "@/components/ui";

/** Shown when a page, application or job does not exist (or is not yours). */
export function NotFoundCard({ what = "page" }: { what?: string }) {
  return (
    <Frame className="max-w-2xl p-6 sm:p-8">
      <IndexLabel marker="outline" tone="ink">404</IndexLabel>
      <h1 className="mt-5 font-display text-display-md font-medium text-ink">That {what} does not exist.</h1>
      <p className="mt-3 text-body-sm text-ink-2">The link may be old, or the item was removed. Nothing is wrong with your account.</p>
      <div className="mt-6 flex flex-wrap gap-3 border-t border-line pt-5">
        <LinkButton href="/dashboard" variant="primary" arrow>Back to the dashboard</LinkButton>
        <LinkButton href="/applications" variant="secondary">Your applications</LinkButton>
      </div>
    </Frame>
  );
}
