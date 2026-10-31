"use client";

import Link from "next/link";
import { useRef } from "react";
import { ArrowRight, Code2, Download, Lock, Sparkles, type LucideIcon } from "lucide-react";
import { REPO_URL } from "@/components/public/Chrome";
import { useInView } from "./motion";

const YOURS: { icon: LucideIcon; title: string; line: string }[] = [
  { icon: Sparkles, title: "Nothing to configure", line: "The model is part of Nori, with a daily allowance. No keys to paste. Self-host it and it runs on a local model instead." },
  { icon: Lock, title: "Careful by design", line: "It never creates accounts, never types a password and never solves a CAPTCHA. It fills, then it waits for you." },
  { icon: Download, title: "Your graph is yours", line: "Export it as a file any time. Delete your account and everything goes with it." },
  { icon: Code2, title: "Open source", line: "Read every line it runs, or run all of it yourself." },
];

/** Four promises, then the seaweed wrap. */
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

/** Rice grains drifting up through the seaweed: fixed positions, so server and browser agree. */
const GRAINS = Array.from({ length: 22 }, (_, i) => ({
  left: `${(i * 37 + 11) % 100}%`,
  top: `${55 + ((i * 53) % 40)}%`,
  d: `${-((i * 1.7) % 14)}s`,
  r: `${(i * 47) % 180}deg`,
  o: (0.25 + ((i * 13) % 50) / 100).toFixed(2),
}));

export function Finale() {
  const sprout = useRef<SVGSVGElement>(null);
  const on = useInView(sprout);
  return (
    <section aria-labelledby="final-title" className="relative isolate mt-8 text-[var(--rice)]">
      {/* the wrap's edge is the logo's own curve, with its thin bright seam */}
      <svg aria-hidden="true" viewBox="0 0 1440 120" preserveAspectRatio="none" className="block h-[70px] w-full sm:h-[110px]">
        <defs>
          <linearGradient id="ln-wrap" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#17896a" /><stop offset="1" stopColor="#0b3f31" /></linearGradient>
        </defs>
        <path d="M0 120V96C450 8 990 8 1440 96V120Z" fill="url(#ln-wrap)" />
        <path d="M0 96C450 8 990 8 1440 96" fill="none" stroke="#5be8b0" strokeOpacity=".55" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="relative -mt-px overflow-hidden bg-[linear-gradient(180deg,#0f4a3a_0%,var(--nori)_35%,var(--nori-deep)_100%)]">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          {GRAINS.map((g, i) => (
            <span key={i} className="ln-grain-rice" style={{ left: g.left, top: g.top, ["--d" as string]: g.d, ["--r" as string]: g.r, ["--o" as string]: g.o }} />
          ))}
          <div className="absolute left-1/2 top-0 h-[420px] w-[720px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(196,242,106,0.18),transparent)] blur-2xl" />
        </div>

        <div className="relative mx-auto flex w-full max-w-[1200px] flex-col items-center px-4 pb-10 pt-6 text-center sm:px-6 lg:px-8">
          <svg ref={sprout} viewBox="0 0 120 110" width="120" height="110" className="ln-unfurl" data-on={on} aria-hidden="true">
            <path d="M60 108V50" stroke="#5be8b0" strokeWidth="5" strokeLinecap="round" fill="none" />
            <path className="ln-unfurl-leaf l" d="M60 54C48 30 22 26 10 36C22 56 46 60 60 54Z" fill="#22c58b" />
            <path className="ln-unfurl-leaf r" d="M60 46C70 18 98 10 112 22C102 46 76 54 60 46Z" fill="#c4f26a" />
          </svg>
          <h2 id="final-title" className="mt-4 max-w-[18ch] text-[2.5rem] font-semibold leading-[1.02] tracking-[-0.035em] sm:text-[4rem]">
            Give Nori your resume. <span className="font-serif-display italic text-[var(--sprout)]">Keep the final say.</span>
          </h2>
          <p className="mt-5 max-w-[46ch] text-[17px] leading-relaxed text-[var(--rice)]/75">
            About ten minutes to set up. Nothing is sent until you say so, and you can stop it with one tap.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link href="/signup" className="group inline-flex items-center gap-2 rounded-full bg-[var(--sprout)] py-3.5 pl-6 pr-5 text-[15.5px] font-semibold text-[var(--nori)] shadow-[0_14px_40px_-14px_rgba(196,242,106,0.7)] transition-[transform,box-shadow] duration-300 hover:-translate-y-0.5 hover:shadow-[0_20px_44px_-14px_rgba(196,242,106,0.85)]">
              Start with your resume
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--nori)] text-[var(--sprout)] transition-transform duration-300 group-hover:translate-x-0.5"><ArrowRight size={16} aria-hidden="true" /></span>
            </Link>
            <Link href="/login" className="inline-flex items-center rounded-full border border-[var(--rice)]/30 px-6 py-3.5 text-[15.5px] font-semibold text-[var(--rice)] transition-colors hover:bg-[var(--rice)]/10">
              Sign in
            </Link>
          </div>

          <footer className="mt-24 flex w-full flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-[var(--rice)]/15 pt-6 text-[13px] text-[var(--rice)]/65">
            <p>Nori, an open-source personal job agent.</p>
            <nav aria-label="Legal and project" className="flex flex-wrap gap-x-5 gap-y-2">
              <Link href="/privacy" className="underline-offset-4 hover:text-[var(--rice)] hover:underline">Privacy</Link>
              <Link href="/terms" className="underline-offset-4 hover:text-[var(--rice)] hover:underline">Terms</Link>
              {REPO_URL && <a href={REPO_URL} target="_blank" rel="noreferrer" className="underline-offset-4 hover:text-[var(--rice)] hover:underline">Source code</a>}
            </nav>
          </footer>
        </div>
      </div>
    </section>
  );
}
