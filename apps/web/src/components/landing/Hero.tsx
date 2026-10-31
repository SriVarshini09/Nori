"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowRight, Check } from "lucide-react";
import { Doll } from "@/components/Doll";
import { Constellation } from "./Constellation";

/**
 * Facts from a sample career graph, floating around Nori. Chips on the right are anchored to the right edge so they
 * never run off a narrow screen, and the `wide` ones wait for room (sm and up). x/y are where the tether starts, in %
 * of the stage; depth is px of parallax.
 */
const FACTS = [
  { label: "Brightline", kind: "Role", side: "l", x: 0, y: 10, depth: 18, d: "0s" },
  { label: "Checkout rewrite", kind: "Project", side: "r", x: 70, y: 6, depth: 26, d: "-1.5s" },
  { label: "−38% load time", kind: "Result", side: "r", x: 80, y: 44, depth: 34, d: "-3s", wide: true },
  { label: "React", kind: "Skill", side: "l", x: -3, y: 46, depth: 30, d: "-2.2s", wide: true },
  { label: "Design system · 6 teams", kind: "Result", side: "r", x: 66, y: 84, depth: 22, d: "-4s", wide: true },
  { label: "Mentored 4 engineers", kind: "Result", side: "l", x: 0, y: 86, depth: 14, d: "-0.8s", wide: true },
] as const;

const DOT: Record<string, string> = { Role: "bg-[var(--nori)]", Project: "bg-[var(--nori-mid)]", Result: "bg-[var(--sprout-2)]", Skill: "bg-[#8e877d]" };

const LINE_1 = ["Applies", "for", "you."];
const LINE_2 = ["Stops", "before", "it"];

export function Hero() {
  const stage = useRef<HTMLDivElement>(null);
  const [cheer, setCheer] = useState(0);

  // Parallax: the stage carries the pointer as --px/--py (-1..1); each chip moves by its own depth. No re-renders.
  useEffect(() => {
    const el = stage.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches || !window.matchMedia("(pointer: fine)").matches) return;
    let frame = 0, x = 0, y = 0;
    const apply = () => { frame = 0; el.style.setProperty("--px", x.toFixed(3)); el.style.setProperty("--py", y.toFixed(3)); };
    const onMove = (e: PointerEvent) => {
      x = (e.clientX / window.innerWidth) * 2 - 1;
      y = (e.clientY / window.innerHeight) * 2 - 1;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => { window.removeEventListener("pointermove", onMove); if (frame) cancelAnimationFrame(frame); };
  }, []);

  const hop = () => setCheer((c) => c + 1);

  return (
    <section aria-labelledby="hero-title" className="relative isolate overflow-hidden">
      {/* morning light: three slow blobs of sprout and mint over rice */}
      <div aria-hidden="true" className="absolute inset-0 -z-10">
        <div className="ln-blob ln-blob-a left-[-10%] top-[-10%] h-[520px] w-[520px] bg-[#d9f7b0]" />
        <div className="ln-blob ln-blob-b right-[-8%] top-[8%] h-[560px] w-[560px] bg-[#c9f1df]" />
        <div className="ln-blob ln-blob-c bottom-[-20%] left-[30%] h-[460px] w-[620px] bg-[#fbe8c4]" />
        <Constellation className="absolute inset-0 h-full w-full opacity-80" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-[var(--rice)]" />
      </div>

      <div className="mx-auto grid min-h-[100svh] w-full max-w-[1200px] items-center gap-6 px-4 pb-10 pt-24 sm:px-6 lg:grid-cols-[1.02fr_1fr] lg:gap-4 lg:px-8 lg:pt-20">
        <div className="relative z-10">
          <p className="ln-fade-up inline-flex items-center gap-2 rounded-full border border-[var(--rice-line)] bg-[color-mix(in_srgb,var(--rice)_70%,transparent)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--sprout-ink)] backdrop-blur" style={{ ["--d" as string]: "0ms" }}>
            <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--sprout-2)] opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--sprout-2)]" /></span>
            Open source · the model is included
          </p>

          <h1 id="hero-title" className="mt-6 text-[2.9rem] font-semibold leading-[1.02] tracking-[-0.035em] text-ink sm:text-[4.1rem] lg:text-[4.6rem]">
            <span className="block">{LINE_1.map((w, i) => <span key={w} className="ln-word mr-[0.22em]" style={{ ["--i" as string]: i }}>{w}</span>)}</span>
            <span className="block">
              {LINE_2.map((w, i) => <span key={w} className="ln-word mr-[0.22em]" style={{ ["--i" as string]: i + 3 }}>{w}</span>)}
              <span className="ln-word relative" style={{ ["--i" as string]: 6 }}>
                <span className="font-serif-display italic text-[var(--nori)]">sends.</span>
                <svg aria-hidden="true" viewBox="0 0 220 24" preserveAspectRatio="none" className="ln-scribble absolute -bottom-[0.12em] left-0 h-[0.32em] w-full overflow-visible">
                  <path d="M4 15C46 6 96 4 146 9C172 11 196 14 216 10" fill="none" stroke="var(--attn)" strokeWidth="5" strokeLinecap="round" />
                </svg>
              </span>
            </span>
          </h1>

          <p className="ln-fade-up mt-6 max-w-[46ch] text-[17px] leading-relaxed text-ink-2 sm:text-[18px]" style={{ ["--d" as string]: "650ms" }}>
            Nori turns your resume into facts it can cite, finds roles that fit, writes a one-page resume for each, fills the form, and then waits for your OK.
          </p>

          <div className="ln-fade-up mt-8 flex flex-wrap items-center gap-3" style={{ ["--d" as string]: "800ms" }}>
            <Link
              href="/signup"
              onPointerEnter={hop}
              onFocus={hop}
              className="group inline-flex h-13 items-center gap-2 rounded-full bg-[var(--nori)] py-3.5 pl-6 pr-5 text-[15.5px] font-semibold text-[var(--rice)] shadow-[0_12px_30px_-12px_rgba(11,63,49,0.7)] transition-[transform,background-color,box-shadow] duration-300 hover:-translate-y-0.5 hover:bg-[var(--nori-deep)] hover:shadow-[0_18px_36px_-14px_rgba(11,63,49,0.8)]"
            >
              Start with your resume
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--sprout)] text-[var(--nori)] transition-transform duration-300 group-hover:translate-x-0.5 group-hover:rotate-[-8deg]"><ArrowRight size={16} aria-hidden="true" /></span>
            </Link>
            <a href="#story" className="group inline-flex items-center gap-2 rounded-full px-5 py-3.5 text-[15.5px] font-semibold text-ink transition-colors hover:bg-[var(--rice-2)]">
              Watch it work
              <ArrowDown size={16} aria-hidden="true" className="transition-transform duration-300 group-hover:translate-y-0.5" />
            </a>
          </div>

          <ul className="ln-fade-up mt-9 flex flex-col gap-2.5 text-[14.5px] text-ink-2 sm:flex-row sm:flex-wrap sm:gap-x-6" style={{ ["--d" as string]: "950ms" }}>
            {["Every line traces to a fact", "Nothing is sent without you", "Nothing to configure"].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--sprout)]/60 text-[var(--sprout-ink)]"><Check size={13} strokeWidth={3} aria-hidden="true" /></span>
                {t}
              </li>
            ))}
          </ul>
        </div>

        <div ref={stage} className="ln-fade-up relative mx-auto aspect-[1.08] w-full max-w-[600px]" style={{ ["--d" as string]: "300ms" }}>
          <span aria-hidden="true" className="absolute left-1/2 top-[52%] h-[72%] w-[72%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(196,242,106,0.55),rgba(34,197,139,0.18)_55%,transparent)] blur-2xl" />
          <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
            {FACTS.map((f) => (
              <line key={f.label} x1={f.x + 10} y1={f.y + 4} x2={42} y2={56} stroke="#17896a" strokeOpacity=".35" strokeWidth="1" vectorEffect="non-scaling-stroke" className={"ln-tether" + ("wide" in f ? " hidden sm:block" : "")} />
            ))}
          </svg>
          <div className="absolute inset-[6%_4%_0_0]">
            <Doll messages={["Hi! I'm Nori.", "I turn your resume into facts.", "I only write what you did.", "And I stop before I send."]} cheer={cheer} />
          </div>
          <ul aria-label="Facts from a sample career graph" className="pointer-events-none absolute inset-0">
            {FACTS.map((f) => (
              <li key={f.label} className={"wide" in f ? "absolute hidden sm:block" : "absolute"} style={{ ...(f.side === "l" ? { left: `${f.x}%` } : { right: 0 }), top: `${f.y}%`, transform: `translate3d(calc(var(--px, 0) * ${-f.depth}px), calc(var(--py, 0) * ${-f.depth}px), 0)`, transition: "transform 0.4s cubic-bezier(0.22,1,0.36,1)" }}>
                <span className="ln-chip flex items-center gap-2 whitespace-nowrap rounded-full border border-[var(--rice-line)] bg-[color-mix(in_srgb,#fff_86%,transparent)] py-1.5 pl-2 pr-3 text-[12.5px] font-medium text-ink shadow-[0_8px_24px_-14px_rgba(11,63,49,0.5)] backdrop-blur" style={{ ["--d" as string]: f.d }}>
                  <span className={`h-2 w-2 rounded-full ${DOT[f.kind]}`} />
                  <span className="text-[10.5px] font-semibold text-muted">{f.kind}</span>
                  {f.label}
                </span>
              </li>
            ))}
          </ul>
          <p aria-hidden="true" className="font-serif-display absolute bottom-[6%] left-[30%] hidden rotate-[-4deg] text-[18px] italic text-[var(--sprout-ink)] sm:block">
            psst, poke me <span className="inline-block translate-y-[-2px]">↗</span>
          </p>
        </div>
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
    <div className="relative mx-auto w-full max-w-[1200px] px-4 pb-14 sm:px-6 lg:px-8">
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-6">
        <p className="shrink-0 text-[13px] font-semibold text-muted">Finds roles on</p>
        <div className="ln-marquee w-full overflow-hidden" aria-label={`Sources: ${SOURCES.join(", ")}`}>
          <ul className="ln-marquee-track gap-10 py-1" aria-hidden="true">
            {row.map((s, i) => (
              <li key={`${s}-${i}`} className="flex items-center gap-10 whitespace-nowrap text-[17px] font-semibold tracking-[-0.01em] text-[#8a8174]">
                {s}
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--sprout-2)]/60" />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
