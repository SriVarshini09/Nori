"use client";

import { useState } from "react";
import { Check, Plus, RotateCcw, X } from "lucide-react";
import { cx } from "@/components/cx";
import { NoriFace, type Mood } from "./NoriFace";

/**
 * "It cannot lie about you", as something to try: pick a requirement and see the evidence in the graph. GraphQL has
 * none, so asking Nori to claim it gets a shake of the head; adding the fact yourself grows a new node it can use.
 */

type Req = "React" | "TypeScript" | "Next.js" | "GraphQL";
const REQS: Req[] = ["React", "TypeScript", "Next.js", "GraphQL"];

type N = { id: string; label: string; x: number; y: number; kind: "role" | "project" | "skill" };
const NODES: N[] = [
  { id: "role", label: "Brightline", x: 220, y: 48, kind: "role" },
  { id: "checkout", label: "Checkout rewrite", x: 104, y: 132, kind: "project" },
  { id: "site", label: "Site migration", x: 226, y: 196, kind: "project" },
  { id: "ds", label: "Design system", x: 340, y: 132, kind: "project" },
  { id: "react", label: "React", x: 56, y: 232, kind: "skill" },
  { id: "next", label: "Next.js", x: 226, y: 286, kind: "skill" },
  { id: "ts", label: "TypeScript", x: 386, y: 232, kind: "skill" },
];
const GQL: N = { id: "gql", label: "GraphQL", x: 120, y: 300, kind: "skill" };
const EDGES: [string, string][] = [["role", "checkout"], ["role", "site"], ["role", "ds"], ["checkout", "react"], ["site", "next"], ["ds", "ts"]];

const EVIDENCE: Record<Exclude<Req, "GraphQL">, { path: string[]; line: string; source: string }> = {
  React: { path: ["role", "checkout", "react"], line: "Rebuilt the checkout in React, cutting load time 38%.", source: "Project: Checkout rewrite, at Brightline" },
  TypeScript: { path: ["role", "ds", "ts"], line: "Led a TypeScript design system adopted by 6 product teams.", source: "Project: Design system, at Brightline" },
  "Next.js": { path: ["role", "site", "next"], line: "Moved the marketing site to Next.js and halved build times.", source: "Project: Site migration, at Brightline" },
};

const DEFAULT_FACT = "Built the GraphQL gateway for the mobile app.";

export function Honest() {
  const [sel, setSel] = useState<Req>("React");
  const [added, setAdded] = useState<string | null>(null);
  const [draft, setDraft] = useState(DEFAULT_FACT);
  const [mood, setMood] = useState<{ m: Mood; say: string; n: number }>({ m: "happy", say: "Pick one. I'll show you where it came from.", n: 0 });

  const nodes = added ? [...NODES, GQL] : NODES;
  const edges: [string, string][] = added ? [...EDGES, ["checkout", "gql"]] : EDGES;
  const path = sel === "GraphQL" ? (added ? ["role", "checkout", "gql"] : []) : EVIDENCE[sel].path;
  const onPath = (a: string, b: string) => path.includes(a) && path.includes(b);
  const matched = REQS.filter((r) => r !== "GraphQL" || added).length;
  const react = (m: Mood, say: string) => setMood((s) => ({ m, say, n: s.n + 1 }));

  const pick = (r: Req) => {
    setSel(r);
    if (r === "GraphQL" && !added) react("think", "Hmm. Nothing you've done shows GraphQL.");
    else react("happy", r === "GraphQL" ? "That one's yours now. Here's the fact." : "Here's where that came from.");
  };
  const claimAnyway = () => react("no", "I can't prove that, so I won't write it.");
  const addFact = () => {
    const text = draft.trim();
    if (!text) return;
    setAdded(text);
    react("cheer", "Got it. Now I can use it, with the source.");
  };
  const reset = () => { setAdded(null); setDraft(DEFAULT_FACT); setSel("React"); react("happy", "Pick one. I'll show you where it came from."); };

  return (
    <section id="honest" aria-labelledby="honest-title" className="relative scroll-mt-16 border-t border-[var(--rice-line)] bg-[linear-gradient(180deg,var(--rice),#f8f4e8)]">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
        <div className="max-w-[60ch]">
          <p className="text-[13px] font-semibold text-[var(--sprout-ink)]">Why trust it</p>
          <h2 id="honest-title" className="mt-2 text-[2.2rem] font-semibold leading-[1.05] tracking-[-0.03em] text-ink sm:text-[3.2rem]">
            It <span className="font-serif-display italic text-[var(--nori)]">cannot</span> lie about you.
          </h2>
          <p className="mt-4 text-[17px] leading-relaxed text-ink-2">
            Your history becomes a graph of roles, projects, skills and results. Nori writes only from that graph, and every line shows where it came from. Try it.
          </p>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-10">
          {/* the posting, and what Nori can back up */}
          <div className="flex flex-col gap-4">
            <div className="rounded-[20px] border border-[var(--rice-line)] bg-white p-5 shadow-[0_24px_50px_-40px_rgba(42,70,32,0.5)]">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[13px] font-semibold text-muted">Tidewater is asking for</p>
                <p className="text-[13px] font-semibold text-ink tnum">Matches {matched} of 4</p>
              </div>
              <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Requirements in the posting">
                {REQS.map((r) => {
                  const gap = r === "GraphQL" && !added;
                  return (
                    <button
                      key={r}
                      type="button"
                      aria-pressed={sel === r}
                      onClick={() => pick(r)}
                      className={cx(
                        "inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[14px] font-semibold transition-[background-color,color,transform,box-shadow] duration-200 hover:-translate-y-px",
                        sel === r ? "bg-[var(--nori)] text-[var(--rice)] shadow-[0_8px_20px_-10px_rgba(42,70,32,0.7)]" : gap ? "border border-dashed border-control bg-white text-ink-2" : "bg-[var(--rice-2)] text-ink",
                      )}
                    >
                      {gap ? <X size={14} aria-hidden="true" /> : <Check size={14} strokeWidth={3} aria-hidden="true" />}
                      {r}
                    </button>
                  );
                })}
              </div>
            </div>

            <div key={`${sel}-${added ? 1 : 0}`} className="ln-pop rounded-[20px] border border-[var(--rice-line)] bg-white p-5" aria-live="polite">
              {sel !== "GraphQL" ? (
                <>
                  <p className="text-[12.5px] font-semibold text-muted">Line Nori writes</p>
                  <p className="mt-1 text-[17px] font-medium leading-snug text-ink">{EVIDENCE[sel].line}</p>
                  <p className="mt-3 inline-flex rounded-full bg-accent-tint px-2.5 py-1 text-[12px] font-semibold text-accent-fg">Source: {EVIDENCE[sel].source}</p>
                </>
              ) : added ? (
                <>
                  <p className="text-[12.5px] font-semibold text-muted">Line Nori writes</p>
                  <p className="mt-1 text-[17px] font-medium leading-snug text-ink">{added}</p>
                  <p className="mt-3 inline-flex rounded-full bg-[#effbe0] px-2.5 py-1 text-[12px] font-semibold text-[var(--sprout-ink)]">Source: a fact you added</p>
                </>
              ) : (
                <>
                  <p className="text-[12.5px] font-semibold text-muted">Not claimed</p>
                  <p className="mt-1 text-[16px] leading-snug text-ink-2">The posting asks for GraphQL. Nothing in your graph shows it, so it is left out and you are told why.</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" onClick={claimAnyway} className="inline-flex h-10 items-center rounded-full border border-control px-4 text-[13.5px] font-semibold text-ink transition-colors hover:bg-[var(--rice-2)]">
                      Ask Nori to claim it anyway
                    </button>
                  </div>
                  <form className="mt-4 flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); addFact(); }}>
                    <label className="sr-only" htmlFor="ln-fact">A fact about your GraphQL work</label>
                    <input id="ln-fact" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={90} className="h-11 min-w-0 flex-1 rounded-full border border-[#d9d2c4] bg-[var(--rice)] px-4 text-[14px] text-ink focus:border-[var(--nori-mid)] focus:outline-none focus:ring-2 focus:ring-[var(--sprout-2)]/30" />
                    <button type="submit" className="inline-flex h-11 items-center justify-center gap-1.5 rounded-full bg-[var(--nori)] px-5 text-[14px] font-semibold text-[var(--rice)] transition-colors hover:bg-[var(--nori-deep)]">
                      <Plus size={16} aria-hidden="true" />Add the fact
                    </button>
                  </form>
                </>
              )}
            </div>
            {added && (
              <button type="button" onClick={reset} className="inline-flex items-center gap-1.5 self-start text-[13px] font-semibold text-muted underline-offset-4 hover:text-ink hover:underline">
                <RotateCcw size={13} aria-hidden="true" />Reset the demo
              </button>
            )}
          </div>

          {/* the graph */}
          <div className="relative overflow-hidden rounded-[24px] border border-[var(--rice-line)] bg-[radial-gradient(circle_at_30%_20%,#ffffff,#f6f0df)] p-4">
            <div className="absolute left-5 top-5 z-10 flex items-end gap-2">
              <NoriFace key={mood.n} mood={mood.m} size={58} />
              <span key={`say-${mood.n}`} className="ln-pop mb-8 max-w-[230px] rounded-[14px] rounded-bl-[4px] bg-[var(--nori)] px-3 py-1.5 text-[13px] font-semibold leading-snug text-[var(--rice)]">{mood.say}</span>
            </div>
            <svg viewBox="0 0 440 340" className="mt-16 h-auto w-full" role="img" aria-label={`Sample career graph. ${sel}: ${path.length ? "backed by " + path.map((id) => nodes.find((n) => n.id === id)?.label).join(", then ") : "no evidence"}.`}>
              {edges.map(([a, b]) => {
                const A = nodes.find((n) => n.id === a)!, B = nodes.find((n) => n.id === b)!;
                const hot = onPath(a, b);
                return (
                  <g key={a + b}>
                    <line x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke="#ddd3bd" strokeWidth="2" />
                    {hot && <line key={`${sel}-${added}`} x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke="#7fb446" strokeWidth="3.5" strokeLinecap="round" className="ln-draw-line" />}
                  </g>
                );
              })}
              {!added && sel === "GraphQL" && (
                <g>
                  <line x1={104} y1={132} x2={GQL.x} y2={GQL.y} stroke="#b9b0a2" strokeWidth="1.5" strokeDasharray="4 5" />
                  <rect x={GQL.x - 46} y={GQL.y - 16} width={92} height={32} rx={16} fill="#fffdf7" stroke="#8e877d" strokeDasharray="4 4" />
                  <text x={GQL.x} y={GQL.y + 5} textAnchor="middle" fontSize="13" fontWeight="600" fill="#6b645b">GraphQL ?</text>
                </g>
              )}
              {nodes.map((n) => {
                const hot = path.includes(n.id);
                const w = n.label.length * 7.4 + 26;
                const fill = n.kind === "role" ? "#0b3f31" : hot ? "#effbe0" : "#ffffff";
                const stroke = n.kind === "role" ? "#0b3f31" : hot ? "#7fb446" : n.kind === "project" ? "#5b8a32" : "#cfc8bd";
                return (
                  <g key={n.id} className={n.id === "gql" ? "ln-grow" : undefined}>
                    {hot && <rect x={n.x - w / 2 - 5} y={n.y - 21} width={w + 10} height={42} rx={21} fill="#dcec98" opacity=".45" />}
                    <rect x={n.x - w / 2} y={n.y - 16} width={w} height={32} rx={16} fill={fill} stroke={stroke} strokeWidth={hot ? 2 : 1.5} />
                    <text x={n.x} y={n.y + 5} textAnchor="middle" fontSize="13" fontWeight="600" fill={n.kind === "role" ? "#fffcf3" : "#2b2722"}>{n.label}</text>
                  </g>
                );
              })}
            </svg>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 px-1 text-[12px] text-muted" aria-hidden="true">
              <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[var(--nori)]" />Role</li>
              <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-2 border-[var(--nori-mid)] bg-white" />Project</li>
              <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-2 border-[#cfc8bd] bg-white" />Skill</li>
              <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[var(--sprout)]" />Used for this line</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
