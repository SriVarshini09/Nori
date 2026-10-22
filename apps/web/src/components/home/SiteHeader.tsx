import Link from "next/link";
import { NoriLogo } from "@/components/Logo";
import { cx } from "@/components/cx";
import { btnPrimary, container } from "./styles";

const SECTIONS = [["#how", "How it works"], ["#promise", "Why trust it"], ["#studio", "Resume studio"]] as const;
const navLink =
  "rounded-lg px-3 py-2 text-[14px] font-medium text-bark-2 transition-colors hover:text-bark " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-sun";

/** Top bar of the landing page: logo, section links (wide screens), sign in, get started. */
export function SiteHeader() {
  return (
    <header className="border-b border-rule bg-cream">
      <div className={cx(container, "flex h-16 items-center justify-between gap-3")}>
        <Link href="/" aria-label="Nori home" className="shrink-0 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-sun">
          <NoriLogo size={32} />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1">
          {SECTIONS.map(([href, label]) => (
            <a key={href} href={href} className={cx(navLink, "hidden md:inline-flex")}>{label}</a>
          ))}
          <Link href="/login" className={navLink}>Sign in</Link>
          <Link href="/signup" className={cx(btnPrimary, "ml-1 h-10 px-4 text-[14px]")}>Get started</Link>
        </nav>
      </div>
    </header>
  );
}
