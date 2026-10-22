import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { ArrowRight, GitBranch, Sparkles, Star, UserRound, Zap } from "lucide-react";
import { NoriLogo } from "@/components/Logo";
import { AuthCard } from "@/components/landing/AuthCard";
import { MeadowBackdrop, NoriBuddy } from "@/components/landing/meadow";
import { Marquee, ProductPeek, ProvenanceDemo, SectionTitle, Steps, Templates, Trust } from "@/components/landing/parts";
import { PublicFooter, REPO_URL } from "@/components/public/Chrome";

export const metadata: Metadata = {
  title: { absolute: "Nori: a job agent that cannot lie about you" },
  description: "Nori turns your resume into a career graph, finds roles that fit, tailors a one-page resume where every line traces to something you did, and fills the application for your approval.",
};

const STUDIO = ["Seven templates, from a plain one-column classic to an executive serif", "Fonts, accent colour, size, spacing and margins; Letter or A4", "Live preview, section reordering, version history", "PDF, Word, plain text and JSON export", "An ATS check that tells you when a layout could scramble in an applicant system"];

export default async function LandingPage() {
  // Only a session the API still accepts goes to the dashboard. A stale cookie used to make the landing page unreachable.
  if ((await cookies()).get("jg_session")?.value) {
    const signedIn = await api.session().then(() => true, () => false);
    if (signedIn) redirect("/dashboard");
  }
  return (
    <>
      {/* ---------------------------------------------------------------- hero */}
      <div className="relative overflow-clip text-[#3b2410]">
        <MeadowBackdrop />
        <header className="relative z-30 mx-auto flex h-20 w-full max-w-[1240px] items-center justify-between px-4 sm:px-8">
          <Link href="/" aria-label="Nori home"><NoriLogo size={42} /></Link>
          <nav aria-label="Main" className="flex items-center gap-1 text-[14px] font-medium">
            <a href="#how" className="hidden rounded-lg px-3 py-2 text-[#5b4630] transition-colors hover:text-[#2b1608] md:inline">How it works</a>
            <a href="#trust" className="hidden rounded-lg px-3 py-2 text-[#5b4630] transition-colors hover:text-[#2b1608] md:inline">Why trust it</a>
            <a href="#studio" className="hidden rounded-lg px-3 py-2 text-[#5b4630] transition-colors hover:text-[#2b1608] md:inline">Resume studio</a>
            <span className="ml-2 hidden text-[#5b4630] sm:inline">Already have an account?</span>
            <Link href="/login" className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 font-semibold text-[#2b1608] transition-colors hover:text-[#5a2a12]">Sign in <ArrowRight size={16} aria-hidden="true" /></Link>
          </nav>
        </header>

        <section className="relative z-10 mx-auto grid w-full max-w-[1240px] gap-x-10 gap-y-2 px-4 pb-10 pt-2 sm:px-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,480px)] lg:grid-rows-[auto_1fr] lg:pt-6">
          <div className="order-1 lg:col-start-1 lg:row-start-1">
            <p className="ob-rise inline-flex items-center gap-2 rounded-full bg-[#fff3c4]/90 px-4 py-2 text-[13.5px] font-medium text-[#6b4a10] shadow-sm"><Sparkles size={15} aria-hidden="true" className="text-[#f2a900]" />Your career, your way</p>
            <h1 className="mt-5 font-display text-[3.2rem] font-semibold leading-[0.9] tracking-[-0.04em] text-[#4a2410] sm:text-[4.7rem]">
              Hi there,<br />
              <span className="bg-gradient-to-r from-[#f7b500] to-[#f39a00] bg-clip-text text-transparent">new friend.</span>
            </h1>
            <p className="ob-rise mt-5 max-w-[46ch] text-[17px] leading-relaxed text-[#5b4630]" style={{ ["--i" as string]: 6 }}>
              Create your account and I will build your career graph, find roles that fit, and tailor every application. Each line traces back to something you really did, and nothing is sent until you say so.
            </p>
            <ul className="ob-rise mt-5 grid max-w-[560px] gap-3 sm:grid-cols-3" style={{ ["--i" as string]: 8 }}>
              {[[UserRound, "Personalized", "career graph"], [Star, "Curated", "opportunities"], [Zap, "Tailored", "applications"]].map(([I, a, b]) => {
                const Ic = I as typeof UserRound;
                return (
                  <li key={a as string} className="flex items-center gap-3">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#fff0b8] text-[#e59a00] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"><Ic size={22} aria-hidden="true" fill={a === "Curated" || a === "Tailored" ? "currentColor" : "none"} /></span>
                    <span className="text-[14px] leading-tight text-[#4a3722]"><span className="block">{a as string}</span><span className="block">{b as string}</span></span>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="order-2 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:pt-2"><AuthCard mode="signup" /></div>
          <div className="order-3 lg:col-start-1 lg:row-start-2 lg:self-end"><NoriBuddy className="mx-auto w-full max-w-[440px] lg:-ml-2 lg:-mb-2" /></div>
        </section>

        <div className="relative z-10 mx-auto w-full max-w-[1180px] px-4 pb-16 sm:px-8">
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
      <div className="relative overflow-clip text-[#3b2410]">
        <MeadowBackdrop />
        <section className="relative z-10 mx-auto w-full max-w-[1180px] px-4 py-24 text-center sm:px-8 sm:py-32">
          <h2 className="mx-auto max-w-[18ch] font-display text-[2.4rem] font-semibold leading-[1] tracking-[-0.05em] text-[#4a2410] sm:text-[4rem]">Start with your resume. <span className="bg-gradient-to-r from-[#f7b500] to-[#f39a00] bg-clip-text text-transparent">Nori does the rest.</span></h2>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <a href="#start" className="group inline-flex items-center gap-2 rounded-full bg-[#5a2a12] px-8 py-3.5 text-[16px] font-semibold text-white shadow-[0_14px_30px_-12px_rgba(90,42,18,0.7)] transition-transform duration-150 hover:-translate-y-0.5">
              Create your account <ArrowRight size={18} aria-hidden="true" className="transition-transform duration-150 group-hover:translate-x-1" />
            </a>
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-[#5a2a12]/20 bg-white/60 px-7 py-3.5 text-[16px] font-medium text-[#4a2410] backdrop-blur transition-colors duration-150 hover:bg-white/90">
              <GitBranch size={17} aria-hidden="true" />Read the source
            </a>
          </div>
        </section>
        <div className="relative z-10"><PublicFooter /></div>
      </div>
    </>
  );
}
