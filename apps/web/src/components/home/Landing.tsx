import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Check, CircleAlert, FileText, KeyRound, Network, ScanSearch, ShieldCheck, Sparkles, Trash2, UserCheck, X, type LucideIcon } from "lucide-react";
import { cx } from "@/components/cx";
import { NoriBuddy } from "./NoriBuddy";
import { btnPrimary, btnSecondary, btnSun, chip, container } from "./styles";

/* ------------------------------------------------------------------ hero */

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="bg-cream">
      <div className={cx(container, "grid items-center gap-10 py-12 sm:py-16 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-14 lg:py-20")}>
        <div>
          <p className={chip}><Sparkles size={14} aria-hidden="true" className="text-[#b07a00]" />Open-source job agent</p>
          <h1 id="hero-title" className="mt-5 max-w-[14ch] font-display text-[2.6rem] font-semibold leading-[1.02] tracking-[-0.035em] text-bark sm:text-[3.6rem] lg:text-[4.1rem]">
            A job agent that cannot lie about you.
          </h1>
          <p className="mt-5 max-w-[48ch] text-[17px] leading-relaxed text-bark-2">
            Nori turns your resume into a career graph, finds roles that fit, and tailors each application. Every line traces back to
            something you really did, and nothing is sent until you approve it.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/signup" className={btnPrimary}>Create your account<ArrowRight size={18} aria-hidden="true" /></Link>
            <a href="#how" className={btnSecondary}>See how it works</a>
          </div>
          <ul className="mt-8 grid gap-3 text-[14.5px] text-bark-2 sm:grid-cols-3">
            {["Free and open source", "Your own model key, or a local one", "You approve every send"].map((t) => (
              <li key={t} className="flex items-start gap-2"><Check size={18} aria-hidden="true" className="mt-px shrink-0 text-sage" />{t}</li>
            ))}
          </ul>
        </div>
        <HeroArt />
      </div>
    </section>
  );
}

/** The mascot in its own sunny frame, with a sample of what waits for the person. Nothing sits behind text. */
function HeroArt() {
  return (
    <div className="relative overflow-hidden rounded-[28px] border border-rule bg-sun-soft">
      <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(circle_at_75%_15%,#fffaf0_0%,#fff1c2_45%,#ffe39a_100%)]" />
      <NoriBuddy className="relative mx-auto block h-auto w-full max-w-[460px] px-4 pt-6" signText={["Hi there,", "new", "friend!"]} note={["Takes about", "a minute."]} />
      <div className="relative mx-4 mb-4 rounded-2xl border border-rule bg-white p-4 sm:mx-6 sm:mb-6 sm:p-5" role="group" aria-label="Sample: an application waiting for your approval">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-sage-soft px-2.5 py-1 text-[12px] font-semibold text-sage"><UserCheck size={14} aria-hidden="true" />Waiting on you</span>
          <span className="text-[12px] text-bark-3">Sample</span>
        </div>
        <p className="mt-3 text-[15px] font-semibold text-bark">Frontend Engineer, Design Systems</p>
        <p className="mt-0.5 text-[13.5px] text-bark-3">Tidewater &middot; Resume tailored &middot; 6 changes, each with its source</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ proof strip */

const PROOF: [LucideIcon, string][] = [
  [ScanSearch, "Greenhouse, Lever, Ashby and SmartRecruiters"],
  [KeyRound, "Bring your own key or run locally"],
  [ShieldCheck, "Nothing sent without your approval"],
  [Trash2, "Export or delete everything, anytime"],
];

export function ProofStrip() {
  return (
    <div className="border-y border-rule bg-white">
      <ul className={cx(container, "grid gap-x-6 gap-y-3 py-5 sm:grid-cols-2 lg:grid-cols-4")}>
        {PROOF.map(([Icon, text]) => (
          <li key={text} className="flex items-center gap-3 text-[14px] font-medium text-bark-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sun-soft text-brand"><Icon size={18} aria-hidden="true" /></span>
            {text}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ sections */

function SectionTitle({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <div className="max-w-[44rem]">
      <p className={chip}>{eyebrow}</p>
      <h2 id={id} className="mt-4 scroll-mt-6 font-display text-[2rem] font-semibold leading-[1.05] tracking-[-0.03em] text-bark sm:text-[2.75rem]">{title}</h2>
      {children && <p className="mt-4 text-[16.5px] leading-relaxed text-bark-2">{children}</p>}
    </div>
  );
}

const STEPS: [LucideIcon, string, string][] = [
  [Network, "It reads your history", "Add your resume once. Nori builds a career graph of your roles, projects, skills and results, and keeps a link from every fact to where it came from."],
  [ScanSearch, "It finds and ranks roles", "Public postings are scored against your graph, with the reasons shown: what matches, what is missing, and what rules a role out."],
  [FileText, "It tailors, then asks", "For each role it rewrites your resume from evidence only and fills the form, then stops. You review both and approve before anything is sent."],
];

export function HowItWorks() {
  return (
    <section aria-labelledby="how" className="bg-cream py-16 sm:py-24">
      <div className={container}>
        <SectionTitle id="how" eyebrow="How it works" title="From resume to sent, with you in charge.">Three steps, and you decide at the end of each one.</SectionTitle>
        <ol className="mt-10 grid gap-5 md:grid-cols-3">
          {STEPS.map(([Icon, title, body], i) => (
            <li key={title} className="rounded-3xl border border-rule bg-white p-6 sm:p-7">
              <div className="flex items-center justify-between">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand text-white"><Icon size={22} aria-hidden="true" /></span>
                <span className="text-[13px] font-semibold text-bark-3">Step {i + 1}</span>
              </div>
              <h3 className="mt-5 font-display text-[1.35rem] font-semibold tracking-[-0.02em] text-bark">{title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-bark-2">{body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

const PROMISES: [LucideIcon, string, string][] = [
  [ShieldCheck, "Nothing is invented", "A rewritten line is accepted only if every number, tool and employer in it appears in your own graph. A line that fails is replaced by one you can prove."],
  [UserCheck, "You hold the gate", "Resume review and form review are on by default. Edit the resume, change an answer or skip the role at any point."],
  [Trash2, "Yours to take", "Export your graph and any resume, or delete the account and everything with it. Nori is open source and can run on a local model."],
];

export function PromiseSection() {
  return (
    <section aria-labelledby="promise" className="border-y border-rule bg-sand py-16 sm:py-24">
      <div className={container}>
        <SectionTitle id="promise" eyebrow="The promise" title="Built to be trusted with your name.">
          Most tools hand you a flat resume and a prompt. Nori keeps a graph of what you did, so every claim has a source and a refusal has a reason.
        </SectionTitle>

        <div className="mt-10 grid overflow-hidden rounded-3xl border border-rule bg-white md:grid-cols-2" role="group" aria-label="Example: one rewritten line is accepted because it traces to your graph, another is refused">
          <div className="p-6 sm:p-8">
            <p className="inline-flex items-center gap-2 rounded-full bg-sage-soft px-2.5 py-1 text-[12.5px] font-semibold text-sage"><Check size={14} aria-hidden="true" />Accepted</p>
            <p className="mt-4 font-display text-[1.3rem] font-semibold leading-snug tracking-[-0.015em] text-bark">Rebuilt the dashboard in React and Next.js, cutting p95 load from 4.2s to 1.1s.</p>
            <p className="mt-4 text-[14px] text-bark-3">Traced to <span className="font-semibold text-bark-2">Senior Frontend Engineer at Lumen Analytics</span> in your career graph.</p>
          </div>
          <div className="border-t border-rule bg-berry-soft p-6 sm:p-8 md:border-l md:border-t-0">
            <p className="inline-flex items-center gap-2 rounded-full bg-white px-2.5 py-1 text-[12.5px] font-semibold text-berry"><X size={14} aria-hidden="true" />Refused</p>
            <p className="mt-4 font-display text-[1.3rem] font-semibold leading-snug tracking-[-0.015em] text-bark-2 line-through decoration-berry">Managed a team of 40 engineers.</p>
            <p className="mt-4 flex items-start gap-2 text-[14px] text-berry"><CircleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />&ldquo;team of 40&rdquo; is not anywhere in your graph, so the line is replaced by the nearest one you can prove.</p>
          </div>
        </div>

        <ul className="mt-6 grid gap-5 md:grid-cols-3">
          {PROMISES.map(([Icon, title, body]) => (
            <li key={title} className="rounded-3xl border border-rule bg-white p-6">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-sun-soft text-brand"><Icon size={20} aria-hidden="true" /></span>
              <h3 className="mt-4 font-display text-[1.2rem] font-semibold tracking-[-0.015em] text-bark">{title}</h3>
              <p className="mt-2 text-[14.5px] leading-relaxed text-bark-2">{body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ resume studio */

const STUDIO = [
  "Seven templates, from a plain one-column classic to an executive serif",
  "Fonts, accent colour, size, spacing and margins; Letter or A4",
  "Live preview, section reordering and version history",
  "PDF, Word, plain text and JSON export",
  "An ATS check that warns when a layout could scramble in an applicant system",
];

const line = (w: string, c = "bg-[#e3d8c4]", h = "h-[3px]") => <span className={cx("block rounded-full", c, h)} style={{ width: w }} />;

/** A tiny drawing of one resume template. Decorative: the list item's caption names it. */
function Sheet({ id }: { id: string }) {
  const lines = (n: number, c?: string) => Array.from({ length: n }, (_, i) => <span key={i} className="mt-[5px] block">{line(`${92 - ((i * 13) % 34)}%`, c)}</span>);
  const body: Record<string, ReactNode> = {
    classic: <div className="p-3"><div className="mx-auto w-2/3">{line("100%", "bg-bark", "h-[6px]")}</div><div className="mt-3 border-t border-rule-strong" />{lines(3)}<div className="mt-3 border-t border-rule-strong" />{lines(3)}</div>,
    modern: <div><div className="h-9 bg-brand p-2.5">{line("55%", "bg-white", "h-[6px]")}</div><div className="p-3">{lines(3)}<div className="mt-3 w-1/3">{line("100%", "bg-sun", "h-[4px]")}</div>{lines(3)}</div></div>,
    compact: <div className="p-2.5">{line("45%", "bg-bark", "h-[5px]")}{lines(10)}</div>,
    executive: <div className="p-3 text-center"><div className="mx-auto w-3/4">{line("100%", "bg-bark", "h-[7px]")}</div><div className="mx-auto mt-2 w-1/3 border-t-2 border-sun" />{lines(7)}</div>,
    minimal: <div className="p-4">{line("38%", "bg-bark-2", "h-[5px]")}<div className="mt-5" />{lines(4)}<div className="mt-5" />{lines(3)}</div>,
    technical: <div className="p-3">{line("50%", "bg-bark", "h-[5px]")}<div className="mt-2 flex gap-1">{["w-5", "w-7", "w-4", "w-6"].map((w, i) => <span key={i} className={cx("h-[7px] rounded-sm bg-sun-soft", w)} />)}</div>{lines(7)}</div>,
    sidebar: <div className="flex h-full"><div className="w-[34%] bg-bark p-2.5">{line("100%", "bg-white", "h-[5px]")}<div className="mt-3" />{lines(5, "bg-bark-3")}</div><div className="flex-1 p-2.5">{lines(9)}</div></div>,
  };
  return <div aria-hidden="true" className="aspect-[3/4] overflow-hidden rounded-lg border border-rule bg-white">{body[id]}</div>;
}

const TEMPLATES = [["classic", "Classic"], ["modern", "Modern"], ["compact", "Compact"], ["executive", "Executive"], ["minimal", "Minimal"], ["technical", "Technical"], ["sidebar", "Sidebar"]] as const;

export function Studio() {
  return (
    <section aria-labelledby="studio" className="bg-cream py-16 sm:py-24">
      <div className={cx(container, "grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]")}>
        <div>
          <SectionTitle id="studio" eyebrow="Resume studio" title="A resume studio, not a template.">
            Edit your resume as a document, change the look in one click, and keep every version. Each application gets its own tailored copy that you can still edit before you approve it.
          </SectionTitle>
          <ul className="mt-8 space-y-3 text-[15px] text-bark-2">
            {STUDIO.map((t) => <li key={t} className="flex gap-3"><Check size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-sage" />{t}</li>)}
          </ul>
        </div>
        <div className="rounded-3xl border border-rule bg-sand p-5 sm:p-8">
          <ul className="grid grid-cols-3 gap-4 sm:grid-cols-4" aria-label="The seven resume templates">
            {TEMPLATES.map(([id, name]) => (
              <li key={id}>
                <Sheet id={id} />
                <p className="mt-2 text-center text-[13px] font-medium text-bark-2">{name}</p>
              </li>
            ))}
            <li className="flex aspect-[3/4] flex-col items-center justify-center rounded-lg border-2 border-dashed border-rule-strong bg-white p-2 text-center">
              <Sparkles size={20} aria-hidden="true" className="text-[#b07a00]" />
              <span className="mt-1 text-[12px] font-semibold leading-tight text-bark-2">Fonts, colours, margins</span>
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ final call */

export function FinalCall() {
  return (
    <section aria-labelledby="final-title" className="bg-bark py-16 text-cream sm:py-24">
      <div className={cx(container, "text-center")}>
        <h2 id="final-title" className="mx-auto max-w-[20ch] font-display text-[2.2rem] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-[3.2rem]">
          Start with your resume. Nori does the rest.
        </h2>
        <p className="mx-auto mt-4 max-w-[46ch] text-[16.5px] leading-relaxed text-[#e9dcc4]">It takes about a minute to set up, and nothing leaves your account until you say so.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/signup" className={btnSun}>Create your account<ArrowRight size={18} aria-hidden="true" /></Link>
          <Link href="/login" className="inline-flex h-12 items-center rounded-full px-5 text-[15px] font-semibold text-cream underline decoration-[#8a7356] underline-offset-4 hover:decoration-cream focus-visible:outline focus-visible:outline-2 focus-visible:outline-sun">I already have an account</Link>
        </div>
      </div>
    </section>
  );
}
