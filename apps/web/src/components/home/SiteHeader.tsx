import Link from "next/link";
import { NoriLogo } from "@/components/Logo";
import { cx } from "@/components/cx";
import { btnPrimary, container } from "./styles";

const SECTIONS = [["#loop", "How it works"], ["#honest", "Why trust it"], ["#yours", "Run it yourself"]] as const;
const navLink = "rounded-full px-3.5 py-1.5 text-[14px] font-medium text-ink-2 transition-colors hover:bg-sunken/80 hover:text-ink";

/** Floating sunlit glass pill header on the public pages. */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 pt-3">
      <div className={container}>
        <div className="flex h-15 items-center justify-between gap-3 rounded-2xl border border-line/90 bg-surface/85 px-4 shadow-[0_6px_24px_-8px_rgba(19,28,24,0.07)] backdrop-blur-md sm:px-5">
          <Link href="/" aria-label="Nori home" className="shrink-0 rounded-control">
            <NoriLogo size={30} />
          </Link>
          <nav aria-label="Main" className="flex items-center gap-1">
            {SECTIONS.map(([href, label]) => (
              <a key={href} href={href} className={cx(navLink, "hidden md:inline-flex")}>{label}</a>
            ))}
            <Link href="/login" className={navLink}>Sign in</Link>
            <Link href="/signup" className={cx(btnPrimary, "ml-1.5 h-10 rounded-full px-4.5 text-[13.5px]")}>Create account</Link>
          </nav>
        </div>
      </div>
    </header>
  );
}
