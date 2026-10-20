"use client";

import { Copy, FileUp, Network, Plus, Star, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ApiError, api, resumeDocUrl } from "@/lib/api";
import type { ResumeContent, ResumeDocSummary, ResumeTemplates } from "@/lib/types";
import { Button, EmptyState, Notice, Pill } from "../ui";
import { ExportMenu } from "./panels";

const THUMB_W = 200;
const PAGE_PX = 816;

function Thumb({ id, version }: { id: string; version: number }) {
  const scale = THUMB_W / PAGE_PX;
  return (
    <div className="relative overflow-hidden rounded-md border border-line bg-white" style={{ width: THUMB_W, height: Math.round(1056 * scale) }} aria-hidden="true">
      <iframe
        title="Resume thumbnail" src={`${resumeDocUrl(id, "html", true)}&v=${version}`} loading="lazy" tabIndex={-1} sandbox="allow-same-origin"
        className="pointer-events-none absolute left-0 top-0 border-0"
        style={{ width: PAGE_PX, height: 1056, transform: `scale(${scale})`, transformOrigin: "top left" }}
      />
    </div>
  );
}

const SOURCE: Record<ResumeDocSummary["source"], string> = { graph: "From your graph", upload: "Uploaded", manual: "Written by you", copy: "Copy", text: "Pasted" };

export function ResumeLibrary({ docs, options }: { docs: ResumeDocSummary[]; options: ResumeTemplates }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const templateName = (id: string) => options.templates.find((t) => t.id === id)?.name ?? id;

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label); setError(null);
    try { await fn(); } catch (e) { setError(e instanceof ApiError ? e.detail : (e as Error).message); } finally { setBusy(null); }
  }
  const open = (id: string) => router.push(`/resume/${id}`);

  async function importJson(f: File | undefined) {
    if (!f) return;
    await run("import", async () => {
      let parsed: { content?: ResumeContent; template?: string };
      try { parsed = JSON.parse(await f.text()); } catch { throw new Error("That file is not valid JSON."); }
      if (!parsed.content?.name && !parsed.content?.experience) throw new Error("That file is not a Nori resume export.");
      const d = await api.createResumeDoc({ from: "content", name: f.name.replace(/\.json$/i, ""), content: parsed.content, templateId: parsed.template });
      open(d.id);
    });
    if (file.current) file.current.value = "";
  }

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center gap-3">
        <Button type="button" variant="primary" icon={Network} disabled={busy !== null} onClick={() => void run("graph", async () => open((await api.createResumeDoc({ from: "graph" })).id))}>New from my career graph</Button>
        <Button type="button" variant="secondary" icon={Plus} disabled={busy !== null} onClick={() => void run("blank", async () => open((await api.createResumeDoc({ from: "blank" })).id))}>Blank resume</Button>
        <Button type="button" variant="secondary" icon={FileUp} disabled={busy !== null} onClick={() => file.current?.click()}>Import JSON</Button>
        <input ref={file} type="file" accept="application/json,.json" aria-label="Import a resume from a JSON file" className="sr-only" onChange={(e) => void importJson(e.target.files?.[0])} />
      </div>
      {error && <div className="mb-6"><Notice tone="red" label="Error">{error}</Notice></div>}

      {docs.length === 0 ? (
        <EmptyState title="No resumes yet">Add your resume in onboarding, or build one from your career graph above.</EmptyState>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-6" aria-label="Your resumes">
          {docs.map((d) => (
            <li key={d.id} className="flex flex-col rounded-2xl border border-line bg-paper p-4">
              <Link href={`/resume/${d.id}`} className="block rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink" aria-label={`Open ${d.name}`}>
                <Thumb id={d.id} version={d.version} />
              </Link>
              <div className="mt-4 flex items-start justify-between gap-2">
                <Link href={`/resume/${d.id}`} className="min-w-0 font-display text-title font-medium text-ink hover:underline">{d.name}</Link>
                {d.isDefault && <Pill mark="ink">Default</Pill>}
              </div>
              <p className="mt-1 text-meta text-muted">{templateName(d.templateId)} · {SOURCE[d.source]}</p>
              <p className="text-meta text-muted tnum">{d.stats.roles} roles · {d.stats.bullets} bullets · {d.stats.words} words</p>
              <p className="text-[12px] text-faint">Edited {new Date(d.updatedAt).toLocaleDateString()} · version {d.version}</p>
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                {!d.isDefault && <Button type="button" variant="secondary" icon={Star} disabled={busy !== null} onClick={() => void run(`def-${d.id}`, async () => { await api.setDefaultResumeDoc(d.id); router.refresh(); })}>Make default</Button>}
                <Button type="button" variant="secondary" icon={Copy} disabled={busy !== null} onClick={() => void run(`dup-${d.id}`, async () => { await api.duplicateResumeDoc(d.id); router.refresh(); })}>Duplicate</Button>
                <ExportMenu href={(f, inline) => resumeDocUrl(d.id, f, inline)} />
                <Button
                  type="button" variant="danger" icon={Trash2} disabled={busy !== null} aria-label={`Delete ${d.name}`}
                  onClick={() => { if (window.confirm(`Delete “${d.name}”? This cannot be undone.`)) void run(`del-${d.id}`, async () => { await api.deleteResumeDoc(d.id); router.refresh(); }); }}
                >Delete</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-10 max-w-prose text-meta text-muted">The <strong>default</strong> resume is the one the agent starts from. Its contact details, summary, section order, template and style carry over to every resume it tailors for a job.</p>
    </div>
  );
}
