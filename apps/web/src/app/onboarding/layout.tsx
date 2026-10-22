import Link from "next/link";
import { NoriLogo } from "@/components/Logo";
import { LogoutButton } from "@/components/LogoutButton";

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="ob-bg ob-dots relative min-h-screen overflow-clip text-white">
      <span aria-hidden="true" className="dash-blob -left-24 top-1/3 h-96 w-96 bg-emerald-400/30" />
      <span aria-hidden="true" className="dash-blob -right-24 -top-16 h-[26rem] w-[26rem] bg-fuchsia-500/30" style={{ animationDelay: "-7s" }} />
      <span aria-hidden="true" className="dash-blob bottom-0 left-1/2 h-80 w-80 bg-amber-400/20" style={{ animationDelay: "-12s" }} />
      <header className="relative z-30 flex h-16 items-center justify-between px-4 sm:px-8 lg:px-10">
        <Link href="/dashboard" className="inline-flex items-center" aria-label="Nori">
          <NoriLogo size={38} tone="light" />
        </Link>
        <LogoutButton className="!text-white/70 hover:!text-white" />
      </header>
      <main className="relative z-10 mx-auto w-full max-w-[1240px] px-4 pb-20 pt-2 sm:px-8 lg:px-10 lg:pt-4">{children}</main>
    </div>
  );
}
