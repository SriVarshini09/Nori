import Link from "next/link";
import { MeadowBackdrop } from "@/components/landing/meadow";
import { NoriLogo } from "@/components/Logo";
import { PublicFooter } from "@/components/public/Chrome";

/** Signed-out chrome: the sunny meadow, wordmark top-left, the page owns the rest. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-clip text-[#3b2410]">
      <MeadowBackdrop />
      <header className="relative z-30 flex h-20 items-center px-4 sm:px-8 lg:px-10">
        <Link href="/" className="inline-flex items-center" aria-label="Nori home">
          <NoriLogo size={42} />
        </Link>
      </header>
      <main className="relative z-10 mx-auto flex w-full max-w-[1240px] flex-1 items-center px-4 pb-12 pt-2 sm:px-8 lg:px-10">{children}</main>
      <div className="relative z-10"><PublicFooter /></div>
    </div>
  );
}
