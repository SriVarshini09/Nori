"use client";

import { useRef, useState } from "react";
import { ArrowRight, ClipboardPaste, FileCheck2, FileUp, LoaderCircle, RotateCcw, ThumbsUp } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { GraphNode, IngestResult } from "@/lib/types";
import { CountUp } from "../dash/client";
import { Icon, Notice, cx, inputClass } from "../ui";
import { ObButton, Soft } from "./controls";

const ACCEPT = [".pdf", ".docx", ".txt"];
const TYPE_RANK: Record<string, number> = { role: 0, company: 1, project: 2, metric: 3, skill: 4, education: 5, tool: 6 };

/** Up to eight nodes worth showing: the ingest's own list when the API returns one, otherwise the best-connected graph nodes. */
async function topNodes(result: IngestResult): Promise<GraphNode[]> {
  if (result.nodes?.length) {
    return [...result.nodes].sort((a, b) => (TYPE_RANK[a.type] ?? 9) - (TYPE_RANK[b.type] ?? 9)).slice(0, 8);
  }
  try {
    const g = await api.graph();
    const degree = new Map<string, number>();
    for (const e of g.edges) {
      degree.set(e.src, (degree.get(e.src) ?? 0) + 1);
      degree.set(e.dst, (degree.get(e.dst) ?? 0) + 1);
    }
    return [...g.nodes].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0)).slice(0, 8);
  } catch {
    return [];
  }
}

export function ResumeStep({ hasResume, busy, onDone, onResult }: {
  hasResume: boolean;
  busy?: boolean;
  onDone: (result: IngestResult | null) => Promise<void> | void;
  /** Lets the wizard react (the mascot comments) as soon as the resume has been read. */
  onResult?: (result: IngestResult) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"file" | "paste">("file");
  const [text, setText] = useState("");
  const [drag, setDrag] = useState(false);
  const [reading, setReading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [replace, setReplace] = useState(!hasResume);

  async function ingest(run: () => Promise<IngestResult>, label: string) {
    setReading(label);
    setError(null);
    try {
      const r = await run();
      setResult(r);
      onResult?.(r);
      setNodes(await topNodes(r));
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : (e as Error).message);
    } finally {
      setReading(null);
    }
  }

  function pick(file: File | undefined) {
    if (!file) return;
    if (!ACCEPT.some((ext) => file.name.toLowerCase().endsWith(ext))) {
      setError("Use a PDF, DOCX or TXT file.");
      return;
    }
    ingest(() => api.uploadResumeFile(file), file.name);
  }

  // ---- after ingest: counts + top nodes
  if (result) {
    return (
      <div>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { label: "Facts about you", value: result.nodesCreated, grad: "from-emerald-500 to-teal-600" },
            { label: "Connections", value: result.edgesCreated, grad: "from-sky-500 to-indigo-600" },
          ].map((st, i) => (
            <div key={st.label} className="ob-pop rounded-2xl border border-black/[0.07] bg-gradient-to-br from-white to-stone/40 p-5" style={{ ["--i" as string]: i }}>
              <div className={cx("bg-gradient-to-br bg-clip-text font-display text-[3rem] font-medium leading-none tracking-[-0.045em] text-transparent", st.grad)}>
                <CountUp value={st.value} />
              </div>
              <div className="mt-2 text-[13px] font-medium text-muted">{st.label}</div>
            </div>
          ))}
          <div className="ob-pop flex items-end rounded-2xl bg-stone/60 p-5 text-meta text-muted" style={{ ["--i" as string]: 2 }}>
            {result.usedLLM ? "Read with the language model." : "Read with the built-in parser."}
          </div>
        </div>

        {nodes.length > 0 && (
          <div className="mt-6">
            <p className="mb-3 text-label font-medium uppercase text-muted">What I found</p>
            <ul className="flex flex-wrap gap-2">
              {nodes.map((n, i) => (
                <li key={n.id} className="ob-pop inline-flex items-center gap-2 rounded-full bg-white py-1.5 pl-3 pr-2 text-[13px] font-medium text-ink ring-1 ring-black/10" style={{ ["--i" as string]: i + 3 }} title={n.label}>
                  <span className="max-w-[16rem] truncate">{n.label}</span>
                  <span className="rounded-full bg-stone px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">{n.type}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-9 flex flex-wrap items-center gap-3 border-t border-black/[0.06] pt-6">
          <ObButton variant="soft" onClick={() => { setResult(null); setNodes([]); }} disabled={busy}><Icon icon={RotateCcw} />Try another file</ObButton>
          <div className="flex-1" />
          <ObButton onClick={() => onDone(result)} disabled={busy}>
            {busy ? <><Icon icon={LoaderCircle} className="animate-spin" />Saving</> : <><Icon icon={ThumbsUp} />Looks right</>}
          </ObButton>
        </div>
      </div>
    );
  }

  // ---- resuming with a resume already on file
  if (!replace) {
    return (
      <div>
        <Soft tint className="flex flex-wrap items-center gap-4">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-md"><Icon icon={FileCheck2} size={20} /></span>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-medium text-ink">Resume on file</div>
            <div className="text-meta text-muted">Your graph is already built from it.</div>
          </div>
          <ObButton variant="soft" onClick={() => setReplace(true)}><Icon icon={FileUp} />Replace</ObButton>
        </Soft>
        <div className="mt-9 flex justify-end border-t border-black/[0.06] pt-6">
          <ObButton onClick={() => onDone(null)} disabled={busy}>
            {busy ? <><Icon icon={LoaderCircle} className="animate-spin" />Saving</> : <>Continue<Icon icon={ArrowRight} /></>}
          </ObButton>
        </div>
      </div>
    );
  }

  // ---- pick / drop / paste
  return (
    <div>
      {mode === "file" ? (
        <label
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]); }}
          className={cx(
            "group relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-3xl border-2 border-dashed px-6 py-16 text-center transition-all duration-300",
            drag ? "scale-[1.02] border-emerald-500 bg-emerald-50 shadow-[0_0_0_8px_rgba(16,185,129,0.12)]" : "border-black/15 bg-gradient-to-br from-white to-stone/40 hover:border-emerald-500/60 hover:shadow-[0_20px_50px_-30px_rgba(16,185,129,0.6)]",
            reading && "pointer-events-none",
          )}
        >
          <input ref={fileRef} type="file" accept={ACCEPT.join(",")} className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
          {reading && <span aria-hidden="true" className="ob-scan" />}
          <span className={cx("flex h-16 w-16 items-center justify-center rounded-[22px] bg-gradient-to-br from-emerald-400 to-teal-600 text-white shadow-[0_14px_30px_-12px_rgba(16,185,129,0.9)]", !reading && "ob-float-icon")}>
            {reading ? <Icon icon={LoaderCircle} size={26} className="animate-spin" /> : <Icon icon={FileUp} size={26} />}
          </span>
          <span className="mt-5 font-display text-[22px] font-medium tracking-[-0.025em] text-ink">
            {reading ? `Reading ${reading}` : drag ? "Drop it, I have got it" : "Drop your resume here"}
          </span>
          <span className="mt-1.5 text-meta text-muted">{reading ? "Building your career graph..." : "or click to choose a PDF, DOCX or TXT"}</span>
        </label>
      ) : (
        <div>
          <textarea
            className={cx(inputClass, "min-h-[260px] font-mono text-[12.5px] leading-relaxed")}
            placeholder="Paste the full text of your resume"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="mt-3 flex justify-end">
            <ObButton onClick={() => ingest(() => api.uploadResume(text), "pasted text")} disabled={!!reading || text.trim().length < 40}>
              {reading ? <><Icon icon={LoaderCircle} className="animate-spin" />Reading</> : <>Read resume<Icon icon={ArrowRight} /></>}
            </ObButton>
          </div>
        </div>
      )}

      <div className="mt-5 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setMode(mode === "file" ? "paste" : "file")}
          className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-medium text-ink-2 transition-colors hover:bg-stone hover:text-ink"
        >
          <Icon icon={mode === "file" ? ClipboardPaste : FileUp} />
          {mode === "file" ? "Paste text instead" : "Upload a file instead"}
        </button>
        {hasResume && <button type="button" onClick={() => setReplace(false)} className="text-meta text-muted hover:text-ink">Keep the current resume</button>}
      </div>
      {error && <div className="mt-5"><Notice tone="red">{error}</Notice></div>}
    </div>
  );
}
