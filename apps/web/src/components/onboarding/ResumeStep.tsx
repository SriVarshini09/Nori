"use client";

import { useRef, useState } from "react";
import { ClipboardPaste, FileCheck2, FileUp, RotateCcw, ThumbsUp } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { GraphNode, IngestResult } from "@/lib/types";
import { Button, Frame, Icon, IndexLabel, Notice, cx, idx, inputClass } from "../ui";

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

export function ResumeStep({ hasResume, busy, onDone }: {
  hasResume: boolean;
  busy?: boolean;
  onDone: (result: IngestResult | null) => Promise<void> | void;
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
        <Frame className="grid grid-cols-2 sm:grid-cols-3">
          {[
            { label: "Nodes", value: result.nodesCreated },
            { label: "Connections", value: result.edgesCreated },
          ].map((s, i) => (
            <div key={s.label} className={cx("p-5 sm:p-6", i > 0 && "border-l border-line")}>
              <IndexLabel index={idx(i + 1)}>{s.label}</IndexLabel>
              <div className="mt-3 font-display text-[2.75rem] font-medium leading-none tracking-[-0.04em] text-ink tnum">{s.value}</div>
            </div>
          ))}
          <div className="col-span-2 flex items-end border-t border-line p-5 text-meta text-muted sm:col-span-1 sm:border-l sm:border-t-0 sm:p-6">
            {result.usedLLM ? "Read with the language model." : "Read with the built-in parser."}
          </div>
        </Frame>

        {nodes.length > 0 && (
          <ol className="mt-8 grid border-t border-line sm:grid-cols-2 sm:gap-x-8">
            {nodes.map((n, i) => (
              <li key={n.id} className="grid grid-cols-[2rem_minmax(0,1fr)] items-baseline gap-x-3 border-b border-line py-3">
                <span className="text-label font-medium text-faint tnum">{idx(i + 1)}</span>
                <span className="flex min-w-0 items-center justify-between gap-3">
                  <span className="truncate text-body-sm text-ink" title={n.label}>{n.label}</span>
                  <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.1em] text-faint">{n.type}</span>
                </span>
              </li>
            ))}
          </ol>
        )}

        <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-line pt-5">
          <Button variant="secondary" icon={RotateCcw} onClick={() => { setResult(null); setNodes([]); }} disabled={busy}>Try another file</Button>
          <div className="flex-1" />
          <Button variant="primary" icon={ThumbsUp} onClick={() => onDone(result)} disabled={busy}>{busy ? "Saving..." : "Looks right"}</Button>
        </div>
      </div>
    );
  }

  // ---- resuming with a resume already on file
  if (!replace) {
    return (
      <div>
        <Frame className="flex flex-wrap items-center gap-4 p-5 sm:p-6">
          <span className="flex h-10 w-10 items-center justify-center rounded-full border border-line"><Icon icon={FileCheck2} /></span>
          <div className="min-w-0 flex-1">
            <div className="text-body-sm font-medium text-ink">Resume on file</div>
            <div className="text-meta text-muted">Your graph is already built from it.</div>
          </div>
          <Button variant="secondary" icon={FileUp} onClick={() => setReplace(true)}>Replace</Button>
        </Frame>
        <div className="mt-8 flex justify-end border-t border-line pt-5">
          <Button variant="primary" arrow onClick={() => onDone(null)} disabled={busy}>{busy ? "Saving..." : "Continue"}</Button>
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
            "relative flex cursor-pointer flex-col items-center justify-center border border-dashed px-6 py-16 text-center transition-colors duration-150",
            drag ? "border-ink bg-stone/60" : "border-line-strong bg-paper hover:border-ink",
            reading && "pointer-events-none opacity-60",
          )}
        >
          <input ref={fileRef} type="file" accept={ACCEPT.join(",")} className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
          <span className="flex h-11 w-11 items-center justify-center rounded-full border border-line bg-canvas"><Icon icon={FileUp} /></span>
          <span className="mt-4 font-display text-title font-medium text-ink">
            {reading ? `Reading ${reading}...` : "Drop your resume here"}
          </span>
          <span className="mt-1 text-meta text-muted">{reading ? "Building your career graph." : "or click to choose a PDF, DOCX or TXT"}</span>
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
            <Button variant="primary" arrow={!reading} onClick={() => ingest(() => api.uploadResume(text), "pasted text")} disabled={!!reading || text.trim().length < 40}>
              {reading ? "Reading..." : "Read resume"}
            </Button>
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setMode(mode === "file" ? "paste" : "file")}
          className="inline-flex items-center gap-2 text-meta font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink"
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
