"use client";

import Link from "next/link";
import { useRef } from "react";
import { ArrowRight, Code2, Download, Lock, Sparkles, type LucideIcon } from "lucide-react";
import { REPO_URL } from "@/components/public/Chrome";
import { Meadow, MeadowFront } from "./Meadow";
import { useInView } from "./motion";

const YOURS: { icon: LucideIcon; title: string; line: string }[] = [
  { icon: Sparkles, title: "Nothing to configure", line: "The model is part of Nori, with a daily allowance. No keys to paste. Self-host it and it runs on a local model instead." },
  { icon: Lock, title: "Careful by design", line: "It never creates accounts, never types a password and never solves a CAPTCHA. It fills, then it waits for you." },
  { icon: Download, title: "Your graph is yours", line: "Export it as a file any time. Delete your account and everything goes with it." },
  { icon: Code2, title: "Open source", line: "Read every line it runs, or run all of it yourself." },
];

/** Four promises, then the meadow at dusk. */
export function Yours() {
  return (
    <section aria-labelledby="yours-title" className="relative">
      <div className="mx-auto w-full max-w-[1200px] px-4 pb-24 pt-4 sm:px-6 lg:px-8">
        <h2 id="yours-title" className="max-w-[22ch] text-[2rem] font-semibold leading-[1.08] tracking-[-0.03em] text-ink sm:text-[2.6rem]">
          Built to be trusted with <span className="font-serif-display italic text-[var(--nori)]">your name</span> on it.
        </h2>
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {YOURS.map((y) => (
            <li key={y.title} className="ln-lift rounded-[20px] border border-[var(--rice-line)] bg-white p-5">
              <span className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-[linear-gradient(135deg,#e9fbd0,#d3f4e6)] text-[var(--nori)]"><y.icon size={20} aria-hidden="true" /></span>
              <p className="mt-4 text-[16.5px] font-semibold text-ink">{y.title}</p>
              <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-2">{y.line}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** The meadow again, at dusk: the day's work done, fireflies over the daisies. */
export function Finale() {
  const sprout = useRef<SVGSVGElement>(null);
  const on = useInView(sprout);
  return (
    <section aria-labelledby="final-title" className="relative px-2 pb-2 pt-8 sm:px-3 sm:pb-3">
      <div className="relative isolate overflow-hidden rounded-[26px] text-[var(--rice)] sm:rounded-[36px]">
        <Meadow variant="dusk" className="-z-10" />
        <div className="relative mx-auto flex min-h-[640px] w-full max-w-[1200px] flex-col items-center px-4 pb-[34vh] pt-20 text-center sm:min-h-[760px] sm:px-6 lg:px-8">
          <svg ref={sprout} viewBox="0 0 120 110" width="96" height="88" className="ln-unfurl" data-on={on} aria-hidden="true">
            <path d="M60 108V50" stroke="#fff3df" strokeWidth="5" strokeLinecap="round" fill="none" />
            <path className="ln-unfurl-leaf l" d="M60 54C48 30 22 26 10 36C22 56 46 60 60 54Z" fill="#dcec98" />
            <path className="ln-unfurl-leaf r" d="M60 46C70 18 98 10 112 22C102 46 76 54 60 46Z" fill="#f5bd4c" />
          </svg>
          <h2 id="final-title" className="mt-4 max-w-[18ch] text-[2.5rem] font-semibold leading-[1.02] tracking-[-0.035em] drop-shadow-[0_2px_18px_rgba(40,20,60,0.35)] sm:text-[4rem]">
            Give Nori your resume. <span className="font-serif-display italic text-[#ffd98a]">Keep the final say.</span>
          </h2>
          <p className="mt-5 max-w-[46ch] text-[17px] leading-relaxed text-[var(--rice)]/85">
            About ten minutes to set up. Nothing is sent until you say so, and you can stop it with one tap.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link href="/signup" className="group inline-flex items-center gap-2 rounded-full bg-[var(--sun)] py-3.5 pl-6 pr-5 text-[15.5px] font-semibold text-[#2a1d0c] shadow-[0_14px_40px_-12px_rgba(245,189,76,0.75)] transition-[transform,box-shadow] duration-300 hover:-translate-y-0.5 hover:shadow-[0_20px_44px_-12px_rgba(245,189,76,0.9)]">
              Start with your resume
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#2a1d0c] text-[var(--sun)] transition-transform duration-300 group-hover:translate-x-0.5"><ArrowRight size={16} aria-hidden="true" /></span>
            </Link>
            <Link href="/login" className="inline-flex items-center rounded-full border border-[var(--rice)]/40 bg-white/10 px-6 py-3.5 text-[15.5px] font-semibold text-[var(--rice)] backdrop-blur transition-colors hover:bg-white/20">
              Sign in
            </Link>
          </div>
        </div>
        <MeadowFront variant="dusk" className="z-20" />
      </div>

      <footer className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 pb-6 pt-6 text-[13px] text-muted sm:px-6 lg:px-8">
        <p>Nori, an open-source personal job agent.</p>
        <nav aria-label="Legal and project" className="flex flex-wrap gap-x-5 gap-y-2">
          <Link href="/privacy" className="inline-block py-2 underline-offset-4 hover:text-ink hover:underline">Privacy</Link>
          <Link href="/terms" className="inline-block py-2 underline-offset-4 hover:text-ink hover:underline">Terms</Link>
          {REPO_URL && <a href={REPO_URL} target="_blank" rel="noreferrer" className="inline-block py-2 underline-offset-4 hover:text-ink hover:underline">Source code</a>}
        </nav>
      </footer>
    </section>
  );
}
