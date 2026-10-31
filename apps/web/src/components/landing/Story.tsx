"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, FileText, Search, Send, Inbox, ShieldCheck, type LucideIcon } from "lucide-react";
import { cx } from "@/components/cx";
import { NoriFace } from "./NoriFace";
import { ease, span, typed, useReducedMotion, useScrollProgress } from "./motion";

/**
 * "Watch it work": a short film scrubbed by the scroll. One tall track, a sticky screen, five scenes. Inside a scene
 * every moving part is a function of the scene's own progress `t` (0..1), so scrolling back plays it in reverse.
 * Under reduced motion the film becomes five stills, one under the other.
 */

type Scene = { id: string; step: string; icon: LucideIcon; from: number; to: number; title: string; body: string; gate?: boolean };

const SCENES: Scene[] = [
  { id: "find", step: "Find", icon: Search, from: 0, to: 0.2, title: "It looks where you would.", body: "Company boards and the web, inside the lanes you set. Anything it skips keeps its reason." },
  { id: "tailor", step: "Tailor", icon: FileText, from: 0.2, to: 0.44, title: "It rewrites from what you did.", body: "A one-page resume for this role. Every changed line names the fact it came from." },
  { id: "gate", step: "You decide", icon: ShieldCheck, from: 0.44, to: 0.6, title: "Then it stops and asks.", body: "Nothing moves past this point until you approve. Skip is always one tap away.", gate: true },
  { id: "apply", step: "Apply", icon: Send, from: 0.6, to: 0.8, title: "It fills the form for you.", body: "Every field and screening answer, plus a screenshot to check. You approve once more, then it sends." },
  { id: "follow", step: "Follow", icon: Inbox, from: 0.8, to: 1, title: "And it keeps up with the replies.", body: "Confirmations, emailed codes and interview invites are read and filed. You see what moved." },
];

export function Story() {
  const reduce = useReducedMotion();
  const track = useRef<HTMLDivElement>(null);
  const p = useScrollProgress(track);
  const active = Math.max(0, SCENES.findIndex((s) => p < s.to || s === SCENES[SCENES.length - 1]));
  const scene = SCENES[active];

  return (
    <section id="story" aria-labelledby="story-title" className="relative scroll-mt-16">
      <div className="mx-auto w-full max-w-[1200px] px-4 pt-16 sm:px-6 sm:pt-24 lg:px-8">
        <p className="text-[13px] font-semibold text-[var(--sprout-ink)]">See it work</p>
        <h2 id="story-title" className="mt-2 max-w-[20ch] text-[2.2rem] font-semibold leading-[1.05] tracking-[-0.03em] text-ink sm:text-[3.2rem]">
          One application, start to <span className="font-serif-display italic text-[var(--nori)]">reply.</span>
        </h2>
        <p className="mt-4 max-w-[52ch] text-[17px] leading-relaxed text-ink-2">
          {reduce ? "Five moments from a real run, in order." : "Keep scrolling. This is what Nori does with one role, and the one place it waits for you."}
        </p>
      </div>

      {reduce ? (
        <ol className="mx-auto mt-10 flex w-full max-w-[900px] flex-col gap-14 px-4 pb-20 sm:px-6">
          {SCENES.map((s, i) => (
            <li key={s.id} className="flex flex-col gap-5">
              <Caption scene={s} index={i} />
              <Screen><SceneView id={s.id} t={1} /></Screen>
            </li>
          ))}
        </ol>
      ) : (
        <div ref={track} className="relative" style={{ height: "480vh" }}>
          <div className="sticky top-0 flex h-[100svh] items-center overflow-hidden">
            <div className="mx-auto grid w-full max-w-[1320px] items-center gap-6 px-4 pt-14 sm:px-6 lg:grid-cols-[minmax(0,0.66fr)_minmax(0,1.34fr)] lg:gap-12 lg:px-8">
              <div className="order-2 flex gap-5 lg:order-1 lg:gap-7">
                <Rail p={p} active={active} />
                <div className="relative min-h-[150px] flex-1 lg:min-h-[220px]">
                  <div key={scene.id} className="ln-pop">
                    <Caption scene={scene} index={active} />
                  </div>
                </div>
              </div>
              <div className="order-1 lg:order-2">
                <Screen>
                  {SCENES.map((s, i) => (
                    <div key={s.id} className="ln-scene absolute inset-0" data-on={i === active} aria-hidden={i !== active}>
                      <SceneView id={s.id} t={span(p, s.from, s.to)} />
                    </div>
                  ))}
                </Screen>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Caption({ scene, index }: { scene: Scene; index: number }) {
  return (
    <div>
      <p className={cx("inline-flex items-center gap-2 rounded-full px-3 py-1 text-[12.5px] font-semibold", scene.gate ? "bg-attn-tint text-attn-fg" : "bg-[var(--rice-2)] text-[var(--sprout-ink)]")}>
        <scene.icon size={14} aria-hidden="true" />
        {index + 1} of {SCENES.length} · {scene.step}
      </p>
      <h3 className="mt-3 text-[1.6rem] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[2.1rem]">{scene.title}</h3>
      <p className="mt-2 max-w-[40ch] text-[15.5px] leading-relaxed text-ink-2 sm:text-[16.5px]">{scene.body}</p>
    </div>
  );
}

/** A vine for a progress bar: it grows with the scroll and puts out a leaf at every step it passes. */
function Rail({ p, active }: { p: number; active: number }) {
  return (
    <div aria-hidden="true" className="relative hidden w-6 shrink-0 sm:block">
      <div className="absolute bottom-1 left-[11px] top-1 w-[2px] rounded-full bg-[var(--rice-line)]" />
      <div className="absolute left-[11px] top-1 w-[2px] rounded-full bg-gradient-to-b from-[var(--sprout-2)] to-[var(--nori-mid)]" style={{ height: `calc(${p * 100}% - 4px)` }} />
      {SCENES.map((s, i) => {
        const top = `${(s.from + (s.to - s.from) / 2) * 100}%`;
        const passed = p >= s.from + (s.to - s.from) / 2;
        return (
          <div key={s.id} className="absolute left-0" style={{ top }}>
            <span className={cx("absolute left-[5px] top-[-7px] h-[14px] w-[14px] rounded-full border-2 transition-colors duration-300", i === active ? (s.gate ? "border-attn bg-attn" : "border-[var(--nori-mid)] bg-[var(--sprout)]") : passed ? "border-[var(--nori-mid)] bg-[var(--nori-mid)]" : "border-[var(--rice-line)] bg-[var(--rice)]")} />
            <svg viewBox="0 0 18 12" width="18" height="12" className="ln-leaf absolute left-[16px] top-[-14px]" data-on={passed}>
              <path d="M1 11C2 4 8 0 17 1C16 8 9 12 1 11Z" fill="#7fb446" />
            </svg>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ the screen */

const W = 760;
const H = 500;
const BAR = 38;

/** A browser window drawn at 760 x 500 and scaled to fit, so the film lays out the same at every width. */
function Screen({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(0.8);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setK(e.contentRect.width / W));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={box} className="relative w-full" style={{ height: H * k }} role="img" aria-label="An animated sample of Nori's dashboard">
      <div className="absolute left-0 top-0 origin-top-left overflow-hidden rounded-[22px] border border-[var(--rice-line)] bg-[#fffefb] shadow-[0_40px_80px_-40px_rgba(42,70,32,0.45),0_2px_0_rgba(255,255,255,0.8)_inset]" style={{ width: W, height: H, transform: `scale(${k})` }}>
        <div className="flex items-center gap-3 border-b border-[var(--rice-line)] bg-[var(--rice-2)]/70 px-4" style={{ height: BAR }}>
          <span className="flex gap-1.5"><i className="h-3 w-3 rounded-full bg-[#f0b3a5]" /><i className="h-3 w-3 rounded-full bg-[#f3d58f]" /><i className="h-3 w-3 rounded-full bg-[#b7e4a4]" /></span>
          <span className="mx-auto flex h-6 w-[300px] items-center justify-center gap-1.5 rounded-full bg-white/80 text-[12px] text-muted">
            <svg viewBox="0 0 10 12" width="9" height="11" aria-hidden="true"><path d="M2 5V3.5a3 3 0 0 1 6 0V5M1.5 5h7v6h-7z" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
            jobs.norinote.xyz/today
          </span>
          <span className="w-[52px]" />
        </div>
        <div className="relative" style={{ height: H - BAR }}>{children}</div>
      </div>
    </div>
  );
}

function SceneView({ id, t }: { id: string; t: number }) {
  if (id === "find") return <SceneFind t={t} />;
  if (id === "tailor") return <SceneTailor t={t} />;
  if (id === "gate") return <SceneGate t={t} />;
  if (id === "apply") return <SceneApply t={t} />;
  return <SceneFollow t={t} />;
}

/** The pointer that "clicks" for you in the film. */
function Cursor({ x, y, click }: { x: number; y: number; click: boolean }) {
  return (
    <div className="pointer-events-none absolute z-20" style={{ left: x, top: y }}>
      {click && <span className="ln-ripple absolute -left-3 -top-3 h-6 w-6 rounded-full bg-[var(--nori-mid)]" />}
      <svg viewBox="0 0 20 24" width="20" height="24" className="drop-shadow-[0_2px_3px_rgba(0,0,0,0.25)]"><path d="M2 2l15 11-6.5 1.2L14 21l-3 1.4-3.4-7.1L2 19z" fill="#2b2722" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" /></svg>
    </div>
  );
}

function Ring({ value, size = 40, strong = false }: { value: number; size?: number; strong?: boolean }) {
  const r = size / 2 - 3.5;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#efe8d6" strokeWidth="4" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={strong ? "#5b8a32" : "#7fb446"} strokeWidth="4" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} />
      </svg>
      <span className="absolute text-[12px] font-semibold text-ink tnum">{Math.round(value)}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ scene 1: find */

const JOBS = [
  { co: "Tidewater", mono: "T", tint: "#dbe7f3", ink: "#1f3f63", title: "Frontend Engineer, Design Systems", where: "Remote, US", score: 92 },
  { co: "Lumen Health", mono: "L", tint: "#ece3f5", ink: "#47336e", title: "Senior Frontend Engineer", where: "New York", score: 86 },
  { co: "Northwind", mono: "N", tint: "#ece8e1", ink: "#4a443c", title: "UI Engineer", where: "Arlington, VA", score: 81, skip: "Needs a security clearance" },
  { co: "Kestrel", mono: "K", tint: "#d9f0ec", ink: "#3b6320", title: "Product Engineer, Web", where: "Remote", score: 78 },
  { co: "Parcel", mono: "P", tint: "#f5ead6", ink: "#6b4a10", title: "Frontend Intern", where: "Austin", score: 74, skip: "Internship, and you have 6 years" },
];
const BOARDS = ["Greenhouse", "Lever", "Ashby", "Hacker News", "Wellfound"];

function SceneFind({ t }: { t: number }) {
  let skipped = 0;
  return (
    <div className="flex h-full flex-col px-6 py-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[18px] font-semibold text-ink">New roles in your lane</p>
          <p className="whitespace-nowrap text-[13px] text-muted">Senior frontend · Remote or NYC · 70% match or more</p>
        </div>
        <div className="flex gap-1.5">
          {BOARDS.map((b, i) => {
            const lit = t > 0.02 + i * 0.07;
            return <span key={b} className={cx("whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors duration-300", lit ? "bg-[var(--nori)] text-[var(--rice)]" : "bg-[var(--rice-2)] text-muted")}>{b}</span>;
          })}
        </div>
      </div>
      <ul className="mt-4 flex flex-col gap-2.5">
        {JOBS.map((j, i) => {
          const a = ease(span(t, 0.08 + i * 0.08, 0.22 + i * 0.08));
          const score = j.score * ease(span(t, 0.12 + i * 0.08, 0.4 + i * 0.08));
          const k = j.skip ? skipped++ : -1;
          const s = j.skip ? span(t, 0.6 + k * 0.1, 0.7 + k * 0.1) : 0;
          const best = i === 0 ? span(t, 0.84, 0.94) : 0;
          return (
            <li key={j.co} className={cx("relative flex items-center gap-3.5 rounded-[14px] border bg-white px-3.5 py-2.5", best > 0.5 ? "border-[var(--nori-mid)]" : "border-[var(--rice-line)]")} style={{ opacity: a * (1 - 0.45 * s), transform: `translateX(${(1 - a) * 36}px)`, boxShadow: best > 0 ? `0 0 0 ${3 * best}px rgba(127,180,70,0.25)` : undefined }}>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] text-[16px] font-bold" style={{ background: j.tint, color: j.ink }}>{j.mono}</span>
              <div className="min-w-0 flex-1">
                <p className={cx("truncate text-[15px] font-semibold text-ink", s > 0.5 && "line-through decoration-[#8e877d]")}>{j.title}</p>
                <p className="text-[12.5px] text-muted">{j.co} · {j.where}</p>
              </div>
              {j.skip && s > 0 && (
                <span className="rounded-full border border-dashed border-control px-2.5 py-1 text-[11.5px] font-medium text-ink-2" style={{ opacity: s }}>Skipped: {j.skip}</span>
              )}
              {best > 0 && <span className="rounded-full bg-[var(--sprout)] px-2.5 py-1 text-[11.5px] font-semibold text-[var(--nori)]" style={{ opacity: best }}>Best match</span>}
              <Ring value={score} strong={i === 0} />
            </li>
          );
        })}
      </ul>
      <p className="mt-auto text-[13px] text-muted" style={{ opacity: span(t, 0.78, 0.9) }}>
        5 found · 2 skipped, each with its reason · 3 worth a resume
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ scene 2: tailor */

type GNode = { id: string; label: string; kind: "role" | "project" | "result" | "skill"; x: number; y: number };
const NODES: GNode[] = [
  { id: "role", label: "Brightline", kind: "role", x: 606, y: 62 },
  { id: "checkout", label: "Checkout rewrite", kind: "project", x: 540, y: 140 },
  { id: "react", label: "React", kind: "skill", x: 690, y: 124 },
  { id: "load", label: "−38% load", kind: "result", x: 680, y: 200 },
  { id: "ds", label: "Design system", kind: "project", x: 548, y: 262 },
  { id: "teams", label: "6 teams", kind: "result", x: 692, y: 292 },
  { id: "mentor", label: "Mentored 4", kind: "result", x: 590, y: 372 },
];
const EDGES: [string, string][] = [["role", "checkout"], ["role", "ds"], ["role", "mentor"], ["checkout", "react"], ["checkout", "load"], ["ds", "teams"]];
const BULLETS = [
  { y: 176, old: "Built UI components for internal tools.", next: "Rebuilt the checkout in React, cutting load time 38%.", src: "Checkout rewrite · −38% load", nodes: ["checkout", "react", "load"] },
  { y: 260, old: "Worked on the design system.", next: "Led a design system adopted by 6 product teams.", src: "Design system · 6 teams", nodes: ["ds", "teams"] },
  { y: 344, old: "Helped junior developers.", next: "Mentored 4 engineers through their first launches.", src: "Mentored 4 engineers", nodes: ["mentor"] },
];
const KIND_STYLE: Record<GNode["kind"], string> = {
  role: "bg-[var(--nori)] text-[var(--rice)] border-[var(--nori)]",
  project: "bg-white text-ink border-[var(--nori-mid)]",
  result: "bg-[#effbe0] text-[var(--sprout-ink)] border-[var(--sprout-2)]",
  skill: "bg-[#f3f1ed] text-ink-2 border-[#cfc8bd]",
};
const at = (id: string) => NODES.find((n) => n.id === id)!;

function SceneTailor({ t }: { t: number }) {
  const phase = BULLETS.map((_, i) => {
    const start = 0.04 + i * 0.29;
    return { strike: span(t, start, start + 0.06), type: span(t, start + 0.06, start + 0.22), chip: span(t, start + 0.21, start + 0.26) };
  });
  const lit = (id: string) => Math.max(...BULLETS.map((b, i) => (b.nodes.includes(id) ? span(t, 0.04 + i * 0.29 + 0.03, 0.04 + i * 0.29 + 0.09) : 0)));
  return (
    <div className="absolute inset-0">
      {/* the resume */}
      <div className="absolute left-6 top-4 h-[420px] w-[436px] rounded-[10px] border border-[var(--rice-line)] bg-white px-6 py-5 shadow-[0_20px_40px_-30px_rgba(43,39,34,0.5)]">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[19px] font-bold tracking-[-0.01em] text-ink">Alex Rivera</p>
            <p className="text-[12px] text-muted">Senior Frontend Engineer · Remote</p>
          </div>
          <span className="rounded-full bg-[var(--sprout)] px-2.5 py-1 text-[11px] font-semibold text-[var(--nori)]" style={{ opacity: span(t, 0.9, 0.97) }}>1 page · ATS 96</span>
        </div>
        <p className="mt-4 border-b border-[var(--rice-line)] pb-1 text-[11px] font-semibold text-muted">Experience</p>
        <p className="mt-2 text-[13px] font-semibold text-ink">Brightline · Senior Frontend Engineer <span className="font-normal text-muted">· 2021 to now</span></p>
      </div>
      {BULLETS.map((b, i) => {
        const ph = phase[i];
        return (
          <div key={b.old} className="absolute left-[50px] w-[392px]" style={{ top: b.y - 18 }}>
            <p className="relative inline-block text-[12.5px] text-muted" style={{ opacity: ph.type > 0 ? 0.55 : 1 }}>
              • {b.old}
              <span className="absolute left-0 top-1/2 h-[1.5px] w-full origin-left bg-[#b4281c]/70" style={{ transform: `scaleX(${ph.strike})` }} />
            </p>
            <p className={cx("mt-1 min-h-[20px] text-[14px] font-medium leading-snug text-ink", ph.type > 0 && ph.type < 1 && "ln-caret")}>
              {ph.type > 0 && <>• {typed(b.next, ph.type)}</>}
            </p>
            <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-accent-tint px-2 py-0.5 text-[11px] font-semibold text-accent-fg" style={{ opacity: ph.chip }}>
              Source: {b.src}
            </p>
          </div>
        );
      })}

      {/* the graph, and a thread from each new line to the facts it used */}
      <p className="absolute left-[484px] top-4 text-[12px] font-semibold text-muted">Your career graph</p>
      <svg className="absolute inset-0" width={W} height={H - BAR} aria-hidden="true">
        {EDGES.map(([a, b]) => <line key={a + b} x1={at(a).x} y1={at(a).y} x2={at(b).x} y2={at(b).y} stroke="#d8cfba" strokeWidth="1.5" />)}
        {BULLETS.map((b, i) => b.nodes.map((n) => {
          const node = at(n);
          const x0 = 446, y0 = b.y + 6;
          return (
            <path key={b.old + n} d={`M${x0} ${y0} C ${x0 + 50} ${y0}, ${node.x - 70} ${node.y}, ${node.x - 46} ${node.y}`} fill="none" stroke="#7fb446" strokeWidth="2" strokeLinecap="round" pathLength={1} strokeDasharray="1" strokeDashoffset={1 - phase[i].type} opacity={0.85} />
          );
        }))}
      </svg>
      {NODES.map((n) => {
        const l = lit(n.id);
        return (
          <span key={n.id} className={cx("absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border px-2.5 py-1 text-[12px] font-semibold", KIND_STYLE[n.kind])} style={{ left: n.x, top: n.y, boxShadow: l > 0 ? `0 0 0 ${5 * l}px rgba(220,236,152,0.55)` : undefined, transform: `translate(-50%, -50%) scale(${1 + 0.08 * l})` }}>
            {n.label}
          </span>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ scene 3: the gate */

function SceneGate({ t }: { t: number }) {
  const move = ease(span(t, 0.32, 0.6));
  const clicked = t > 0.64;
  const cx0 = 640, cy0 = 420, cx1 = 528, cy1 = 318;
  return (
    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,#fff7ef,transparent_70%)]">
      <div className="absolute left-[118px] top-[44px] flex items-end gap-2" style={{ opacity: span(t, 0.02, 0.12) }}>
        <NoriFace key={clicked ? "cheer" : "think"} mood={clicked ? "cheer" : "think"} size={64} />
        <span className="mb-10 rounded-[14px] rounded-bl-[4px] bg-[var(--nori)] px-3 py-1.5 text-[13px] font-semibold text-[var(--rice)]">
          {clicked ? "Approved. On to the form." : "Your call."}
        </span>
      </div>
      <div className={cx("absolute left-[140px] top-[130px] w-[480px] rounded-[16px] border-2 bg-white p-5 transition-colors duration-300", clicked ? "border-[var(--sprout-2)]" : "ln-pulse border-attn")}>
        <div className="flex items-center gap-2 text-[12px]">
          <span className="rounded-full bg-attn-tint px-2.5 py-0.5 font-semibold text-attn-fg">Resume</span>
          <span className={cx("font-semibold", clicked ? "text-[var(--sprout-ink)]" : "text-attn-fg")}>{clicked ? "Approved by you" : "Waiting on you"}</span>
          <span className="text-muted">· Tidewater · just now</span>
        </div>
        <p className="mt-2 text-[18px] font-semibold text-ink">Frontend Engineer, Design Systems</p>
        <p className="text-[13.5px] text-ink-2">3 lines changed, each from your graph. One page. ATS 96.</p>
        <div className="mt-3 rounded-[10px] bg-[var(--rice-2)] px-3 py-2 text-[12.5px] text-ink-2">
          <span className="text-muted line-through">Built UI components for internal tools.</span><br />
          <span className="font-medium text-ink">Rebuilt the checkout in React, cutting load time 38%.</span>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <span className="inline-flex h-10 items-center rounded-[10px] border border-control px-4 text-[13.5px] font-semibold text-ink">Skip job</span>
          <span className={cx("inline-flex h-10 items-center gap-1.5 rounded-[10px] px-4 text-[13.5px] font-semibold transition-colors duration-300", clicked ? "bg-[var(--sprout)] text-[var(--nori)]" : "bg-ink text-on-ink")}>
            {clicked ? <><Check size={15} strokeWidth={3} aria-hidden="true" />Approved</> : "Approve resume"}
          </span>
        </div>
      </div>
      <p className="absolute inset-x-0 bottom-6 text-center text-[13.5px] font-medium text-ink-2" style={{ opacity: span(t, 0.78, 0.9) }}>
        Nothing moved until you clicked.
      </p>
      <Cursor x={cx0 + (cx1 - cx0) * move} y={cy0 + (cy1 - cy0) * move} click={t > 0.6 && t < 0.78} />
    </div>
  );
}

/* ------------------------------------------------------------------ scene 4: apply */

const FIELDS = [
  ["Full name", "Alex Rivera"],
  ["Email", "alex@example.com"],
  ["LinkedIn", "linkedin.com/in/alexrivera"],
  ["Resume", "alex-rivera-tidewater.pdf"],
  ["Authorized to work in the US?", "Yes"],
  ["Will you need sponsorship?", "No"],
] as const;
const WHY = "Your team is rebuilding checkout on a shared design system, the same work I led at Brightline.";

function SceneApply({ t }: { t: number }) {
  const why = span(t, 0.5, 0.68);
  const shot = span(t, 0.7, 0.78);
  const move = ease(span(t, 0.76, 0.86));
  const sent = t > 0.88;
  return (
    <div className="absolute inset-0">
      <div className="absolute left-6 top-4 w-[468px] rounded-[14px] border border-[var(--rice-line)] bg-white p-4">
        <p className="text-[12px] font-semibold text-muted">Tidewater · Apply</p>
        <p className="text-[15.5px] font-semibold text-ink">Frontend Engineer, Design Systems</p>
        <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5">
          {FIELDS.map(([label, value], i) => {
            const f = span(t, 0.04 + i * 0.075, 0.11 + i * 0.075);
            const file = label === "Resume";
            return (
              <label key={label} className="block">
                <span className="block text-[11px] font-semibold text-ink-2">{label}</span>
                <span className={cx("mt-1 flex h-8 items-center rounded-[8px] border px-2.5 text-[12.5px] text-ink", f > 0 && f < 1 ? "border-accent ring-2 ring-accent/20" : "border-[#d9d2c4]")}>
                  {file ? (
                    f > 0.3 && <span className="inline-flex items-center gap-1 rounded bg-accent-tint px-1.5 py-0.5 text-[11.5px] font-semibold text-accent-fg"><FileText size={11} aria-hidden="true" />{value}</span>
                  ) : (
                    <span className={cx(f > 0 && f < 1 && "ln-caret")}>{typed(value, f)}</span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
        <span className="mt-2.5 block text-[11px] font-semibold text-ink-2">Why Tidewater?</span>
        <div className={cx("mt-1 min-h-[64px] rounded-[8px] border px-2.5 py-2 text-[12.5px] leading-snug text-ink", why > 0 && why < 1 ? "border-accent ring-2 ring-accent/20" : "border-[#d9d2c4]")}>
          <span className={cx(why > 0 && why < 1 && "ln-caret")}>{typed(WHY, why)}</span>
        </div>
        <p className="mt-1.5 inline-flex rounded-full bg-accent-tint px-2 py-0.5 text-[11px] font-semibold text-accent-fg" style={{ opacity: span(t, 0.66, 0.7) }}>Source: Checkout rewrite, Design system</p>
      </div>

      <div className="absolute left-[496px] top-4 w-[240px]">
        <div className="rounded-[14px] border border-[var(--rice-line)] bg-white p-3" style={{ opacity: shot, transform: `translateY(${(1 - shot) * 12}px)` }}>
          <div className="rounded-[8px] border border-[var(--rice-line)] bg-[var(--rice)] p-2">
            {[70, 90, 55, 85, 40, 75, 60].map((w, i) => <div key={i} className="mb-1.5 h-2 rounded-full bg-[#e6dec9]" style={{ width: `${w}%` }} />)}
          </div>
          <p className="mt-2 text-[12px] font-semibold text-ink">Screenshot saved</p>
          <p className="text-[11.5px] text-muted">7 fields, 0 guesses</p>
        </div>
        <div className={cx("relative mt-3 rounded-[14px] border-2 bg-white p-3", sent ? "border-[var(--sprout-2)]" : "border-attn")} style={{ opacity: span(t, 0.72, 0.8) }}>
          <p className={cx("text-[12px] font-semibold", sent ? "text-[var(--sprout-ink)]" : "text-attn-fg")}>{sent ? "Sent" : "Waiting on you"}</p>
          <p className="text-[13px] text-ink-2">{sent ? "Tidewater received it at 9:42." : "Check the form, then send."}</p>
          <span className={cx("mt-2.5 flex h-9 items-center justify-center gap-1.5 rounded-[10px] text-[13px] font-semibold transition-colors duration-300", sent ? "bg-[var(--sprout)] text-[var(--nori)]" : "bg-ink text-on-ink")}>
            {sent ? <><Check size={15} strokeWidth={3} aria-hidden="true" />Sent</> : "Approve form"}
          </span>
          {sent && [0, 1, 2, 3, 4].map((i) => (
            <svg key={i} viewBox="0 0 14 10" width="14" height="10" className="ln-grow absolute" style={{ left: 40 + i * 36, top: -8 - (i % 2) * 10, animationDelay: `${i * 60}ms` }} aria-hidden="true">
              <path d="M1 9C2 3 7 0 13 1C12 7 7 10 1 9Z" fill={i % 2 ? "#dcec98" : "#7fb446"} />
            </svg>
          ))}
        </div>
      </div>
      <Cursor x={700 + (620 - 700) * move} y={440 + (338 - 440) * move} click={t > 0.85 && t < 0.95} />
    </div>
  );
}

/* ------------------------------------------------------------------ scene 5: follow */

const MAIL = [
  { at: 0.06, from: "Tidewater Careers", subject: "Thank you for applying", tag: "Confirmation", tone: "bg-[#effbe0] text-[var(--sprout-ink)]" },
  { at: 0.28, from: "Kestrel", subject: "Your verification code is 482 913", tag: "Code typed in for you", tone: "bg-accent-tint text-accent-fg" },
  { at: 0.52, from: "Tidewater Recruiting", subject: "Interview: does Thursday at 2 work?", tag: "Interview", tone: "bg-[var(--nori)] text-[var(--rice)]" },
];
const STAGES = ["Found", "Resume", "Sent", "Interview"];

function SceneFollow({ t }: { t: number }) {
  const stage = t > 0.58 ? 3 : 2;
  const happy = t > 0.66;
  return (
    <div className="absolute inset-0">
      <div className="absolute left-6 top-4 w-[440px]">
        <p className="text-[18px] font-semibold text-ink">Inbox</p>
        <p className="text-[13px] text-muted">Read every 5 minutes, sorted by what it means</p>
        <ul className="mt-3 flex flex-col gap-2.5">
          {MAIL.map((m) => {
            const a = ease(span(t, m.at, m.at + 0.12));
            return (
              <li key={m.subject} className="rounded-[14px] border border-[var(--rice-line)] bg-white px-4 py-3" style={{ opacity: a, transform: `translateY(${(1 - a) * -18}px)` }}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[12.5px] font-semibold text-ink-2">{m.from}</p>
                  <span className={cx("rounded-full px-2.5 py-0.5 text-[11px] font-semibold", m.tone)}>{m.tag}</span>
                </div>
                <p className="mt-0.5 text-[14.5px] font-medium text-ink">{m.subject}</p>
              </li>
            );
          })}
        </ul>
        <div className="mt-5 grid grid-cols-3 gap-2.5" style={{ opacity: span(t, 0.76, 0.88) }}>
          {[["3", "sent this week"], ["1", "interview"], ["0", "sent without you"]].map(([n, l]) => (
            <div key={l} className="rounded-[12px] bg-[var(--rice-2)] px-3 py-2.5">
              <p className="text-[22px] font-semibold leading-none text-ink tnum">{n}</p>
              <p className="mt-1 text-[11.5px] text-muted">{l}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="absolute left-[488px] top-[52px] w-[248px] rounded-[16px] border border-[var(--rice-line)] bg-white p-4">
        <p className="text-[12px] font-semibold text-muted">Tidewater</p>
        <p className="text-[14.5px] font-semibold text-ink">Frontend Engineer</p>
        <div className="relative mt-5 h-10">
          <div className="absolute left-2 right-2 top-[7px] h-[2px] bg-[var(--rice-line)]" />
          <div className="absolute left-2 top-[7px] h-[2px] bg-[var(--nori-mid)] transition-[width] duration-700" style={{ width: `calc(${(stage / (STAGES.length - 1)) * 100}% - 16px)` }} />
          {STAGES.map((s, i) => (
            <div key={s} className="absolute flex -translate-x-1/2 flex-col items-center" style={{ left: `calc(8px + ${(i / (STAGES.length - 1)) * 100}% - ${(i / (STAGES.length - 1)) * 16}px)` }}>
              <span className={cx("h-4 w-4 rounded-full border-2 transition-colors duration-500", i <= stage ? "border-[var(--nori-mid)] bg-[var(--sprout)]" : "border-[var(--rice-line)] bg-white")} />
              <span className={cx("mt-1 text-[10.5px] font-semibold", i === stage ? "text-ink" : "text-muted")}>{s}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="absolute left-[500px] top-[230px] flex items-end gap-2" style={{ opacity: span(t, 0.62, 0.72) }}>
        <NoriFace key={happy ? "cheer" : "happy"} mood={happy ? "cheer" : "happy"} size={60} />
        <span className="mb-9 max-w-[160px] rounded-[14px] rounded-bl-[4px] bg-[var(--nori)] px-3 py-1.5 text-[12.5px] font-semibold leading-snug text-[var(--rice)]">
          An interview! Want me to hold Thursday?
        </span>
      </div>
    </div>
  );
}
