import { NoriMark } from "@/components/Logo";
import { Frame, LinkButton } from "@/components/ui";

/** Shown when a page, application or job does not exist (or is not yours). */
export function NotFoundCard({ what = "page" }: { what?: string }) {
  return (
    <Frame className="mx-auto w-full max-w-2xl overflow-hidden p-6 text-center sm:p-10">
      <div className="relative mx-auto flex w-fit items-center justify-center">
        <span aria-hidden="true" className="absolute -inset-6 rounded-full bg-[radial-gradient(closest-side,rgba(15,154,114,0.22),transparent)]" />
        <span className="relative rotate-[8deg]"><NoriMark size={84} /></span>
      </div>
      <p className="mt-5 font-display text-[3.5rem] font-medium leading-none tracking-[-0.04em] text-ink sm:text-[4.5rem]">404</p>
      <h1 className="mt-3 font-display text-display-md font-medium text-ink">That {what} does not exist.</h1>
      <p className="mx-auto mt-3 max-w-md text-body-sm text-ink-2">Nori looked everywhere. The link may be old, or the item was removed. Nothing is wrong with your account.</p>
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <LinkButton href="/dashboard" variant="primary" arrow>Back to the dashboard</LinkButton>
        <LinkButton href="/applications" variant="secondary">Your applications</LinkButton>
      </div>
    </Frame>
  );
}
