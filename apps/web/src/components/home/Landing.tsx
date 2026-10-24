import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Check, Cpu, Download, MessageCircle, Search, Send, FileText, Inbox, type LucideIcon } from "lucide-react";
import { cx } from "@/components/cx";
import { btnPrimary, btnSecondary, chip, container } from "./styles";

function SectionTitle({ id, title, line }: { id: string; title: string; line?: string }) {
  return (
    <div className="max-w-[60ch]">
      <h2 id={id} className="text-[1.625rem] font-semibold leading-tight tracking-[-0.015em] text-ink sm:text-[2rem]">{title}</h2>
      {line && <p className="mt-2 text-[16px] text-ink-2">{line}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ hero */

export function Hero() {
  return (
    <section aria-labelledby="hero-title">
      <div className={cx(container, "grid items-center gap-10 py-14 sm:py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)] lg:gap-14")}>
        <div>
          <p className={chip}>Open source · bring your own model</p>
          <h1 id="hero-title" className="mt-5 max-w-[17ch] text-[2.4rem] font-semibold leading-[1.08] tracking-[-0.03em] text-ink sm:text-[3.25rem]">
            A job agent that applies for you, and stops before it sends.
          </h1>
          <p className="mt-5 max-w-[50ch] text-[17px] leading-relaxed text-ink-2">
            Set the roles you want and a daily cap. Nori finds matches, tailors a one-page resume from facts about you, fills the form, and waits for your OK.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/signup" className={btnPrimary}>Create account<ArrowRight size={18} aria-hidden="true" /></Link>
            <a href="#loop" className={btnSecondary}>How it works</a>
          </div>
          <ul className="mt-8 flex flex-col gap-2 text-[14.5px] text-ink-2 sm:flex-row sm:flex-wrap sm:gap-x-6">
            {["Every line traces to a fact", "Nothing is sent without you", "Runs on your own key or locally"].map((t) => (
              <li key={t} className="flex items-center gap-2"><Check size={17} aria-hidden="true" className="shrink-0 text-accent" />{t}</li>
            ))}
          </ul>
        </div>
        <HeroSample />
      </div>
    </section>
  );
}

/** A real slice of the product, drawn in its own components' language: one item waiting, one sourced line. */
function HeroSample() {
  return (
    <div className="rounded-card border border-line bg-surface p-4 sm:p-5" role="group" aria-label="Sample: the Today screen with one application waiting">
      <div className="-mx-4 -mt-4 mb-4 rounded-t-card border-b border-sandbox-line bg-sandbox px-4 py-2 text-[12.5px] text-sandbox-fg sm:-mx-5 sm:-mt-5 sm:px-5">
        <span className="font-semibold">Dry run</span> Forms are filled, nothing is sent.
      </div>
      <p className="text-[15px] font-semibold text-ink">Waiting on you</p>
      <div className="mt-3 rounded-card border-2 border-attn bg-surface p-3.5">
        <div className="flex items-center gap-2 text-[12px]">
          <span className="rounded-full bg-attn-tint px-2 py-0.5 font-semibold text-attn-fg">Resume</span>
          <span className="text-muted">Tidewater · 21 min ago</span>
        </div>
        <p className="mt-1.5 text-[15px] font-semibold text-ink">Frontend Engineer, Design Systems</p>
        <p className="text-[13px] text-ink-2">3 lines changed, each from your graph. ATS 96.</p>
      </div>
      <div className="mt-3 rounded-card border border-line p-3.5">
        <p className="text-[12.5px] text-muted line-through">Built UI components for internal tools.</p>
        <p className="mt-1 text-[14px] text-ink">Rebuilt the checkout UI in React and TypeScript, cutting load time 38%.</p>
        <p className="mt-2 text-[12px] font-medium text-accent">Source: Project &ldquo;Checkout rewrite&rdquo; · result &ldquo;-38% load&rdquo;</p>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <span className="inline-flex h-10 items-center rounded-control border border-control px-4 text-[13px] font-semibold text-ink">Skip job</span>
        <span className="inline-flex h-10 items-center rounded-control bg-ink px-4 text-[13px] font-semibold text-on-ink">Approve resume</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ the loop */

const LOOP: { icon: LucideIcon; title: string; line: string; gate?: boolean }[] = [
  { icon: Search, title: "Find", line: "Polls company boards and web search inside your lanes. Anything it skips keeps its reason." },
  { icon: FileText, title: "Prepare", line: "Tailors a one-page resume. Every changed line names the fact it came from. You approve it.", gate: true },
  { icon: Send, title: "Apply", line: "Fills the form and shows every field and a screenshot. You approve, then it sends.", gate: true },
  { icon: Inbox, title: "Follow", line: "Reads replies, codes and interview invites, and keeps every application's stage current." },
];

export function HowItWorks() {
  return (
    <section aria-labelledby="loop-title" id="loop" className="scroll-mt-16 border-t border-line bg-surface">
      <div className={cx(container, "py-14 sm:py-20")}>
        <SectionTitle id="loop-title" title="Four stages, two places it waits for you" line="The orange stages are gates: Nori does not move past them until you say so." />
        <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {LOOP.map((s, i) => (
            <li key={s.title} className={cx("flex flex-col gap-2 rounded-card p-5", s.gate ? "border-2 border-attn bg-surface" : "border border-line bg-bg")}>
              <span className={cx("flex h-9 w-9 items-center justify-center rounded-control", s.gate ? "bg-attn-tint text-attn-fg" : "bg-sunken text-ink")}>
                <s.icon size={18} aria-hidden="true" />
              </span>
              <p className="text-[16px] font-semibold text-ink">{i + 1}. {s.title}{s.gate && <span className="ml-2 text-[12px] font-semibold text-attn-fg">you approve</span>}</p>
              <p className="text-[14px] leading-relaxed text-ink-2">{s.line}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ honesty */

export function PromiseSection() {
  return (
    <section aria-labelledby="honest-title" id="honest" className="scroll-mt-16 border-t border-line">
      <div className={cx(container, "grid items-center gap-10 py-14 sm:py-20 lg:grid-cols-2")}>
        <div>
          <SectionTitle id="honest-title" title="It cannot invent a claim" />
          <p className="mt-4 max-w-[52ch] text-[16px] leading-relaxed text-ink-2">
            Your history becomes a graph of roles, projects, skills and results. Resume lines and form answers are written only from that graph, and each one shows where it came from.
          </p>
          <p className="mt-3 max-w-[52ch] text-[16px] leading-relaxed text-ink-2">
            When a posting asks for something you have not shown, Nori leaves it out and tells you. Add the fact yourself and it can use it next time.
          </p>
        </div>
        <div className="flex flex-col gap-3" role="group" aria-label="Sample: what a gap looks like">
          <div className="rounded-card border border-line bg-surface p-4">
            <p className="text-[13px] font-semibold text-ink">Matches 3 of 4 must-haves</p>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[12.5px]">
              {["React", "TypeScript", "Next.js"].map((s) => <span key={s} className="rounded-full bg-sunken px-2.5 py-0.5 text-ink">{s}</span>)}
              <span className="rounded-full border border-dashed border-control px-2.5 py-0.5 text-muted">GraphQL</span>
            </div>
          </div>
          <div className="rounded-card bg-sunken p-4">
            <p className="text-[13px] font-semibold text-ink">Not claimed</p>
            <p className="mt-1 text-[13.5px] text-ink-2">The posting asks for GraphQL. Nothing in your graph shows it, so it is left out.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ yours to run */

const YOURS: { icon: LucideIcon; title: string; line: ReactNode }[] = [
  { icon: Cpu, title: "Your model", line: "Your own API key, hosted credits, or a local model on your computer. With no model at all it still runs on rules." },
  { icon: MessageCircle, title: "Your channels", line: "Telegram, WhatsApp, Slack, a small companion beside your clock, or the web. Same commands everywhere." },
  { icon: Download, title: "Your data", line: "Export your graph as a file any time. Delete your account and everything goes with it." },
];

export function Studio() {
  return (
    <section aria-labelledby="yours-title" id="yours" className="scroll-mt-16 border-t border-line bg-surface">
      <div className={cx(container, "py-14 sm:py-20")}>
        <SectionTitle id="yours-title" title="Yours to run" />
        <ul className="mt-8 grid gap-4 md:grid-cols-3">
          {YOURS.map((y) => (
            <li key={y.title} className="rounded-card border border-line bg-bg p-5">
              <y.icon size={20} aria-hidden="true" className="text-ink" />
              <p className="mt-3 text-[16px] font-semibold text-ink">{y.title}</p>
              <p className="mt-1.5 text-[14px] leading-relaxed text-ink-2">{y.line}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** Kept so older imports still compile; the proof points now live in the hero. */
export function ProofStrip() {
  return null;
}

export function FinalCall() {
  return (
    <section aria-labelledby="final-title" className="border-t border-line">
      <div className={cx(container, "py-14 sm:py-20")}>
        <div className="flex flex-col items-start gap-4 rounded-card bg-sunken p-7 sm:flex-row sm:items-center sm:justify-between sm:p-10">
          <div>
            <h2 id="final-title" className="text-[1.5rem] font-semibold tracking-[-0.015em] text-ink sm:text-[1.75rem]">Start with your resume</h2>
            <p className="mt-1 text-[16px] text-ink-2">About ten minutes to set up. Nothing is sent until you say so.</p>
          </div>
          <Link href="/signup" className={btnPrimary}>Create account<ArrowRight size={18} aria-hidden="true" /></Link>
        </div>
      </div>
    </section>
  );
}
