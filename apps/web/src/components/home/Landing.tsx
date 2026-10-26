"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  ArrowRight, Check, Cpu, Download, FileText, Inbox, MessageCircle, Search, Send, ShieldCheck, Sparkles, XCircle,
  type LucideIcon,
} from "lucide-react";
import { cx } from "@/components/cx";
import { NoriMascot3D, triggerNoriReaction } from "@/components/mascot/NoriMascot3D";
import { btnPrimary, btnSecondary, chip, container } from "./styles";

function SectionTitle({ id, eyebrow, title, line }: { id: string; eyebrow?: string; title: string; line?: string }) {
  return (
    <div className="max-w-[64ch]">
      {eyebrow && (
        <span className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-[#bce6d1] bg-[#e6f8ef] px-3.5 py-1 text-[11.5px] font-bold tracking-wider text-accent-fg shadow-2xs">
          <Sparkles size={12} aria-hidden="true" className="text-accent" />
          {eyebrow}
        </span>
      )}
      <h2 id={id} className="text-[1.95rem] font-extrabold leading-[1.12] tracking-[-0.028em] text-ink sm:text-[2.45rem]">{title}</h2>
      {line && <p className="mt-3 text-[16.5px] leading-relaxed text-ink-2">{line}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ hero */

const TRUST_BADGES = [
  { text: "Every line traces to a fact", cls: "border-[#bce6d1] bg-[#e5f8ee] text-[#064f39]" },
  { text: "Nothing is sent without you", cls: "border-[#f2d2a7] bg-[#fff1dc] text-[#7a2c05]" },
  { text: "Model included — zero setup", cls: "border-[#bfd9f7] bg-[#e6f2ff] text-[#14437a]" },
];

const PLATFORMS = [
  "Greenhouse", "Workday", "Lever", "Ashby", "Rippling", "Workable",
  "SmartRecruiters", "Recruitee", "BambooHR", "Pinpoint", "Breezy", "Dover", "Personio", "Hacker News", "Exa Web",
];

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative overflow-hidden">
      <div className={cx(container, "grid items-center gap-10 py-10 sm:py-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-12")}>
        <div>
          <p className={chip}>
            <span className="inline-block h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
            Open source · Nori&apos;s model included
          </p>
          <h1 id="hero-title" className="mt-5 max-w-[16.5ch] text-[2.65rem] font-extrabold leading-[1.04] tracking-[-0.036em] text-ink sm:text-[3.55rem]">
            A job agent that{" "}
            <span className="inline-block rounded-2xl border border-[#bce6d1] bg-[linear-gradient(135deg,#dff7ec_0%,#fff4df_100%)] px-3 py-0.5 text-accent-fg shadow-2xs">
              applies for you
            </span>
            , and stops before it sends.
          </h1>
          <p className="mt-5 max-w-[50ch] text-[17px] leading-[1.62] text-ink-2">
            Set the roles you want and a daily cap. Nori polls 13 hiring platforms, tailors a one-page resume where every bullet traces to your career graph, fills the ATS form, and waits for your OK.
          </p>
          <div className="mt-8 flex flex-wrap gap-3.5">
            <Link href="/signup" className={btnPrimary}>
              Create account
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
            <a href="#loop" className={btnSecondary}>See how it works</a>
          </div>
          <ul className="mt-7 flex flex-wrap gap-2">
            {TRUST_BADGES.map((b) => (
              <li
                key={b.text}
                className={cx("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px] font-semibold shadow-2xs", b.cls)}
              >
                <Check size={13} aria-hidden="true" className="shrink-0" />
                <span>{b.text}</span>
              </li>
            ))}
          </ul>
        </div>
        <HeroInteractiveStudio />
      </div>

      {/* 15-Platform Coverage Ribbon */}
      <div className="border-y border-line/80 bg-surface/65 py-4 backdrop-blur-xs">
        <div className={cx(container, "flex flex-wrap items-center justify-center gap-2")}>
          <span className="mr-2 text-[12px] font-bold uppercase tracking-wider text-muted">Pulls live roles from:</span>
          {PLATFORMS.map((p) => (
            <span
              key={p}
              className="rounded-full border border-line bg-surface px-2.5 py-0.5 text-[12px] font-medium text-ink-2 shadow-2xs"
            >
              {p}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Interactive 3D Nori Showcase + 3-Tab Product Sandbox right in the Hero. */
function HeroInteractiveStudio() {
  const [tab, setTab] = useState<"diff" | "form" | "recruiter">("diff");

  function switchTab(next: "diff" | "form" | "recruiter", msg: string) {
    setTab(next);
    triggerNoriReaction({ mood: "celebrate", message: msg });
  }

  return (
    <div
      className="bento-hero relative rounded-card border-2 border-[#b7e4ce] p-4 shadow-[0_24px_60px_-15px_rgba(13,117,86,0.18),0_4px_12px_rgba(19,28,24,0.06)] sm:p-5"
      role="group"
      aria-label="Sample: Interactive 3D Nori studio and live application review"
    >
      {/* Top status bar */}
      <div className="-mx-4 -mt-4 mb-4 flex flex-wrap items-center justify-between gap-2 rounded-t-[16px] border-b border-[#bce6d1] bg-[linear-gradient(90deg,#dff6ec_0%,#fff1db_100%)] px-4 py-2.5 text-[12.5px] text-ink sm:-mx-5 sm:-mt-5 sm:px-5">
        <span className="flex items-center gap-2 font-medium">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-accent ring-4 ring-accent/20" aria-hidden="true" />
          <span><strong className="font-bold">Dry run</strong> · Forms are filled, nothing is sent</span>
        </span>
        <div className="flex items-center gap-1.5">
          <span className="rounded-full border border-[#bce6d1] bg-white px-2.5 py-0.5 font-mono text-[11.5px] font-bold text-accent-fg">
            94% Match
          </span>
          <span className="rounded-full border border-[#f2d2a7] bg-white px-2.5 py-0.5 font-mono text-[11.5px] font-bold text-[#7a2c05]">
            ATS 96
          </span>
        </div>
      </div>

      {/* Prominent 3D Nori Showcase Stage */}
      <NoriMascot3D
        variant="showcase"
        className="bento-mint mb-4 border-[#bce6d1] shadow-xs"
        messages={[
          "Hi! Click the tabs below to inspect my work!",
          "Every resume line traces to a verified fact.",
          "Click me or any pill for a lucky 3D hop!",
        ]}
      />

      {/* Interactive 3-Tab Switcher */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="inline-flex rounded-xl border border-line bg-sunken/80 p-1 text-[12.5px] font-semibold">
          <button
            type="button"
            onClick={() => switchTab("diff", "Showing your provenance-verified resume diff!")}
            className={cx(
              "rounded-lg px-3 py-1 transition-all",
              tab === "diff" ? "bg-surface text-ink shadow-xs" : "text-ink-2 hover:text-ink",
            )}
          >
            1. Resume diff
          </button>
          <button
            type="button"
            onClick={() => switchTab("form", "38 of 38 Greenhouse fields filled & checked!")}
            className={cx(
              "rounded-lg px-3 py-1 transition-all",
              tab === "form" ? "bg-surface text-ink shadow-xs" : "text-ink-2 hover:text-ink",
            )}
          >
            2. Filled form (38)
          </button>
          <button
            type="button"
            onClick={() => switchTab("recruiter", "Recruiter's read: 92/100 — strong match!")}
            className={cx(
              "rounded-lg px-3 py-1 transition-all",
              tab === "recruiter" ? "bg-surface text-ink shadow-xs" : "text-ink-2 hover:text-ink",
            )}
          >
            3. Recruiter view
          </button>
        </div>
        <span className="hidden rounded-full bg-attn px-2.5 py-0.5 text-[11px] font-bold text-white sm:inline-block">
          Waiting on you
        </span>
      </div>

      {/* Tab Content */}
      {tab === "diff" && (
        <div className="space-y-2.5">
          <div className="bento-honey rounded-2xl border-2 border-attn p-3.5">
            <div className="flex items-center justify-between gap-2 text-[12px]">
              <span className="rounded-full bg-attn px-2.5 py-0.5 font-bold text-white">Resume Gate</span>
              <span className="font-medium text-ink-2">Tidewater · Senior Frontend Engineer</span>
            </div>
            <p className="mt-1.5 text-[13.5px] font-medium text-ink-2">
              3 bullets tailored from your Career Graph · 1-page ATS Standard PDF fitted.
            </p>
          </div>
          <div className="rounded-2xl border border-[#bce6d1] bg-white p-3.5 shadow-2xs">
            <p className="text-[12px] text-muted line-through">Built UI components for internal tools.</p>
            <p className="mt-1 text-[14px] font-semibold text-ink">
              Rebuilt the checkout UI in React and TypeScript, cutting page load time 38%.
            </p>
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-accent-tint px-2.5 py-0.5 text-[11.5px] font-semibold text-accent-fg">
              <ShieldCheck size={13} aria-hidden="true" className="text-accent" />
              Source: Project &ldquo;Checkout rewrite&rdquo; · metric &ldquo;-38% load&rdquo;
            </p>
          </div>
        </div>
      )}

      {tab === "form" && (
        <div className="grid grid-cols-2 gap-2.5">
          {[
            { section: "Personal & Contact", count: "7 / 7 filled", detail: "Name, maya-chen@mail.norinote.xyz, SF", cls: "bento-sky" },
            { section: "Education Typeahead", count: "4 / 4 filled", detail: "B.S. Computer Science · GPA & dates", cls: "bento-mint" },
            { section: "Work Authorization", count: "3 / 3 filled", detail: "Authorized in US · No sponsorship", cls: "bento-honey" },
            { section: "Autopilot Safety Gate", count: "11 / 11 passed", detail: "No CAPTCHA · ATS 96 · Cooldown OK", cls: "bento-lavender" },
          ].map((g) => (
            <div key={g.section} className={cx("rounded-2xl border p-3", g.cls)}>
              <div className="flex items-center justify-between text-[11.5px] font-bold text-ink">
                <span>{g.section}</span>
                <span className="rounded-full bg-white/90 px-2 py-0.5 font-mono text-[10.5px] text-accent-fg">{g.count}</span>
              </div>
              <p className="mt-1 text-[12px] text-ink-2">{g.detail}</p>
            </div>
          ))}
        </div>
      )}

      {tab === "recruiter" && (
        <div className="bento-mint space-y-2.5 rounded-2xl border p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-[13.5px] font-bold text-ink">Deterministic Recruiter Audit</span>
            <span className="rounded-full bg-accent px-2.5 py-0.5 font-mono text-[12px] font-bold text-white">92 / 100 Strong</span>
          </div>
          <div className="flex flex-wrap gap-1.5 text-[12px]">
            {["React (in bullets)", "TypeScript (in bullets)", "Design Systems (in bullets)", "Node.js (in bullets)"].map((s) => (
              <span key={s} className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-0.5 font-semibold text-accent-fg shadow-2xs">
                <Check size={12} aria-hidden="true" />
                {s}
              </span>
            ))}
            <span className="rounded-full border border-dashed border-control bg-white/75 px-2.5 py-0.5 text-muted">
              GraphQL (not claimed)
            </span>
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-2 border-t border-[#cde5d8] pt-3.5">
        <span className="text-[12px] font-medium text-ink-2">Nothing is sent until you click approve</span>
        <div className="flex gap-2">
          <span className="inline-flex h-9 items-center rounded-control border border-control/60 bg-white px-3.5 text-[12.5px] font-semibold text-ink">
            Skip job
          </span>
          <Link
            href="/signup"
            className="inline-flex h-9 items-center gap-1 rounded-control bg-[linear-gradient(180deg,#158f6a_0%,#0b664a_100%)] px-3.5 text-[12.5px] font-semibold text-white shadow-[0_3px_10px_rgba(13,117,86,0.24)]"
          >
            Approve &amp; continue
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ the loop (12-column asymmetric visual bento) */

export function HowItWorks() {
  return (
    <section aria-labelledby="loop-title" id="loop" className="scroll-mt-16 py-16 sm:py-22">
      <div className={container}>
        <SectionTitle
          id="loop-title"
          eyebrow="FOUR STAGES · TWO HUMAN GATES"
          title="Four stages, two places it waits for you"
          line="Every stage shows its work visually. The warm amber stages are human gates: Nori never moves past them until you say so."
        />

        <ol className="mt-10 grid grid-cols-1 gap-5 lg:grid-cols-12">
          {/* Stage 1: 7 cols */}
          <li className="bento-sky flex flex-col justify-between gap-5 rounded-card border p-6 shadow-xs lg:col-span-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#cfe4ff] px-3 py-1 text-[12px] font-bold text-[#123d73]">
                  <Search size={14} aria-hidden="true" /> Stage 1 · Discovery
                </span>
                <p className="mt-3 text-[1.35rem] font-bold tracking-[-0.015em] text-ink">1. Find roles across 13 ATSes &amp; the web</p>
                <p className="mt-1.5 max-w-[52ch] text-[14.5px] leading-relaxed text-ink-2">
                  Polls Greenhouse, Workday, Lever, Ashby, Rippling, Workable, Recruitee, BambooHR, Pinpoint, Breezy, Dover, Personio, plus Hacker News &amp; Exa search inside your lanes.
                </p>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/mascot/3d/nori-3d-curious.png" alt="" aria-hidden="true" className="h-20 w-20 shrink-0 rounded-2xl border border-white bg-white/90 p-1.5 object-contain shadow-xs" loading="lazy" />
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {[
                { co: "Anthropic", role: "Staff Systems Engineer", ats: "Greenhouse", match: "94%" },
                { co: "NVIDIA", role: "Deep Learning Engineer", ats: "Workday CXS", match: "91%" },
                { co: "Linear", role: "Senior Product Engineer", ats: "Ashby", match: "89%" },
              ].map((j) => (
                <div key={j.co} className="rounded-xl border border-white/90 bg-white/90 p-3 shadow-2xs">
                  <div className="flex items-center justify-between text-[11.5px]">
                    <span className="font-bold text-ink">{j.co}</span>
                    <span className="rounded-full bg-[#e2f7ec] px-2 py-0.5 font-mono font-bold text-[#064f39]">{j.match}</span>
                  </div>
                  <p className="mt-1 truncate text-[12.5px] font-semibold text-ink">{j.role}</p>
                  <p className="text-[11px] text-muted">via {j.ats}</p>
                </div>
              ))}
            </div>
          </li>

          {/* Stage 2: 5 cols (Gate 1) */}
          <li className="bento-honey flex flex-col justify-between gap-5 rounded-card border-2 border-attn p-6 shadow-xs lg:col-span-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#ffe0ba] px-3 py-1 text-[12px] font-bold text-[#7a2c05]">
                    <FileText size={14} aria-hidden="true" /> Stage 2 · Tailoring
                  </span>
                  <span className="rounded-full bg-attn px-2.5 py-0.5 text-[11px] font-bold text-white">you approve</span>
                </div>
                <p className="mt-3 text-[1.35rem] font-bold tracking-[-0.015em] text-ink">2. Prepare a 1-page resume</p>
                <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-2">
                  Rewrites bullets only from your Career Graph, fits to one page, and scores with the Recruiter&apos;s View.
                </p>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/mascot/3d/nori-3d-typing.png" alt="" aria-hidden="true" className="h-20 w-20 shrink-0 rounded-2xl border border-white bg-white/90 p-1.5 object-contain shadow-xs" loading="lazy" />
            </div>
            <div className="rounded-xl border border-white bg-white/95 p-3.5 shadow-2xs">
              <div className="flex items-center justify-between text-[11.5px] font-bold text-accent-fg">
                <span>✓ Backed by Career Graph node</span>
                <span className="font-mono">ATS 96 · 1 page</span>
              </div>
              <p className="mt-1 text-[12.5px] font-medium text-ink">
                &ldquo;Led checkout migration to React &amp; TypeScript, cutting p95 latency 45%.&rdquo;
              </p>
            </div>
          </li>

          {/* Stage 3: 5 cols (Gate 2) */}
          <li className="bento-rose flex flex-col justify-between gap-5 rounded-card border-2 border-attn p-6 shadow-xs lg:col-span-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#ffd4de] px-3 py-1 text-[12px] font-bold text-[#7d1c35]">
                    <Send size={14} aria-hidden="true" /> Stage 3 · Form Fill
                  </span>
                  <span className="rounded-full bg-attn px-2.5 py-0.5 text-[11px] font-bold text-white">you approve</span>
                </div>
                <p className="mt-3 text-[1.35rem] font-bold tracking-[-0.015em] text-ink">3. Apply &amp; verify every field</p>
                <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-2">
                  Fills inputs, comboboxes, and file uploads in a warm browser pool, remembers your answers, and screenshots the receipt.
                </p>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/mascot/3d/nori-3d-wave.png" alt="" aria-hidden="true" className="h-20 w-20 shrink-0 rounded-2xl border border-white bg-white/90 p-1.5 object-contain shadow-xs" loading="lazy" />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {["Personal (7/7)", "Education (4/4)", "Work Auth (3/3)", "EEO (4/4)", "11 Autopilot Checks"].map((chipText) => (
                <span key={chipText} className="rounded-full border border-white bg-white/90 px-2.5 py-1 text-[11.5px] font-semibold text-ink shadow-2xs">
                  ✓ {chipText}
                </span>
              ))}
            </div>
          </li>

          {/* Stage 4: 7 cols */}
          <li className="bento-mint flex flex-col justify-between gap-5 rounded-card border p-6 shadow-xs lg:col-span-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#c6f0dc] px-3 py-1 text-[12px] font-bold text-[#064f39]">
                  <Inbox size={14} aria-hidden="true" /> Stage 4 · Inbox &amp; Channels
                </span>
                <p className="mt-3 text-[1.35rem] font-bold tracking-[-0.015em] text-ink">4. Follow replies, OTP codes &amp; phone chat</p>
                <p className="mt-1.5 max-w-[52ch] text-[14.5px] leading-relaxed text-ink-2">
                  Reads emailed security codes from your owned <code className="font-mono text-[13px]">@mail.norinote.xyz</code> address or Gmail, updates tracker stages, and texts you on Telegram or SMS.
                </p>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/mascot/3d/nori-3d-celebrate.png" alt="" aria-hidden="true" className="h-20 w-20 shrink-0 rounded-2xl border border-white bg-white/90 p-1.5 object-contain shadow-xs" loading="lazy" />
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <div className="rounded-xl border border-white bg-white/90 p-3 shadow-2xs">
                <p className="text-[11px] font-bold uppercase tracking-wider text-accent-fg">Owned Applicant Inbox</p>
                <p className="mt-0.5 text-[12.5px] font-semibold text-ink">Read Greenhouse code 482913 → Auto-submitted!</p>
              </div>
              <div className="rounded-xl border border-white bg-white/90 p-3 shadow-2xs">
                <p className="text-[11px] font-bold uppercase tracking-wider text-[#14437a]">Telegram · @NoriNoteBot</p>
                <p className="mt-0.5 text-[12.5px] font-semibold text-ink">&ldquo;approve 1&rdquo; → Submitted Waymo application</p>
              </div>
            </div>
          </li>
        </ol>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ honesty */

export function PromiseSection() {
  return (
    <section aria-labelledby="honest-title" id="honest" className="scroll-mt-16 py-14 sm:py-20">
      <div className={cx(container, "grid items-center gap-10 lg:grid-cols-2 lg:gap-14")}>
        <div>
          <SectionTitle
            id="honest-title"
            eyebrow="PROVENANCE BY CONSTRUCTION"
            title="It cannot invent a claim"
          />
          <p className="mt-4 max-w-[52ch] text-[16px] leading-relaxed text-ink-2">
            Your history becomes a career graph of roles, projects, skills and measured results. Resume lines and form answers are written only from that graph, and each one shows where it came from.
          </p>
          <p className="mt-3 max-w-[52ch] text-[16px] leading-relaxed text-ink-2">
            When a posting asks for something you have not shown, Nori leaves it out and tells you. Add the fact yourself and it can use it next time.
          </p>
          <div className="bento-mint mt-6 inline-flex items-center gap-3.5 rounded-card border p-4 shadow-xs">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/mascot/3d/nori-3d-wink.png" alt="" aria-hidden="true" className="h-14 w-14 shrink-0 rounded-xl bg-white/90 p-1 object-contain shadow-2xs" loading="lazy" />
            <p className="text-[13.5px] font-medium text-ink">
              Every rewritten bullet is checked against your graph—new numbers, buzzword fluff, or unbacked skills are rejected automatically.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-4" role="group" aria-label="Sample: what a gap looks like">
          <div className="bento-rose rounded-card border p-5 shadow-xs">
            <div className="flex items-center gap-2 text-[13px] font-bold text-[#881b12]">
              <XCircle size={16} aria-hidden="true" />
              Other AI auto-appliers
            </div>
            <p className="mt-1.5 text-[13.5px] text-ink-2">
              Stuff every missing JD keyword into your resume whether you know it or not—leaving you unable to defend fake claims in an interview.
            </p>
          </div>

          <div className="bento-mint rounded-card border p-5 shadow-xs">
            <div className="flex items-center justify-between">
              <p className="text-[14px] font-bold text-ink">Nori: Matches 3 of 4 must-haves</p>
              <span className="rounded-full bg-white/90 px-2.5 py-0.5 font-mono text-[12px] font-semibold text-accent-fg shadow-2xs">75% coverage</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-[13px]">
              {["React", "TypeScript", "Next.js"].map((s) => (
                <span key={s} className="inline-flex items-center gap-1 rounded-full bg-accent px-3 py-1 font-medium text-white shadow-2xs">
                  <Check size={13} aria-hidden="true" />
                  {s}
                </span>
              ))}
              <span className="rounded-full border border-dashed border-control bg-white/80 px-3 py-1 text-muted">GraphQL</span>
            </div>
          </div>

          <div className="bento-honey rounded-card border p-5 shadow-xs">
            <p className="text-[14px] font-bold text-ink">Not claimed — left out honestly</p>
            <p className="mt-1 text-[14px] leading-relaxed text-ink-2">
              The posting asks for GraphQL. Nothing in your graph shows it, so it is left out of your resume until you add a real project or role that used it.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ yours to run */

const YOURS: { icon: LucideIcon; bento: string; iconCls: string; title: string; line: ReactNode }[] = [
  {
    icon: Cpu,
    bento: "bento-mint",
    iconCls: "bg-[#ccf2df] text-[#064f39]",
    title: "Model included",
    line: "Nori's own model does the work, so there is nothing to set up and no key to paste. If the model is ever unavailable it still runs on rules.",
  },
  {
    icon: MessageCircle,
    bento: "bento-sky",
    iconCls: "bg-[#d4e7ff] text-[#14437a]",
    title: "Your channels",
    line: "Telegram, WhatsApp, SMS, Slack, a small companion beside your clock, or the web. Same commands everywhere.",
  },
  {
    icon: Download,
    bento: "bento-lavender",
    iconCls: "bg-[#e2d8fc] text-[#422c6e]",
    title: "Your data",
    line: "Export your career graph as a JSON file any time. Delete your account and every artifact goes with it.",
  },
];

export function Studio() {
  return (
    <section aria-labelledby="yours-title" id="yours" className="scroll-mt-16 py-14 sm:py-20">
      <div className={container}>
        <SectionTitle id="yours-title" eyebrow="BUILT FOR YOU" title="Yours to run" />
        <ul className="mt-8 grid gap-5 md:grid-cols-3">
          {YOURS.map((y) => (
            <li key={y.title} className={cx("rounded-card border p-6 shadow-xs", y.bento)}>
              <span className={cx("flex h-11 w-11 items-center justify-center rounded-control shadow-2xs", y.iconCls)}>
                <y.icon size={20} aria-hidden="true" />
              </span>
              <p className="mt-4 text-[17px] font-bold text-ink">{y.title}</p>
              <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{y.line}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function ProofStrip() {
  return null;
}

export function FinalCall() {
  return (
    <section aria-labelledby="final-title" className="py-12 sm:py-18">
      <div className={container}>
        <div className="bento-hero flex flex-col items-start gap-6 rounded-card border-2 border-[#bce6d1] p-7 shadow-[0_20px_50px_-15px_rgba(13,117,86,0.14)] sm:flex-row sm:items-center sm:justify-between sm:p-10">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <div className="flex -space-x-3">
              {["/mascot/3d/nori-3d-curious.png", "/mascot/3d/nori-3d-celebrate.png", "/mascot/3d/nori-3d-wave.png"].map((src) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={src}
                  src={src}
                  alt=""
                  aria-hidden="true"
                  className="h-16 w-16 shrink-0 rounded-2xl border-2 border-[#bce6d1] bg-white p-1 object-contain shadow-xs"
                  loading="lazy"
                />
              ))}
            </div>
            <div>
              <h2 id="final-title" className="text-[1.65rem] font-extrabold tracking-[-0.025em] text-ink sm:text-[2.05rem]">
                Start with your resume
              </h2>
              <p className="mt-1 text-[16px] text-ink-2">
                About a minute to set up. Nothing is sent until you say so.
              </p>
            </div>
          </div>
          <Link href="/signup" className={btnPrimary}>
            Create account
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}
