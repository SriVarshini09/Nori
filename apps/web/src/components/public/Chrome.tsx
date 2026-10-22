import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The public source repository, or null. Links to it are shown only when NEXT_PUBLIC_REPO_URL is set: while the repo is
 * private every visitor got "page not found". Set it (for example https://github.com/SriVarshini09/Nori) once it is public.
 */
export const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL?.trim() || null;
export const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || null;

export function Wordmark({ light = false }: { light?: boolean }) {
  return (
    <Link href="/" className="inline-flex items-center gap-2.5" aria-label="Nori home">
      <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-[11px] bg-ink/90 ring-1 ring-black/10">
        <span className="h-3 w-3 rounded-full bg-gradient-to-br from-[#6ef0b3] to-[#ffb347]" />
      </span>
      <span className={`font-display text-[20px] font-semibold tracking-[-0.04em] ${light ? "text-white" : "text-ink"}`}>Nori</span>
    </Link>
  );
}

/** The signed-out chrome for the landing page and the legal pages. */
export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-paper text-ink">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-ink focus:px-3 focus:py-2 focus:text-paper">Skip to content</a>
      <header className="mx-auto flex h-16 w-full max-w-[1120px] items-center justify-between px-4 sm:px-8">
        <Wordmark />
        <nav aria-label="Account" className="flex items-center gap-2 text-[14px] font-medium">
          <Link href="/login" className="rounded-lg px-3 py-2 text-ink-2 transition-colors hover:text-ink">Sign in</Link>
          <Link href="/signup" className="dash-btn inline-flex h-10 items-center rounded-xl px-4 text-[14px] font-semibold">Get started</Link>
        </nav>
      </header>
      <main id="main" className="flex-1">{children}</main>
      <PublicFooter />
    </div>
  );
}

export function PublicFooter({ dark = false }: { dark?: boolean }) {
  const link = dark ? "text-white/70 hover:text-white" : "text-muted hover:text-ink";
  return (
    <footer className={`mx-auto w-full max-w-[1120px] px-4 py-8 text-[13px] sm:px-8 ${dark ? "text-white/60" : "text-muted"}`}>
      <div className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t pt-6 ${dark ? "border-white/15" : "border-line"}`}>
        <p>Nori, an open-source personal job agent.</p>
        <nav aria-label="Legal and project" className="flex flex-wrap gap-x-5 gap-y-2">
          <Link href="/privacy" className={`underline-offset-4 hover:underline ${link}`}>Privacy</Link>
          <Link href="/terms" className={`underline-offset-4 hover:underline ${link}`}>Terms</Link>
          {REPO_URL && <a href={REPO_URL} target="_blank" rel="noreferrer" className={`underline-offset-4 hover:underline ${link}`}>Source code</a>}
        </nav>
      </div>
    </footer>
  );
}

/** A long-form page: title, last-updated line, then sections with headings. */
export function Prose({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <article className="mx-auto w-full max-w-[720px] px-4 pb-16 pt-10 sm:px-8">
      <h1 className="font-display text-[2.4rem] font-medium leading-[1.02] tracking-[-0.04em] sm:text-[3rem]">{title}</h1>
      <p className="mt-3 text-[13px] text-muted">Last updated {updated}</p>
      <div className="mt-8 space-y-8 text-[15px] leading-relaxed text-ink-2 [&_a]:text-ink [&_a]:underline [&_a]:underline-offset-4 [&_h2]:mb-3 [&_h2]:font-display [&_h2]:text-[1.35rem] [&_h2]:font-medium [&_h2]:tracking-[-0.02em] [&_h2]:text-ink [&_li]:mt-1.5 [&_p+p]:mt-3 [&_ul]:list-disc [&_ul]:pl-5">
        {children}
      </div>
    </article>
  );
}
