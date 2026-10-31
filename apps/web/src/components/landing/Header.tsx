"use client";

import Link from "next/link";
import { NoriLogo } from "@/components/Logo";
import { cx } from "@/components/cx";
import { usePageProgress } from "./motion";

const SECTIONS = [["#story", "See it work"], ["#honest", "Why trust it"], ["#anywhere", "Talk to it"]] as const;

/**
 * Top bar: clear over the hero, frosted rice paper once the page moves. Along its bottom edge a vine grows with the
 * scroll, a leaf at its tip.
 */
export function Header() {
  const p = usePageProgress();
  const solid = p > 0.01;
  return (
    <header className={cx("fixed inset-x-0 top-0 z-50 transition-[background-color,box-shadow,backdrop-filter] duration-300", solid ? "bg-[color-mix(in_srgb,var(--rice)_82%,transparent)] shadow-[0_1px_0_var(--rice-line)] backdrop-blur-md" : "bg-transparent")}>
      <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <Link href="/" aria-label="Nori home" className="group shrink-0 rounded-control">
          <span className="inline-block transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-105"><NoriLogo size={30} /></span>
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1">
          {SECTIONS.map(([href, label]) => (
            <a key={href} href={href} className="hidden rounded-full px-3.5 py-2 text-[14px] font-medium text-ink-2 transition-colors hover:bg-[var(--rice-2)] hover:text-ink md:inline-flex">{label}</a>
          ))}
          <Link href="/login" className="rounded-full px-3.5 py-2 text-[14px] font-medium text-ink-2 transition-colors hover:bg-[var(--rice-2)] hover:text-ink">Sign in</Link>
          <Link href="/signup" className="ml-1 inline-flex h-10 items-center rounded-full bg-[var(--nori)] px-4 text-[14px] font-semibold text-[var(--rice)] transition-[transform,background-color] duration-200 hover:-translate-y-px hover:bg-[var(--nori-deep)]">
            Create account
          </Link>
        </nav>
      </div>
      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[3px]">
        <div className="relative h-full bg-gradient-to-r from-[var(--sprout-2)] to-[var(--sprout)]" style={{ width: `${p * 100}%` }}>
          {p > 0.01 && (
            <svg viewBox="0 0 14 10" width="14" height="10" className="absolute -right-2 -top-[7px]">
              <path d="M1 9C2 3 7 0 13 1C12 7 7 10 1 9Z" fill="#22c58b" />
              <path d="M1 9C5 6 8 4 12 2" stroke="#0e5d43" strokeWidth=".8" fill="none" opacity=".6" />
            </svg>
          )}
        </div>
      </div>
    </header>
  );
}
