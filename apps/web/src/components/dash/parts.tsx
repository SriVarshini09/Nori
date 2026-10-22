import Link from "next/link";
import { useId, type ReactNode } from "react";
import {
  ArrowRight, ArrowUpRight, Briefcase, CalendarClock, Clock, MessageSquareReply, PartyPopper, Send, Sparkles, Timer, TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { AgentActivity, AgentActivityKind, AgentStatus, ApplicationListItem, ApplicationStatus, JobWithMatch } from "@/lib/types";
import { pct, STATUS_LABEL } from "@/lib/format";
import { KIND_ICON, ago, headline, inMin } from "../agent/kinds";
import { TimeAgo } from "../TimeAgo";
import { cx } from "../cx";
import { Monogram } from "../Monogram";
import { CountUp, DashApply } from "./client";
import { Doll } from "./Doll";
import { Tilt } from "./Tilt";

/* ------------------------------------------------------------------ shared bits */

type Hue = "jade" | "sky" | "iris" | "sun" | "coral" | "slate";
const HUE_CHIP: Record<Hue, string> = {
  jade: "bg-emerald-50 text-emerald-700 ring-emerald-600/15",
  sky: "bg-sky-50 text-sky-700 ring-sky-600/15",
  iris: "bg-violet-50 text-violet-700 ring-violet-600/15",
  sun: "bg-amber-50 text-amber-700 ring-amber-600/20",
  coral: "bg-rose-50 text-rose-700 ring-rose-600/15",
  slate: "bg-stone text-ink-2 ring-black/5",
};
const HUE_ICON: Record<Hue, string> = {
  jade: "from-emerald-400 to-teal-500",
  sky: "from-sky-400 to-blue-500",
  iris: "from-violet-400 to-indigo-500",
  sun: "from-amber-300 to-orange-500",
  coral: "from-rose-400 to-orange-500",
  slate: "from-stone-400 to-stone-500",
};

const STATUS_HUE: Record<ApplicationStatus, Hue> = {
  queued: "slate", tailoring: "sky", filling: "sky", submitting: "sky",
  resume_review: "sun", form_review: "sun", awaiting_code: "sun", needs_user: "coral",
  submitted: "jade", viewed: "jade", replied: "iris", interview: "iris", offer: "jade",
  failed: "coral", rejected: "slate", skipped: "slate",
};

function Chip({ hue, children, live }: { hue: Hue; children: ReactNode; live?: boolean }) {
  return (
    <span className={cx("inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[12px] font-medium ring-1 ring-inset", HUE_CHIP[hue])}>
      <span className={cx("h-1.5 w-1.5 rounded-full bg-current", live && "animate-pulse")} />
      {children}
    </span>
  );
}

function CardHead({ title, hint, href, cta = "View all", icon: I }: { title: string; hint?: string; href?: string; cta?: string; icon?: LucideIcon }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex items-center gap-3">
        {I && <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-stone text-ink-2"><I size={17} strokeWidth={1.6} aria-hidden="true" /></span>}
        <div>
          <h2 className="font-display text-[19px] font-medium leading-tight tracking-[-0.02em] text-ink">{title}</h2>
          {hint && <p className="mt-0.5 text-meta text-muted">{hint}</p>}
        </div>
      </div>
      {href && (
        <Link href={href} className="group inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-[12.5px] font-medium text-ink-2 transition-colors duration-150 hover:bg-stone hover:text-ink">
          {cta}
          <ArrowRight size={14} aria-hidden="true" className="transition-transform duration-150 group-hover:translate-x-0.5" />
        </Link>
      )}
    </div>
  );
}

/** Circular progress with a gradient stroke that draws itself in. */
function GradRing({ value, size = 96, stroke = 9, from, to, children }: { value: number; size?: number; stroke?: number; from: string; to: string; children?: ReactNode }) {
  const id = useId();
  const p = Math.max(0, Math.min(100, value));
  const r = 50 - stroke / 2;
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" width={size} height={size} className="-rotate-90" aria-hidden="true">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={from} />
            <stop offset="100%" stopColor={to} />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" strokeOpacity="0.14" strokeWidth={stroke} />
        <circle cx="50" cy="50" r={r} fill="none" stroke={`url(#${id})`} strokeWidth={stroke} strokeLinecap="round" pathLength={100} className="dash-ring" style={{ ["--p" as string]: p }} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center">{children}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ hero */

function greeting(d: Date) {
  const h = d.getHours();
  return h < 5 ? "Burning the midnight oil" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function Hero({ first, status, week, applied, replied, interviews, hoursSaved, needsYou }: {
  first: string; status: AgentStatus | null; week: number; applied: number; replied: number; interviews: number; hoursSaved: number; needsYou: number;
}) {
  const used = status?.usedToday ?? 0;
  const cap = status?.dailyCap ?? 0;
  const capPct = cap > 0 ? Math.round((used / cap) * 100) : 0;
  const replyRate = applied > 0 ? Math.round((replied / applied) * 100) : 0;
  // Say what really happens. On a dry-run server forms are filled and never sent; with no enabled lane or a cap of 0 the
  // agent does nothing on its own. "Sent" and "applying in the background" are only true when both hold.
  const live = status?.liveSubmit === true;
  const active = !!status && cap > 0 && (status.lanes ? status.lanes.some((l) => l.enabled) : true);
  const bubbles = [
    needsYou > 0 ? `${needsYou} ${needsYou === 1 ? "thing needs" : "things need"} your OK. Tap the queue!` : "All caught up. Nice work!",
    live ? `I sent ${applied} applications this week.` : `I prepared ${applied} applications this week. Dry run: nothing was sent.`,
    replied > 0 ? `${replied} ${replied === 1 ? "company" : "companies"} replied. ${interviews > 0 ? `${interviews} interview${interviews === 1 ? "" : "s"} booked!` : "Fingers crossed."}` : "No replies yet. Give it time.",
    `Next sweep in ${inMin(status?.nextTickAt)}.`,
    "Poke me. Go on.",
  ];
  const tiles: { label: string; value: number; decimals?: number; note: string; icon: LucideIcon; hue: Hue }[] = [
    { label: live ? "Applied" : "Prepared", value: applied, note: live ? "this week" : "this week, not sent (dry run)", icon: Send, hue: "jade" },
    { label: "Replies", value: replied, note: `${replyRate}% reply rate`, icon: MessageSquareReply, hue: "sky" },
    { label: "Interviews", value: interviews, note: interviews ? "on your calendar" : "none yet", icon: CalendarClock, hue: "iris" },
    { label: "Hours saved", value: hoursSaved, decimals: 1, note: "vs applying by hand", icon: Timer, hue: "sun" },
  ];

  return (
    <section className="dash-hero relative overflow-hidden rounded-[32px] p-6 text-white shadow-[0_30px_70px_-30px_rgba(10,27,21,0.7)] sm:p-9 lg:p-10">
      <span className="dash-parallax pointer-events-none absolute inset-0">
        <span className="dash-blob -left-10 top-24 h-64 w-64 bg-emerald-400/50" />
        <span className="dash-blob -right-16 -top-10 h-80 w-80 bg-fuchsia-500/50" style={{ animationDelay: "-6s" }} />
        <span className="dash-blob bottom-[-4rem] right-1/3 h-56 w-56 bg-amber-400/30" style={{ animationDelay: "-11s" }} />
      </span>

      <div className="relative grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:items-center">
        <div className="dash-in" style={{ ["--i" as string]: 0 }}>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.07] px-3 py-1 text-[12px] font-medium text-emerald-100/90 backdrop-blur">
            <span className="relative flex h-2 w-2 text-emerald-300">
              <span className="dash-pulse absolute inset-0 rounded-full" />
              <span className="h-2 w-2 rounded-full bg-emerald-300" />
            </span>
            {!status ? "Agent offline" : active ? "Agent on" : "Agent paused"}
            <span className="text-white/35">&middot;</span>
            <span className="text-white/65">Week {week}</span>
          </div>
          <h1 className="mt-5 font-display text-[2.4rem] font-medium leading-[1.02] tracking-[-0.04em] sm:text-[3.4rem]">
            {greeting(new Date())}, <span className="dash-grad-text">{first}</span>.
          </h1>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-white/65">
            {needsYou > 0 ? (
              <>Your agent has <strong className="font-medium text-amber-200">{needsYou} {needsYou === 1 ? "thing" : "things"}</strong> waiting on you. Everything else is moving on its own.</>
            ) : (
              <>Nothing is waiting on you. {!active
                ? "The agent is paused: turn on a lane and set a daily cap in Agent settings to let it work on its own."
                : live
                  ? "The agent keeps finding, tailoring and applying in the background."
                  : "The agent keeps finding and tailoring in the background. This server runs dry: forms are filled, nothing is sent."}</>
            )}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/applications" className="dash-btn-sun group inline-flex h-11 items-center gap-2 rounded-full px-6 text-[14px] font-semibold transition-transform duration-150 hover:-translate-y-0.5">
              {needsYou > 0 ? "Review queue" : "Open applications"}
              <ArrowRight size={16} aria-hidden="true" className="transition-transform duration-150 group-hover:translate-x-0.5" />
            </Link>
            <Link href="/jobs" className="inline-flex h-11 items-center gap-2 rounded-full border border-white/20 bg-white/[0.06] px-6 text-[14px] font-medium text-white/90 backdrop-blur transition-colors duration-150 hover:bg-white/[0.13]">
              <Briefcase size={16} aria-hidden="true" /> Browse roles
            </Link>
          </div>
        </div>

        <div className="dash-hero-fade relative h-[360px] sm:h-[440px] lg:h-[500px]">
          <span aria-hidden="true" className="absolute left-1/2 top-[46%] h-[70%] w-[70%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(255,214,150,0.42),rgba(255,122,184,0.2)_55%,transparent)] blur-2xl" />
          <Doll messages={bubbles} />
          <div className="dash-glass dash-float absolute bottom-1 right-0 flex items-center gap-3 rounded-[22px] p-3 pr-4 sm:bottom-4 sm:gap-4 sm:p-4 sm:pr-5">
            <GradRing value={capPct} size={68} stroke={10} from="#6ef0b3" to="#ffb347">
              <span className="font-display text-[1.25rem] font-medium leading-none tracking-[-0.04em]"><CountUp value={used} /></span>
            </GradRing>
            <div className="min-w-0 text-[12px] leading-snug text-white/65">
              <p className="font-display text-[15px] font-medium tracking-[-0.02em] text-white">{used} of {cap || "-"} started today</p>
              <p className="mt-1 flex items-center gap-1.5"><Clock size={12} aria-hidden="true" className="text-white/45" />Swept {ago(status?.lastTickAt)}</p>
              <p className="flex items-center gap-1.5"><Sparkles size={12} aria-hidden="true" className="text-emerald-300" />Next in {inMin(status?.nextTickAt)}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="relative mt-9 grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3 sm:gap-4 lg:grid-cols-4">
        {tiles.map((t, i) => (
          <div key={t.label} className="dash-glass dash-in group rounded-[22px] p-4 transition-colors duration-200 hover:bg-white/[0.13] sm:p-5" style={{ ["--i" as string]: i + 3 }}>
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] font-medium text-white/65">{t.label}</span>
              <span className={cx("flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-lg", HUE_ICON[t.hue])}>
                <t.icon size={15} strokeWidth={1.8} aria-hidden="true" />
              </span>
            </div>
            <div className="mt-4 font-display text-[2.6rem] font-medium leading-none tracking-[-0.045em] sm:text-[3rem]">
              <CountUp value={t.value} decimals={t.decimals} />
            </div>
            <div className="mt-2 text-[12px] text-white/50">{t.note}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ needs you */

export function NeedsYou({ items }: { items: ApplicationListItem[] }) {
  if (items.length === 0) {
    return (
      <section className="dash-card reveal flex items-center gap-4 bg-gradient-to-r from-emerald-50 to-white p-5 sm:p-6" style={{ ["--i" as string]: 1 }}>
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-lg"><PartyPopper size={22} aria-hidden="true" /></span>
        <div>
          <p className="font-display text-[19px] font-medium tracking-[-0.02em]">You are all caught up</p>
          <p className="text-meta text-muted">No resumes or forms are waiting for your OK.</p>
        </div>
      </section>
    );
  }
  return (
    <section className="reveal" style={{ ["--i" as string]: 1 }}>
      <div className="mb-4 flex items-center gap-3 px-1">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-amber-300 to-orange-500 text-white shadow-md"><TriangleAlert size={16} aria-hidden="true" /></span>
        <h2 className="font-display text-[22px] font-medium tracking-[-0.025em]">Waiting on you</h2>
        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[12px] font-semibold text-amber-800">{items.length}</span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-4">
        {items.slice(0, 3).map(({ application: a, job, resume }) => {
          const hot = a.status === "needs_user";
          return (
            <Link
              key={a.id}
              href={`/applications/${a.id}`}
              className={cx(
                "dash-card dash-lift group relative flex flex-col gap-5 overflow-hidden bg-gradient-to-br p-5",
                hot ? "from-rose-50 via-white to-white" : "from-amber-50 via-white to-white",
              )}
            >
              <span aria-hidden="true" className={cx("pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full blur-2xl transition-opacity duration-300 group-hover:opacity-100", hot ? "bg-rose-300/40" : "bg-amber-300/40")} />
              <div className="relative flex items-center gap-3">
                <Monogram name={job.companyName} />
                <div className="min-w-0">
                  <p className="truncate text-[12.5px] font-medium text-muted">{job.companyName}</p>
                  <p className="truncate font-display text-[16px] font-medium leading-tight tracking-[-0.015em] text-ink" title={job.title}>{job.title}</p>
                </div>
              </div>
              <div className="relative flex items-center justify-between gap-3">
                <Chip hue={STATUS_HUE[a.status]} live>{STATUS_LABEL[a.status]}</Chip>
                {resume?.atsScore != null && <span className="text-[12.5px] text-muted">ATS <strong className="font-semibold text-ink tnum">{resume.atsScore}</strong></span>}
              </div>
              <span className="relative inline-flex h-10 items-center justify-between gap-2 rounded-full bg-ink/[0.045] pl-4 pr-1.5 text-[13px] font-medium text-ink transition-colors duration-200 group-hover:bg-ink group-hover:text-white">
                Review now
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-ink shadow-sm transition-transform duration-200 group-hover:translate-x-0.5">
                  <ArrowUpRight size={15} aria-hidden="true" />
                </span>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ pipeline */

export function Pipeline({ byStatus, inFlight, needsYou }: { byStatus: Record<string, number>; inFlight: number; needsYou: number }) {
  const n = (...k: string[]) => k.reduce((s, x) => s + (byStatus[x] ?? 0), 0);
  const applied = n("submitted", "viewed", "replied", "interview", "offer", "rejected");
  const stages = [
    { label: "Applied", value: applied, grad: "from-emerald-400 to-teal-400" },
    { label: "Seen", value: n("viewed", "replied", "interview", "offer"), grad: "from-sky-400 to-cyan-400" },
    { label: "Replied", value: n("replied", "interview", "offer"), grad: "from-indigo-400 to-sky-400" },
    { label: "Interview", value: n("interview", "offer"), grad: "from-violet-500 to-indigo-400" },
    { label: "Offer", value: n("offer"), grad: "from-amber-400 to-orange-500" },
  ];
  const top = Math.max(1, stages[0].value);
  return (
    <section className="dash-card reveal p-6 sm:p-7" style={{ ["--i" as string]: 3 }}>
      <CardHead title="Pipeline" hint="Where every application ends up" href="/tracker" cta="Tracker" icon={Briefcase} />
      <ul className="mt-7 space-y-4">
        {stages.map((s, i) => {
          const conv = i === 0 ? null : stages[i - 1].value > 0 ? Math.round((s.value / stages[i - 1].value) * 100) : 0;
          return (
            <li key={s.label}>
              <div className="mb-1.5 flex items-baseline justify-between text-[13px]">
                <span className="font-medium text-ink">{s.label}</span>
                <span className="text-muted tnum">
                  <strong className="font-display text-[17px] font-medium tracking-[-0.02em] text-ink">{s.value}</strong>
                  {conv !== null && <span className="ml-2 text-[12px]">{conv}% of previous</span>}
                </span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-stone">
                <div className={cx("dash-bar h-full rounded-full bg-gradient-to-r", s.grad)} style={{ width: `${Math.max(3, (s.value / top) * 100)}%`, ["--i" as string]: i }} />
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-6 flex flex-wrap gap-2 border-t border-black/5 pt-5">
        <Chip hue="sky" live>{inFlight} in flight</Chip>
        <Chip hue={needsYou ? "sun" : "slate"}>{needsYou} need you</Chip>
        <Chip hue="slate">{n("rejected")} closed</Chip>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ week chart */

export function WeekChart({ apps }: { apps: ApplicationListItem[] }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (6 - i));
    return { d, count: 0 };
  });
  for (const { application } of apps) {
    const t = new Date(application.createdAt);
    t.setHours(0, 0, 0, 0);
    const slot = days.find((x) => x.d.getTime() === t.getTime());
    if (slot) slot.count++;
  }
  const total = days.reduce((s, x) => s + x.count, 0);
  const max = Math.max(1, ...days.map((x) => x.count));
  return (
    <section className="dash-card reveal flex flex-col p-6 sm:p-7" style={{ ["--i" as string]: 4 }}>
      <CardHead title="Applications started" hint={`${total} in the last 7 days`} href="/applications" cta="All" icon={Send} />
      <div className="mt-8 flex min-h-44 flex-1 items-end gap-2 sm:gap-3" role="img" aria-label={`Applications started per day, ${total} in total`}>
        {days.map((x, i) => {
          const last = i === days.length - 1;
          return (
            <div key={x.d.toISOString()} className="group flex h-full flex-1 flex-col items-center justify-end gap-2">
              <span className={cx("text-[12px] font-semibold tnum transition-opacity", x.count ? "text-ink" : "text-transparent")}>{x.count}</span>
              <div className="flex w-full flex-1 items-end">
                <div
                  className={cx("dash-col w-full rounded-t-xl rounded-b-md transition-[filter] duration-150 group-hover:brightness-110", last ? "bg-gradient-to-t from-emerald-500 to-teal-300 shadow-[0_10px_24px_-10px_rgba(16,185,129,0.8)]" : "bg-gradient-to-t from-stone-2 to-stone")}
                  style={{ height: `${x.count ? Math.max(14, (x.count / max) * 100) : 6}%`, ["--i" as string]: i }}
                />
              </div>
              <span className={cx("text-[11.5px]", last ? "font-semibold text-ink" : "text-muted")}>{last ? "Today" : x.d.toLocaleDateString("en-US", { weekday: "short" })}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ matches */

export function Matches({ items }: { items: JobWithMatch[] }) {
  return (
    <section className="reveal" style={{ ["--i" as string]: 5 }}>
      <div className="mb-5 flex items-end justify-between gap-4 px-1">
        <div>
          <h2 className="font-display text-[26px] font-medium leading-tight tracking-[-0.03em] sm:text-[30px]">Roles worth your time</h2>
          <p className="mt-1 text-meta text-muted">Ranked by overlap with your career graph</p>
        </div>
        <Link href="/jobs" className="group inline-flex shrink-0 items-center gap-1 rounded-full bg-white px-4 py-2 text-[13px] font-medium shadow-sm ring-1 ring-black/5 transition-all duration-150 hover:shadow-md">
          All roles <ArrowRight size={14} aria-hidden="true" className="transition-transform duration-150 group-hover:translate-x-0.5" />
        </Link>
      </div>
      {items.length === 0 ? (
        <div className="dash-card p-10 text-center text-muted">No new matches yet. Run Discover on the jobs page.</div>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 md:grid-cols-2 md:max-xl:[&>*:nth-child(odd):last-child]:col-span-2 xl:grid-cols-3">
          {items.map(({ job, match }) => {
            const p = pct(match?.score);
            const strong = p >= 85;
            const matched = match?.explanation.matched.slice(0, 3) ?? [];
            const missing = match?.explanation.missing.length ?? 0;
            return (
              <Tilt key={job.id} className="dash-card dash-tilt relative flex flex-col p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <Monogram name={job.companyName} size={44} />
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-ink-2">{job.companyName}</p>
                      <p className="truncate text-[12px] text-muted">{job.location ?? "Location not listed"}</p>
                    </div>
                  </div>
                  <GradRing value={p} size={58} stroke={10} from={strong ? "#34d399" : "#60a5fa"} to={strong ? "#fbbf24" : "#818cf8"}>
                    <span className="font-display text-[15px] font-semibold tracking-[-0.03em] text-ink tnum">{p}</span>
                  </GradRing>
                </div>
                <Link href={`/jobs?job=${job.id}`} className="mt-5 block font-display text-[22px] font-medium leading-[1.1] tracking-[-0.03em] text-ink hover:underline hover:decoration-black/20 hover:underline-offset-4" title={job.title}>
                  {job.title}
                </Link>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {job.remote && <Chip hue="sky">Remote</Chip>}
                  {matched.map((m) => <Chip key={m.nodeId + m.requirement} hue="jade">{m.label}</Chip>)}
                  {missing > 0 && <Chip hue="slate">{missing} gap{missing === 1 ? "" : "s"}</Chip>}
                </div>
                {match?.explanation.reasons[0] && <p className="mt-4 line-clamp-2 text-meta leading-relaxed text-muted">{match.explanation.reasons[0]}</p>}
                <div className="mt-auto flex items-center justify-between gap-3 pt-6">
                  <Link href={`/jobs?job=${job.id}`} className="text-[13px] font-medium text-muted transition-colors duration-150 hover:text-ink">Details</Link>
                  <DashApply jobId={job.id} />
                </div>
              </Tilt>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ feed + recent */

const KIND_HUE: Record<AgentActivityKind, Hue> = {
  discovered: "sky", scored: "iris", queued: "sky", skipped: "slate", review_requested: "sun", approved: "jade",
  submitted: "jade", needs_user: "coral", reply: "iris", interview: "sun", brief: "slate",
};

export function Feed({ activity }: { activity: AgentActivity[] }) {
  const rows = activity.slice(0, 6);
  return (
    <section className="dash-card reveal p-6 sm:p-7" style={{ ["--i" as string]: 6 }}>
      <CardHead title="Agent activity" hint="What it did while you were away" href="/agent" cta="Open agent" icon={Sparkles} />
      {rows.length === 0 ? (
        <p className="mt-6 text-body-sm text-muted">No activity yet.</p>
      ) : (
        <ol className="relative mt-7 space-y-5">
          <span aria-hidden="true" className="absolute bottom-3 left-[17px] top-3 w-px bg-gradient-to-b from-black/10 via-black/10 to-transparent" />
          {rows.map((a) => {
            const hue = KIND_HUE[a.kind];
            const Ic = KIND_ICON[a.kind];
            return (
              <li key={a.id} className="relative flex items-start gap-4">
                <span className={cx("relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-white shadow-md ring-4 ring-white", HUE_ICON[hue])}>
                  <Ic size={15} strokeWidth={1.8} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1 pt-1">
                  <p className="text-[14px] leading-snug text-ink">{headline(a)}</p>
                  <TimeAgo iso={a.ts} className="text-[12px] text-muted" />
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export function Recent({ apps }: { apps: ApplicationListItem[] }) {
  const rows = [...apps].sort((a, b) => +new Date(b.application.updatedAt) - +new Date(a.application.updatedAt)).slice(0, 6);
  return (
    <section className="dash-card reveal p-6 sm:p-7" style={{ ["--i" as string]: 7 }}>
      <CardHead title="Recent applications" hint="Latest movement across your queue" href="/applications" icon={Send} />
      <ul className="mt-5 -mx-2 divide-y divide-black/5">
        {rows.map(({ application: a, job, resume }) => (
          <li key={a.id}>
            <Link href={`/applications/${a.id}`} className="group flex items-center gap-3 rounded-2xl px-2 py-3 transition-colors duration-150 hover:bg-stone/60">
              <Monogram name={job.companyName} size={38} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium text-ink">{job.title}</p>
                <p className="truncate text-[12.5px] text-muted">{job.companyName} &middot; <TimeAgo iso={a.updatedAt} /></p>
              </div>
              {resume?.atsScore != null && <span className="hidden text-[12px] text-muted sm:inline">ATS <strong className="font-semibold text-ink tnum">{resume.atsScore}</strong></span>}
              <Chip hue={STATUS_HUE[a.status]} live={a.status === "tailoring" || a.status === "filling" || a.status === "submitting"}>{STATUS_LABEL[a.status]}</Chip>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}


/* ------------------------------------------------------------------ ticker */

/** Endless strip of what the agent has been doing. Paused on hover, static for reduced motion. */
export function Ticker({ activity }: { activity: AgentActivity[] }) {
  const items = activity.slice(0, 8).map((a) => headline(a));
  if (items.length === 0) return null;
  const row = (hidden: boolean) => (
    <ul className="flex shrink-0 items-center" aria-hidden={hidden || undefined}>
      {items.map((t, i) => (
        <li key={i} className="flex items-center whitespace-nowrap text-[13px] font-medium text-ink-2">
          <span className="mx-6 bg-gradient-to-br from-emerald-400 to-amber-400 bg-clip-text text-[15px] text-transparent">&#10022;</span>
          {t}
        </li>
      ))}
    </ul>
  );
  return (
    <div className="reveal relative overflow-hidden rounded-full border border-black/5 bg-white/70 py-3 shadow-[0_1px_2px_rgba(20,19,17,0.04)] backdrop-blur" aria-label="Recent agent activity">
      <div className="dash-marquee">{row(false)}{row(true)}</div>
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-canvas to-transparent" />
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-canvas to-transparent" />
    </div>
  );
}
