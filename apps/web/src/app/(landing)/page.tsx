import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, GitBranch } from "lucide-react";
import { Doll } from "@/components/dash/Doll";
import { Letters } from "@/components/Letters";
import { NoriLogo } from "@/components/Logo";
import { Marquee, ProductPeek, ProvenanceDemo, SectionTitle, Steps, Templates, Trust } from "@/components/landing/parts";
import { PublicFooter, REPO_URL } from "@/components/public/Chrome";

export const metadata: Metadata = {
  title: { absolute: "Nori: a job agent that cannot lie about you" },
  description: "Nori turns your resume into a career graph, finds roles that fit, tailors a one-page resume where every line traces to something you did, and fills the application for your approval.",
};

const STUDIO = ["Seven templates, from a plain one-column classic to an executive serif", "Fonts, accent colour, size, spacing and margins; Letter or A4", "Live preview, section reordering, version history", "PDF, Word, plain text and JSON export", "An ATS check that tells you when a layout could scramble in an applicant system"];

const NOTES = ["Hi! I am Nori. I read your resume.", "Every line I write traces back to you.", "I never invent a thing.", "You approve before I send."];

export default async function LandingPage() {
  if ((await cookies()).get("jg_session")?.value) redirect("/dashboard");
  return (
    <>
      {/* ---------------------------------------------------------------- hero */}
      <div className="ob-bg ob-bg-scroll ob-dots relative overflow-clip text-white">
        <span aria-hidden="true" className="dash-blob -left-24 top-1/3 h-96 w-96 bg-emerald-400/30" />
        <span aria-hidden="true" className="dash-blob -right-24 -top-16 h-[26rem] w-[26rem] bg-fuchsia-500/30" style={{ animationDelay: "-7s" }} />
        <span aria-hidden="true" className="dash-blob bottom-10 left-1/2 h-80 w-80 bg-amber-400/20" style={{ animationDelay: "-12s" }} />

        <header className="relative z-30 mx-auto flex h-20 w-full max-w-[1180px] items-center justify-between px-4 sm:px-8">
          <Link href="/" aria-label="Nori home"><NoriLogo size={40} tone="light" /></Link>
          <nav aria-label="Main" className="flex items-center gap-1 text-[14px] font-medium">
            <a href="#how" className="hidden rounded-lg px-3 py-2 text-white/70 transition-colors hover:text-white md:inline">How it works</a>
            <a href="#trust" className="hidden rounded-lg px-3 py-2 text-white/70 transition-colors hover:text-white md:inline">Why trust it</a>
            <a href="#studio" className="hidden rounded-lg px-3 py-2 text-white/70 transition-colors hover:text-white md:inline">Resume studio</a>
            <Link href="/login" className="rounded-lg px-3 py-2 text-white/80 transition-colors hover:text-white">Sign in</Link>
            <Link href="/signup" className="dash-btn-sun ml-1 inline-flex h-10 items-center rounded-full px-5 text-[14px] font-semibold transition-transform duration-150 hover:-translate-y-0.5">Get started</Link>
          </nav>
        </header>

        <section className="relative z-10 mx-auto grid w-full max-w-[1180px] items-center gap-2 px-4 pb-6 pt-6 sm:px-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:pt-10">
          <div>
            <p className="ob-rise inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.07] px-3.5 py-1.5 text-[12.5px] font-medium text-emerald-100/90 backdrop-blur">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-300" />Open source job agent
            </p>
            <h1 className="mt-6 font-display text-[2.8rem] font-medium leading-[0.96] tracking-[-0.055em] sm:text-[4.9rem]" aria-label="A job search agent that cannot lie about you.">
              <Letters text="A job search agent" /><br />
              <Letters text="that cannot lie" from={19} grad /><br />
              <Letters text="about you." from={34} grad />
            </h1>
            <p className="ob-rise mt-6 max-w-[54ch] text-[17px] leading-relaxed text-white/70" style={{ ["--i" as string]: 9 }}>
              Nori turns your resume into a career graph, finds roles that fit, tailors a one-page resume where every line traces back to something you actually did, and fills in the application. You approve before anything is sent.
            </p>
            <div className="ob-rise mt-8 flex flex-wrap items-center gap-3" style={{ ["--i" as string]: 11 }}>
              <Link href="/signup" className="dash-btn-sun group inline-flex h-13 items-center gap-2 rounded-full px-8 py-3.5 text-[16px] font-semibold transition-transform duration-150 hover:-translate-y-0.5">
                Create your account <ArrowRight size={18} aria-hidden="true" className="transition-transform duration-150 group-hover:translate-x-1" />
              </Link>
              <Link href="/login" className="inline-flex items-center rounded-full border border-white/20 bg-white/[0.07] px-7 py-3.5 text-[16px] font-medium text-white/90 backdrop-blur transition-colors duration-150 hover:bg-white/[0.14]">Sign in</Link>
            </div>
            <p className="ob-rise mt-4 text-[13px] text-white/55" style={{ ["--i" as string]: 12 }}>Works with a local model or your own model key. Free, and nothing is sent without your approval.</p>
          </div>
          <div className="relative h-[360px] sm:h-[480px] lg:h-[560px]">
            <span aria-hidden="true" className="absolute left-1/2 top-[48%] h-[75%] w-[75%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(255,214,150,0.4),rgba(255,122,184,0.18)_55%,transparent)] blur-2xl" />
            <Doll messages={NOTES} />
          </div>
        </section>

        <div className="relative z-10 mx-auto w-full max-w-[1180px] px-4 pb-16 sm:px-8 lg:-mt-6">
          <ProductPeek />
        </div>
      </div>

      <Marquee />

      {/* ---------------------------------------------------------------- how it works */}
      <section aria-labelledby="how" className="mx-auto w-full max-w-[1180px] px-4 py-20 sm:px-8 sm:py-28">
        <SectionTitle eyebrow="How it works" title={<span id="how">From resume to sent, with you in charge.</span>}>
          Three steps, and you decide at the end of each one.
        </SectionTitle>
        <Steps />
      </section>

      {/* ---------------------------------------------------------------- trust */}
      <section aria-labelledby="trust" className="border-y border-black/5 bg-gradient-to-b from-stone/50 to-paper">
        <div className="mx-auto w-full max-w-[1180px] px-4 py-20 sm:px-8 sm:py-28">
          <SectionTitle eyebrow="The promise" title={<span id="trust">Built to be trusted with your name.</span>}>
            Most tools hand you a flat resume and a prompt. Nori keeps a graph of what you did, so every claim has a source and a refusal has a reason.
          </SectionTitle>
          <ProvenanceDemo />
          <Trust />
        </div>
      </section>

      {/* ---------------------------------------------------------------- studio */}
      <section aria-labelledby="studio" className="mx-auto w-full max-w-[1180px] px-4 py-20 sm:px-8 sm:py-28">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:items-center">
          <div>
            <SectionTitle eyebrow="Resume studio" title={<span id="studio">A resume studio, not a template.</span>}>
              Edit your resume as a document, change the look in one click, and keep every version. Each application gets its own tailored copy that you can still edit before you approve it.
            </SectionTitle>
            <ul className="mt-8 space-y-3 text-[15px] text-ink-2">
              {STUDIO.map((t) => (
                <li key={t} className="flex gap-3"><span aria-hidden="true" className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-gradient-to-br from-emerald-500 to-amber-400" />{t}</li>
              ))}
            </ul>
          </div>
          <div className="dash-card reveal p-6 sm:p-8"><Templates /></div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- final call */}
      <div className="ob-bg ob-bg-scroll ob-dots relative overflow-clip text-white">
        <span aria-hidden="true" className="dash-blob -left-24 top-0 h-80 w-80 bg-emerald-400/30" />
        <span aria-hidden="true" className="dash-blob -right-24 bottom-0 h-80 w-80 bg-fuchsia-500/25" style={{ animationDelay: "-7s" }} />
        <section className="relative z-10 mx-auto w-full max-w-[1180px] px-4 py-24 text-center sm:px-8 sm:py-32">
          <h2 className="mx-auto max-w-[18ch] font-display text-[2.4rem] font-medium leading-[1] tracking-[-0.05em] sm:text-[4rem]">Start with your resume. <span className="dash-grad-text">Nori does the rest.</span></h2>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Link href="/signup" className="dash-btn-sun group inline-flex items-center gap-2 rounded-full px-8 py-3.5 text-[16px] font-semibold transition-transform duration-150 hover:-translate-y-0.5">
              Create your account <ArrowRight size={18} aria-hidden="true" className="transition-transform duration-150 group-hover:translate-x-1" />
            </Link>
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/[0.07] px-7 py-3.5 text-[16px] font-medium text-white/90 backdrop-blur transition-colors duration-150 hover:bg-white/[0.14]">
              <GitBranch size={17} aria-hidden="true" />Read the source
            </a>
          </div>
        </section>
        <div className="relative z-10"><PublicFooter dark /></div>
      </div>
    </>
  );
}
