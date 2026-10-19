import Link from "next/link";

/** Signed-out chrome: the same aurora backdrop as onboarding, wordmark top-left, the page owns the rest. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="ob-bg ob-dots relative flex min-h-screen flex-col overflow-clip text-white">
      <span aria-hidden="true" className="dash-blob -left-24 top-1/3 h-96 w-96 bg-emerald-400/30" />
      <span aria-hidden="true" className="dash-blob -right-24 -top-16 h-[26rem] w-[26rem] bg-fuchsia-500/30" style={{ animationDelay: "-7s" }} />
      <span aria-hidden="true" className="dash-blob bottom-0 left-1/2 h-80 w-80 bg-amber-400/20" style={{ animationDelay: "-12s" }} />
      <header className="relative z-30 flex h-16 items-center px-4 sm:px-8 lg:px-10">
        <Link href="/login" className="inline-flex items-center gap-2.5" aria-label="Nori">
          <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-[11px] bg-white/10 ring-1 ring-white/20 backdrop-blur">
            <span className="h-3 w-3 rounded-full bg-gradient-to-br from-[#6ef0b3] to-[#ffb347]" />
          </span>
          <span className="font-display text-[20px] font-semibold tracking-[-0.04em] text-white">Nori</span>
        </Link>
      </header>
      <main className="relative z-10 mx-auto flex w-full max-w-[1180px] flex-1 items-center px-4 pb-12 pt-2 sm:px-8 lg:px-10">{children}</main>
    </div>
  );
}
