import Link from "next/link";
import { LogoutButton } from "@/components/LogoutButton";

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-canvas px-4 sm:px-8 lg:px-10">
        <Link href="/dashboard" className="inline-flex items-center gap-2" aria-label="Nori">
          <span aria-hidden="true" className="relative block h-3 w-3 bg-ink">
            <span className="absolute bottom-0 right-0 h-1 w-1 bg-accent" />
          </span>
          <span className="font-display text-[17px] font-semibold tracking-[-0.04em] text-ink">Nori</span>
        </Link>
        <LogoutButton />
      </header>
      <main className="mx-auto w-full max-w-[var(--content-max)] px-4 pb-24 pt-10 sm:px-8 lg:px-10 lg:pt-16">{children}</main>
    </div>
  );
}
