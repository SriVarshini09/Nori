"use client";

import { Check, ChevronDown, Download, History, Minus, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, templatePreviewUrl } from "@/lib/api";
import type { AtsCheck, ResumeFormat, ResumeTemplateInfo, ResumeTemplates, ResumeTheme, ResumeVersion } from "@/lib/types";
import { Button, Field, Icon, Pill, cx, inputClass } from "../ui";

// ---------- templates ----------

const THUMB_W = 176;
const PAGE_PX = 816;

/** A template shown on a sample resume: the real preview page, scaled down. */
function Thumb({ id, name }: { id: string; name: string }) {
  const scale = THUMB_W / PAGE_PX;
  return (
    <div className="relative overflow-hidden rounded-md border border-line bg-white" style={{ width: THUMB_W, height: Math.round(1056 * scale) }} aria-hidden="true">
      <iframe
        title={`${name} sample`} src={templatePreviewUrl(id)} loading="lazy" tabIndex={-1} sandbox="allow-same-origin"
        className="pointer-events-none absolute left-0 top-0 border-0"
        style={{ width: PAGE_PX, height: 1056, transform: `scale(${scale})`, transformOrigin: "top left" }}
      />
    </div>
  );
}

export function TemplateGallery({ templates, value, onPick }: { templates: ResumeTemplateInfo[]; value: string; onPick: (t: ResumeTemplateInfo) => void }) {
  return (
    <div role="radiogroup" aria-label="Template" className="grid grid-cols-[repeat(auto-fill,minmax(176px,1fr))] gap-4">
      {templates.map((t) => {
        const on = t.id === value;
        return (
          <button
            key={t.id} type="button" role="radio" aria-checked={on} onClick={() => onPick(t)}
            className={cx("group rounded-control border p-2.5 text-left transition-colors", on ? "border-ink bg-surface ring-2 ring-ink/10" : "border-line hover:border-ink")}
          >
            <Thumb id={t.id} name={t.name} />
            <div className="mt-2.5 flex items-center justify-between gap-2">
              <span className="text-body-sm font-medium text-ink">{t.name}</span>
              {on && <span className="inline-flex items-center gap-1 text-[12px] font-medium text-ink"><Icon icon={Check} />Selected</span>}
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {t.atsSafe ? <Pill mark="ink">ATS-safe</Pill> : <Pill mark="accent">Two columns</Pill>}
            </div>
            <p className="mt-1.5 text-[12px] leading-snug text-muted">{t.description}</p>
          </button>
        );
      })}
    </div>
  );
}

// ---------- theme ----------

const SWATCHES = ["#1a1a1a", "#1f3a5f", "#2563eb", "#0f766e", "#16a34a", "#7c3aed", "#be123c", "#b45309"];

function Range({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  return (
    <Field label={`${label}: ${Number(value.toFixed(2))}${unit}`}>
      <input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[var(--accent)]" />
    </Field>
  );
}

export function ThemePanel({ theme, template, options, onChange, onReset }: {
  theme: ResumeTheme; template: ResumeTemplateInfo; options: ResumeTemplates; onChange: (patch: Partial<ResumeTheme>) => void; onReset: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Body font">
          <select className={inputClass} value={theme.font} onChange={(e) => onChange({ font: e.target.value })}>
            {options.fonts.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        </Field>
        <Field label="Heading font">
          <select className={inputClass} value={theme.headingFont ?? ""} onChange={(e) => onChange({ headingFont: e.target.value || undefined })}>
            <option value="">Same as body</option>
            {options.fonts.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        </Field>
      </div>

      <div>
        <span className="mb-1.5 block text-meta font-medium text-muted">Accent colour</span>
        <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Accent colour">
          {SWATCHES.map((c) => (
            <button
              key={c} type="button" role="radio" aria-checked={theme.accent.toLowerCase() === c} aria-label={`Accent ${c}`} onClick={() => onChange({ accent: c })}
              className={cx("h-7 w-7 rounded-full border-2 transition-transform hover:scale-110", theme.accent.toLowerCase() === c ? "border-ink" : "border-transparent ring-1 ring-black/10")}
              style={{ background: c }}
            />
          ))}
          <label className="ml-1 inline-flex items-center gap-2 text-meta text-muted">
            Custom
            <input type="color" aria-label="Custom accent colour" value={theme.accent} onChange={(e) => onChange({ accent: e.target.value })} className="h-7 w-9 cursor-pointer rounded border border-line bg-transparent p-0.5" />
          </label>
        </div>
      </div>

      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <Range label="Text size" value={theme.fontSize} min={8.5} max={13} step={0.25} unit="pt" onChange={(v) => onChange({ fontSize: v })} />
        <Range label="Line spacing" value={theme.lineHeight} min={1.05} max={1.7} step={0.01} unit="" onChange={(v) => onChange({ lineHeight: v })} />
        <Range label="Page margin" value={theme.margin} min={0.35} max={1.1} step={0.05} unit=" in" onChange={(v) => onChange({ margin: v })} />
        <Field label="Page size">
          <select className={inputClass} value={theme.pageSize} onChange={(e) => onChange({ pageSize: e.target.value as ResumeTheme["pageSize"] })}>
            {options.pageSizes.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </Field>
        <Field label="Header alignment">
          <select className={inputClass} value={theme.headerAlign} onChange={(e) => onChange({ headerAlign: e.target.value as ResumeTheme["headerAlign"] })} disabled={template.columns === 2}>
            <option value="left">Left</option>
            <option value="center">Centred</option>
          </select>
        </Field>
        <Field label="Target length" hint="Type is tightened to reach this. Your words are never cut.">
          <select className={inputClass} value={theme.pages} onChange={(e) => onChange({ pages: Number(e.target.value) })}>
            <option value={1}>1 page</option>
            <option value={2}>2 pages</option>
            <option value={3}>3 pages</option>
          </select>
        </Field>
      </div>
      <Button type="button" variant="secondary" icon={RotateCcw} onClick={onReset}>Reset to the {template.name} look</Button>
    </div>
  );
}

// ---------- ATS ----------

export function AtsPanel({ score, checks }: { score: number | null; checks: AtsCheck[] }) {
  if (score === null) return <p className="text-meta text-muted">The score appears once the preview has rendered.</p>;
  const failed = checks.filter((c) => !c.pass);
  return (
    <div>
      <div className="flex items-baseline gap-3">
        <span className="text-display-md font-semibold tnum text-ink" aria-label={`ATS score ${score} out of 100`}>{score}</span>
        <span className="text-meta text-muted">of 100 · {failed.length === 0 ? "every check passes" : `${failed.length} to fix`}</span>
      </div>
      <ul className="mt-3 divide-y divide-line rounded-control border border-line" aria-label="ATS checks">
        {checks.map((c) => (
          <li key={c.id} className="flex items-start gap-2.5 px-3 py-2 text-meta">
            <span className="mt-0.5 shrink-0 text-ink"><Icon icon={c.pass ? Check : Minus} /></span>
            <span className="min-w-0">
              <span className={c.pass ? "text-ink-2" : "font-medium text-ink"}>{c.label}</span>
              <span className="sr-only">{c.pass ? " passes" : " needs attention"}</span>
              {c.detail && <span className="block text-muted">{c.detail}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- preview ----------

export function PreviewPane({ html, pages, target, loading, error }: { html: string | null; pages: number | null; target: number; loading: boolean; error: string | null }) {
  const wrap = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [width, setWidth] = useState(640);
  const [height, setHeight] = useState(900);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const scale = Math.min(1.4, Math.max(0.3, (width - 2) / PAGE_PX));
  const measure = () => {
    const d = frame.current?.contentDocument?.documentElement;
    if (d) setHeight(Math.max(1056, d.scrollHeight));
  };
  const over = pages !== null && pages > target;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2" aria-live="polite">
        {pages !== null && <Pill mark={over ? "accent" : "ink"}>{pages} {pages === 1 ? "page" : "pages"}{over ? ` (target ${target})` : ""}</Pill>}
        {loading && <span className="text-meta text-muted">Updating preview…</span>}
        {over && <span className="text-meta text-muted">Try a smaller margin or text size, or the Compact template.</span>}
      </div>
      {error && <p role="alert" className="mb-2 rounded-lg border border-line bg-surface px-3 py-2 text-meta text-danger-fg">{error}</p>}
      <div ref={wrap} className="overflow-hidden rounded-control border border-line bg-sunken/60">
        {html ? (
          <div style={{ height: height * scale }} className="relative">
            <iframe
              ref={frame} title="Resume preview" srcDoc={html} sandbox="allow-same-origin" onLoad={measure}
              className="absolute left-0 top-0 border-0 bg-transparent"
              style={{ width: PAGE_PX, height, transform: `scale(${scale})`, transformOrigin: "top left" }}
            />
          </div>
        ) : (
          <div className="flex h-72 items-center justify-center text-meta text-muted">{loading ? "Rendering…" : "No preview yet"}</div>
        )}
      </div>
    </div>
  );
}

// ---------- export ----------

const FORMATS: { id: ResumeFormat; label: string; hint: string }[] = [
  { id: "pdf", label: "PDF", hint: "To upload or print" },
  { id: "docx", label: "Word (.docx)", hint: "To edit in Word or Google Docs" },
  { id: "txt", label: "Plain text", hint: "To paste into a form" },
  { id: "json", label: "JSON", hint: "A portable backup" },
  { id: "html", label: "HTML", hint: "To open in a browser" },
];

export function ExportMenu({ href }: { href: (format: ResumeFormat, inline?: boolean) => string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false; };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && ref.current) ref.current.open = false; };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, []);
  return (
    <details ref={ref} className="relative">
      <summary className="inline-flex h-9 cursor-pointer list-none items-center gap-2 rounded-full border border-line px-4 text-[13px] font-medium text-ink transition-colors hover:border-ink [&::-webkit-details-marker]:hidden">
        <Icon icon={Download} />Download<Icon icon={ChevronDown} />
      </summary>
      <ul className="absolute right-0 z-20 mt-2 w-64 rounded-control border border-line bg-surface p-1.5 shadow-lg" aria-label="Download formats">
        {FORMATS.map((f) => (
          <li key={f.id}>
            <a href={href(f.id)} download className="block rounded-lg px-3 py-2 hover:bg-sunken/60">
              <span className="block text-body-sm font-medium text-ink">{f.label}</span>
              <span className="block text-[12px] text-muted">{f.hint}</span>
            </a>
          </li>
        ))}
        <li>
          <a href={href("pdf", true)} target="_blank" rel="noreferrer" className="block rounded-lg px-3 py-2 hover:bg-sunken/60">
            <span className="block text-body-sm font-medium text-ink">Open PDF in a new tab</span>
          </a>
        </li>
      </ul>
    </details>
  );
}

// ---------- history ----------

export function VersionList({ docId, currentVersion, onRestore }: { docId: string; currentVersion: number; onRestore: (version: number) => Promise<void> }) {
  const [versions, setVersions] = useState<ResumeVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    api.resumeDocVersions(docId).then((v) => { if (live) setVersions(v); }).catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [docId, currentVersion]);

  if (error) return <p role="alert" className="text-meta text-danger-fg">{error}</p>;
  if (!versions) return <p className="text-meta text-muted">Loading history…</p>;
  if (versions.length === 0) return <p className="text-meta text-muted">No earlier versions yet. Every change you save is kept here.</p>;
  return (
    <ul className="divide-y divide-line rounded-control border border-line" aria-label="Version history">
      {versions.map((v) => (
        <li key={v.id} className="flex items-center gap-3 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="text-body-sm font-medium text-ink">Version {v.version}{v.label ? `: ${v.label}` : ""}</div>
            <div className="text-[12px] text-muted">{new Date(v.createdAt).toLocaleString()} · {v.stats.roles} roles · {v.stats.words} words · {v.templateId}</div>
          </div>
          <Button
            type="button" variant="secondary" icon={History} disabled={busy !== null}
            onClick={async () => { setBusy(v.version); try { await onRestore(v.version); } finally { setBusy(null); } }}
          >
            {busy === v.version ? "Restoring…" : "Restore"}
          </Button>
        </li>
      ))}
    </ul>
  );
}
