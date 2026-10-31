"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowDown, ArrowRight, Check } from "lucide-react";
import { Doll } from "@/components/Doll";
import { Meadow, MeadowFront } from "./Meadow";

const LINE_1 = ["Applies", "for", "you."];
const LINE_2 = ["Stops", "before", "it"];

/** The opening: a daisy meadow at golden hour, the promise in the sky, Nori standing in the flowers. */
export function Hero() {
  const [cheer, setCheer] = useState(0);

  const hop = () => setCheer((c) => c + 1);

  return (
    <section aria-labelledby="hero-title" className="relative px-2 pt-2 sm:px-3 sm:pt-3">
      <div className="relative isolate overflow-hidden rounded-[26px] shadow-[0_30px_80px_-50px_rgba(60,60,20,0.6)] sm:rounded-[36px]">
        <Meadow variant="day" className="-z-10" />

        <div className="relative mx-auto flex min-h-[max(720px,calc(100svh-16px))] w-full max-w-[1240px] flex-col items-center px-5 pt-24 text-center sm:px-8 lg:px-10 lg:pt-[10vh]">
          <div className="relative z-30 flex flex-col items-center">
            {/* a soft breath of light behind the words, so they read on the sky */}
            <span aria-hidden="true" className="absolute -inset-x-16 -inset-y-10 -z-10 rounded-full bg-[radial-gradient(closest-side,rgba(255,252,240,0.5),rgba(255,248,230,0.18)_60%,transparent)] blur-xl" />
            <p className="ln-fade-up inline-flex items-center gap-2 rounded-full border border-white/60 bg-white/55 px-3 py-1.5 text-[12.5px] font-semibold text-[var(--sprout-ink)] backdrop-blur" style={{ ["--d" as string]: "0ms" }}>
              <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--sprout-2)] opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--sprout-2)]" /></span>
              Open source · the model is included
            </p>

            <h1 id="hero-title" className="mt-6 text-[2.3rem] font-semibold leading-[1.04] tracking-[-0.035em] text-[#1c2615] sm:text-[4.2rem] lg:text-[4.7rem]">
              <span className="block">{LINE_1.map((w, i) => <span key={w} className="ln-word mx-[0.11em]" style={{ ["--i" as string]: i }}>{w}</span>)}</span>
              <span className="block">
                {LINE_2.map((w, i) => <span key={w} className="ln-word mx-[0.11em]" style={{ ["--i" as string]: i + 3 }}>{w}</span>)}
                <span className="ln-word relative mx-[0.11em]" style={{ ["--i" as string]: 6 }}>
                  <span className="font-serif-display italic text-[var(--nori)]">sends.</span>
                  <svg aria-hidden="true" viewBox="0 0 220 24" preserveAspectRatio="none" className="ln-scribble absolute -bottom-[0.12em] left-0 h-[0.32em] w-full overflow-visible">
                    <path d="M4 15C46 6 96 4 146 9C172 11 196 14 216 10" fill="none" stroke="var(--attn)" strokeWidth="5" strokeLinecap="round" />
                  </svg>
                </span>
              </span>
            </h1>

            <p className="ln-fade-up mt-6 max-w-[50ch] text-[17px] leading-relaxed text-[#262118] sm:text-[18.5px]" style={{ ["--d" as string]: "650ms" }}>
              Nori turns your resume into facts it can cite, finds roles that fit, writes a one-page resume for each, fills the form, and then waits for your OK.
            </p>

            <div className="ln-fade-up mt-8 flex flex-wrap items-center justify-center gap-3" style={{ ["--d" as string]: "800ms" }}>
              <Link
                href="/signup"
                onPointerEnter={hop}
                onFocus={hop}
                className="group inline-flex items-center gap-2 rounded-full bg-[var(--nori)] py-3.5 pl-6 pr-5 text-[15.5px] font-semibold text-[var(--rice)] shadow-[0_14px_34px_-14px_rgba(30,50,20,0.8)] transition-[transform,background-color,box-shadow] duration-300 hover:-translate-y-0.5 hover:bg-[var(--nori-deep)]"
              >
                Start with your resume
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--sun)] text-[var(--nori)] transition-transform duration-300 group-hover:translate-x-0.5 group-hover:rotate-[-8deg]"><ArrowRight size={16} aria-hidden="true" /></span>
              </Link>
              <a href="#story" className="group inline-flex items-center gap-2 rounded-full border border-white/60 bg-white/45 px-5 py-3.5 text-[15.5px] font-semibold text-[#1c2615] backdrop-blur transition-colors hover:bg-white/70">
                Watch it work
                <ArrowDown size={16} aria-hidden="true" className="transition-transform duration-300 group-hover:translate-y-0.5" />
              </a>
            </div>

            <ul className="ln-fade-up mt-7 flex flex-wrap justify-center gap-x-6 gap-y-2.5 text-[14.5px] font-medium text-[#262118]" style={{ ["--d" as string]: "950ms" }}>
              {["Every line traces to a fact", "Nothing is sent without you", "Nothing to configure"].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/80 text-[var(--sprout-ink)]"><Check size={13} strokeWidth={3} aria-hidden="true" /></span>
                  {t}
                </li>
              ))}
            </ul>
          </div>

          {/* Nori, standing in the daisies */}
          <div className="ln-fade-up relative mt-auto aspect-[1.08] w-full max-w-[460px] sm:max-w-[500px] lg:absolute lg:bottom-0 lg:right-[1%] lg:w-[min(480px,31vw)]" style={{ ["--d" as string]: "300ms" }}>
            <div className="absolute inset-[4%_2%_0_0]">
              <Doll messages={["Hi! I'm Nori.", "I turn your resume into facts.", "I only write what you did.", "And I stop before I send."]} cheer={cheer} />
            </div>
          </div>
        </div>

        <MeadowFront variant="day" className="z-20" />
      </div>

      <Sources />
    </section>
  );
}

const SOURCES = ["Greenhouse", "Lever", "Ashby", "SmartRecruiters", "Hacker News hiring", "Wellfound", "Y Combinator", "X", "LinkedIn job pages"];

/** Where Nori looks, as a slow ribbon. */
function Sources() {
  const row = [...SOURCES, ...SOURCES];
  return (
    <div className="relative mx-auto w-full max-w-[1200px] px-4 pb-6 pt-10 sm:px-6 lg:px-8">
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-6">
        <p className="shrink-0 text-[13px] font-semibold text-muted">Finds roles on</p>
        <div className="ln-marquee w-full overflow-hidden" aria-label={`Sources: ${SOURCES.join(", ")}`}>
          <ul className="ln-marquee-track gap-10 py-1" aria-hidden="true">
            {row.map((s, i) => (
              <li key={`${s}-${i}`} className="flex items-center gap-10 whitespace-nowrap text-[17px] font-semibold tracking-[-0.01em] text-[#8a8174]">
                {s}
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--sun)]" />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
