import Link from "next/link";
import { NoriLogo } from "@/components/Logo";
import { LogoutButton } from "@/components/LogoutButton";
import { SaveLaterButton } from "@/components/onboarding/SaveLaterButton";

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg text-ink">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-ink focus:px-3 focus:py-2 focus:text-on-ink">Skip to content</a>
      <header className="border-b border-line">
        <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between gap-3 px-4 sm:px-8">
          <Link href="/dashboard" className="inline-flex items-center rounded-control" aria-label="Nori">
            <NoriLogo size={30} />
          </Link>
          <div className="flex items-center gap-4">
            <SaveLaterButton />
            <LogoutButton />
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-[1200px] px-4 pb-20 pt-8 sm:px-8">{children}</main>
    </div>
  );
}
