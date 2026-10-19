import Link from "next/link";

/** Signed-out chrome: wordmark top-left, one centered frame. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 items-center border-b border-line px-4 sm:px-8">
        <Link href="/login" className="inline-flex items-center gap-2" aria-label="Nori">
          <span aria-hidden="true" className="relative block h-3 w-3 bg-ink">
            <span className="absolute bottom-0 right-0 h-1 w-1 bg-accent" />
          </span>
          <span className="font-display text-[17px] font-semibold tracking-[-0.04em] text-ink">Nori</span>
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-16 sm:px-8">{children}</main>
    </div>
  );
}
