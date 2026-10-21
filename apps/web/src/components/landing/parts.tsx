import type { ReactNode } from "react";
import { Check, CircleAlert, FileText, Network, ScanSearch, ShieldCheck, Sparkles, X } from "lucide-react";
import { cx } from "../cx";

/* ------------------------------------------------------------------ small pieces */

const MARQUEE = ["Greenhouse", "Lever", "Ashby", "SmartRecruiters", "Open source", "Runs on a local model", "Bring your own key", "You approve every send", "Export or delete anytime"];

/** Endless strip under the hero. Paused on hover, static for reduced motion. */
export function Marquee() {
  const row = (hidden: boolean) => (
    <ul className="flex shrink-0 items-center" aria-hidden={hidden || undefined}>
      {MARQUEE.map((t) => (
        <li key={t} className="flex items-center whitespace-nowrap text-[13.5px] font-medium text-ink-2">
          <span aria-hidden="true" className="mx-7 bg-gradient-to-br from-emerald-500 to-amber-400 bg-clip-text text-[15px] text-transparent">&#10022;</span>
          {t}
        </li>
      ))}
    </ul>
  );
  return (
    <div className="relative overflow-hidden border-y border-black/5 bg-white py-4" aria-label="Where Nori works and what it promises">
      <div className="dash-marquee">{row(false)}{row(true)}</div>
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-white to-transparent" />
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-white to-transparent" />
    </div>
  );
}

function Ring({ value, size = 44 }: { value: number; size?: number }) {
  const r = 17;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 44 44" width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx="22" cy="22" r={r} fill="none" stroke="currentColor" strokeOpacity=".14" strokeWidth="5" />
        <circle cx="22" cy="22" r={r} fill="none" stroke="url(#peek-grad)" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${(c * value) / 100} ${c}`} />
        <defs><linearGradient id="peek-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#6ef0b3" /><stop offset="1" stopColor="#ffb347" /></linearGradient></defs>
      </svg>
      <span className="absolute text-[12px] font-semibold tnum text-white">{value}</span>
    </span>
  );
}

/** A small, illustrative picture of the product. Sample data, labelled as such. */
export function ProductPeek() {
  const roles = [
    { co: "Northpoint", title: "Senior Frontend Engineer", score: 89, hue: "from-violet-400 to-indigo-500" },
    { co: "Quarry", title: "Staff Frontend Engineer", score: 82, hue: "from-amber-300 to-orange-500" },
    { co: "Sundial", title: "Software Engineer, Web", score: 76, hue: "from-rose-400 to-pink-500" },
  ];
  return (
    <div className="dash-glass mx-auto w-full max-w-[1000px] rounded-[28px] p-3 shadow-[0_40px_90px_-40px_rgba(0,0,0,0.8)] sm:p-4" role="img" aria-label="A sample of the Nori dashboard: roles ranked against your graph, applications waiting for your review">
      <div className="rounded-[22px] bg-[#071611]/80 p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2" aria-hidden="true"><span className="h-2.5 w-2.5 rounded-full bg-rose-400/80" /><span className="h-2.5 w-2.5 rounded-full bg-amber-300/80" /><span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" /></div>
          <span className="rounded-full bg-white/10 px-3 py-1 text-[11px] font-medium text-white/60">Sample data</span>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-[1.25fr_1fr]">
          <div className="rounded-2xl bg-white/[0.05] p-4 ring-1 ring-white/10">
            <p className="text-[12px] font-medium text-white/50">Roles worth your time</p>
            <ul className="mt-3 space-y-2.5">
              {roles.map((r) => (
                <li key={r.title} className="flex items-center gap-3 rounded-xl bg-white/[0.05] p-2.5">
                  <span className={cx("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-[15px] font-semibold text-white", r.hue)}>{r.co[0]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-white">{r.title}</span>
                    <span className="block text-[12px] text-white/50">{r.co} &middot; Remote</span>
                  </span>
                  <Ring value={r.score} />
                </li>
              ))}
            </ul>
          </div>
          <div className="grid gap-4">
            <div className="grid grid-cols-3 gap-2.5">
              {[["14", "Applied"], ["4", "Replies"], ["2", "Interviews"]].map(([n, l]) => (
                <div key={l} className="rounded-2xl bg-white/[0.05] p-3 ring-1 ring-white/10">
                  <p className="font-display text-[1.7rem] font-medium leading-none tracking-[-0.04em] text-white">{n}</p>
                  <p className="mt-1.5 text-[11.5px] text-white/50">{l}</p>
                </div>
              ))}
            </div>
            <div className="rounded-2xl bg-gradient-to-br from-amber-300/15 to-rose-400/10 p-4 ring-1 ring-amber-200/20">
              <p className="flex items-center gap-2 text-[12px] font-semibold text-amber-200"><CircleAlert size={14} aria-hidden="true" />Waiting on you</p>
              <p className="mt-2 text-[14px] font-medium text-white">Frontend Engineer, Design Systems</p>
              <p className="text-[12px] text-white/55">Resume ready &middot; ATS 96 &middot; 6 changes, each with its source</p>
              <span className="mt-3 inline-flex h-8 items-center rounded-full bg-white px-4 text-[12.5px] font-semibold text-[#071611]">Review and approve</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ sections */

export function SectionTitle({ eyebrow, title, children, center = false }: { eyebrow: string; title: ReactNode; children?: ReactNode; center?: boolean }) {
  return (
    <div className={cx("max-w-[44rem]", center && "mx-auto text-center")}>
      <p className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-[12px] font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-600/15">{eyebrow}</p>
      <h2 className="mt-4 font-display text-[2rem] font-medium leading-[1.02] tracking-[-0.04em] text-ink sm:text-[3rem]">{title}</h2>
      {children && <p className="mt-4 text-[16px] leading-relaxed text-ink-2">{children}</p>}
    </div>
  );
}

const STEPS = [
  { icon: Network, hue: "from-emerald-400 to-teal-500", title: "It reads your history", body: "Add your resume once. Nori builds a career graph of your roles, projects, skills and results, and keeps a link from every fact back to where it came from." },
  { icon: ScanSearch, hue: "from-sky-400 to-indigo-500", title: "It finds and ranks roles", body: "Public postings on Greenhouse, Lever, Ashby and SmartRecruiters are scored against your graph, with the reasons shown: what matches, what is missing, what rules a role out." },
  { icon: FileText, hue: "from-amber-300 to-orange-500", title: "It tailors, then asks", body: "For each role it rewrites your resume from evidence only, fills the application form, and stops. You review the resume, then the form, and approve before anything is sent." },
] as const;

export function Steps() {
  return (
    <ol className="relative mt-12 grid gap-5 md:grid-cols-3">
      <span aria-hidden="true" className="pointer-events-none absolute left-[16%] right-[16%] top-[3.1rem] hidden h-px bg-gradient-to-r from-transparent via-emerald-500/40 to-transparent md:block" />
      {STEPS.map((s, i) => (
        <li key={s.title} className="dash-card dash-lift reveal relative p-7" style={{ ["--i" as string]: i }}>
          <span className={cx("flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-lg", s.hue)}><s.icon size={26} strokeWidth={1.6} aria-hidden="true" /></span>
          <p className="mt-5 text-[12px] font-semibold text-muted tnum">Step {i + 1}</p>
          <h3 className="mt-1 font-display text-[1.4rem] font-medium tracking-[-0.025em] text-ink">{s.title}</h3>
          <p className="mt-2.5 text-[15px] leading-relaxed text-ink-2">{s.body}</p>
        </li>
      ))}
    </ol>
  );
}

/** The promise, shown instead of told: a line that traces to the graph and one that is refused. */
export function ProvenanceDemo() {
  return (
    <div className="dash-card reveal mt-12 grid gap-0 overflow-hidden md:grid-cols-2" role="group" aria-label="Example: one rewritten line is accepted because it traces to your graph, another is refused">
      <div className="p-7 sm:p-8">
        <p className="flex items-center gap-2 text-[12px] font-semibold text-emerald-700"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100"><Check size={14} aria-hidden="true" /></span>Accepted</p>
        <p className="mt-4 font-display text-[1.3rem] font-medium leading-snug tracking-[-0.02em] text-ink">Rebuilt the dashboard in React and Next.js, cutting p95 load from 4.2s to 1.1s.</p>
        <ul className="mt-5 flex flex-wrap gap-2 text-[12.5px]">
          {["React", "Next.js", "4.2s to 1.1s"].map((t) => <li key={t} className="rounded-full bg-emerald-50 px-3 py-1 font-medium text-emerald-800 ring-1 ring-inset ring-emerald-600/15">{t}</li>)}
        </ul>
        <p className="mt-4 text-[13px] text-muted">Traced to <span className="font-medium text-ink-2">Senior Frontend Engineer at Lumen Analytics</span> in your career graph.</p>
      </div>
      <div className="border-t border-black/5 bg-gradient-to-br from-rose-50/70 to-white p-7 sm:p-8 md:border-l md:border-t-0">
        <p className="flex items-center gap-2 text-[12px] font-semibold text-rose-700"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-rose-100"><X size={14} aria-hidden="true" /></span>Refused</p>
        <p className="mt-4 font-display text-[1.3rem] font-medium leading-snug tracking-[-0.02em] text-ink-2 line-through decoration-rose-400/60">Managed a team of 40 engineers.</p>
        <p className="mt-5 inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-[13px] text-rose-800 shadow-sm ring-1 ring-rose-200/70"><CircleAlert size={15} aria-hidden="true" />&ldquo;team of 40&rdquo; is not anywhere in your graph.</p>
        <p className="mt-4 text-[13px] text-muted">Replaced by the nearest line you can prove. Nothing is invented, ever.</p>
      </div>
    </div>
  );
}

const TRUST = [
  { icon: ShieldCheck, hue: "from-emerald-400 to-teal-500", title: "Nothing is invented", body: "A rewritten line is accepted only if every number, tool and employer in it appears in your own graph. A line that fails the check is replaced by a safer one." },
  { icon: Sparkles, hue: "from-amber-300 to-orange-500", title: "You hold the gate", body: "Resume review and form review are on by default. You can edit the resume, change an answer or skip the role at any point." },
  { icon: Network, hue: "from-violet-400 to-indigo-500", title: "Yours to take", body: "Export your graph and any resume, or delete the account and everything with it. Nori is open source and can run on a local model." },
] as const;

export function Trust() {
  return (
    <ul className="mt-10 grid gap-5 md:grid-cols-3">
      {TRUST.map((p, i) => (
        <li key={p.title} className="reveal rounded-3xl border border-black/5 bg-white/70 p-6 backdrop-blur" style={{ ["--i" as string]: i }}>
          <span className={cx("flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md", p.hue)}><p.icon size={20} strokeWidth={1.7} aria-hidden="true" /></span>
          <h3 className="mt-4 font-display text-[1.2rem] font-medium tracking-[-0.02em] text-ink">{p.title}</h3>
          <p className="mt-2 text-[14.5px] leading-relaxed text-ink-2">{p.body}</p>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ resume studio */

const bar = (w: string, c = "bg-black/15", h = "h-[3px]") => <span className={cx("block rounded-full", c, h)} style={{ width: w }} />;

function Sheet({ id }: { id: string }) {
  const lines = (n: number, c?: string) => Array.from({ length: n }, (_, i) => <span key={i} className="mt-[5px]">{bar(`${92 - ((i * 13) % 34)}%`, c)}</span>);
  const body: Record<string, ReactNode> = {
    classic: <div className="p-3"><div className="mx-auto w-2/3">{bar("100%", "bg-ink/80", "h-[6px]")}</div><div className="mx-auto mt-1.5 w-1/2">{bar("100%")}</div><div className="mt-3 border-t border-black/30" />{lines(3)}<div className="mt-3 border-t border-black/30" />{lines(3)}</div>,
    modern: <div><div className="h-9 bg-gradient-to-r from-emerald-500 to-teal-400 p-2.5">{bar("55%", "bg-white", "h-[6px]")}</div><div className="p-3">{lines(3)}<div className="mt-3 w-1/3">{bar("100%", "bg-emerald-500/70", "h-[4px]")}</div>{lines(3)}</div></div>,
    compact: <div className="p-2.5">{bar("45%", "bg-ink/80", "h-[5px]")}{lines(10)}</div>,
    executive: <div className="p-3 text-center"><div className="mx-auto w-3/4">{bar("100%", "bg-ink/85", "h-[7px]")}</div><div className="mx-auto mt-2 w-1/3 border-t-2 border-amber-600/70" />{lines(7)}</div>,
    minimal: <div className="p-4">{bar("38%", "bg-ink/70", "h-[5px]")}<div className="mt-5" />{lines(4, "bg-black/10")}<div className="mt-5" />{lines(3, "bg-black/10")}</div>,
    technical: <div className="p-3">{bar("50%", "bg-ink/80", "h-[5px]")}<div className="mt-2 flex gap-1">{["w-5", "w-7", "w-4", "w-6"].map((w, i) => <span key={i} className={cx("h-[7px] rounded-sm bg-indigo-500/25", w)} />)}</div>{lines(7)}</div>,
    sidebar: <div className="flex h-full"><div className="w-[34%] bg-gradient-to-b from-indigo-700 to-indigo-900 p-2.5">{bar("100%", "bg-white/80", "h-[5px]")}<div className="mt-3" />{lines(5, "bg-white/40")}</div><div className="flex-1 p-2.5">{lines(9)}</div></div>,
  };
  return <div className="aspect-[3/4] overflow-hidden rounded-lg bg-white shadow-[0_14px_30px_-14px_rgba(20,19,17,0.45)] ring-1 ring-black/10">{body[id]}</div>;
}

const TEMPLATES = [["classic", "Classic"], ["modern", "Modern"], ["compact", "Compact"], ["executive", "Executive"], ["minimal", "Minimal"], ["technical", "Technical"], ["sidebar", "Sidebar"]] as const;

export function Templates() {
  return (
    <ul className="grid grid-cols-3 gap-4 sm:grid-cols-4 sm:gap-5" aria-label="The seven resume templates">
      {TEMPLATES.map(([id, name], i) => (
        <li key={id} className="reveal group" style={{ ["--i" as string]: i }}>
          <div className="transition-transform duration-300 group-hover:-translate-y-1.5 group-hover:rotate-[-1.5deg]"><Sheet id={id} /></div>
          <p className="mt-2 text-center text-[13px] font-medium text-ink-2">{name}</p>
        </li>
      ))}
      <li className="reveal flex aspect-[3/4] flex-col items-center justify-center rounded-lg border-2 border-dashed border-emerald-600/30 bg-emerald-50/50 p-2 text-center" style={{ ["--i" as string]: 7 }}>
        <span aria-hidden="true" className="bg-gradient-to-br from-emerald-500 to-amber-400 bg-clip-text text-[22px] text-transparent">&#10022;</span>
        <span className="mt-1 text-[12px] font-semibold leading-tight text-emerald-900">Fonts, colours, margins</span>
      </li>
    </ul>
  );
}
