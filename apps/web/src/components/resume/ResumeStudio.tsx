"use client";

import { ArrowLeft, Copy, FileText, Star, Trash2, RefreshCw, Save } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api, resumeDocUrl, resumeUrl } from "@/lib/api";
import type { AtsCheck, Resume, ResumeContent, ResumeDoc, ResumeFormat, ResumeTemplates, ResumeTheme } from "@/lib/types";
import { Button, Icon, Notice, Pill, cx, inputClass } from "../ui";
import { ContentEditor } from "./ContentEditor";
import { stable, useDebounced } from "./model";
import { AtsPanel, ExportMenu, PreviewPane, TemplateGallery, ThemePanel, VersionList } from "./panels";

type DocProps = { mode: "doc"; doc: ResumeDoc; options: ResumeTemplates };
type AppProps = { mode: "application"; applicationId: string; resume: Resume; jobTitle: string; companyName: string; options: ResumeTemplates };
type Props = DocProps | AppProps;

type SaveState = { kind: "saved" | "dirty" | "saving" | "error" | "conflict"; message?: string; at?: number };
type Preview = { html: string; pages: number; target: number; atsScore: number; atsChecks: AtsCheck[] };
type Tab = "content" | "design" | "history";

function themeOf(options: ResumeTemplates, templateId: string, theme: Partial<ResumeTheme> | undefined): ResumeTheme {
  const base = (options.templates.find((t) => t.id === templateId) ?? options.templates[0]).theme;
  return { ...base, ...(theme ?? {}) } as ResumeTheme;
}

export function ResumeStudio(props: Props) {
  const { options } = props;
  const router = useRouter();
  const isDoc = props.mode === "doc";
  const initial = useMemo(() => {
    if (props.mode === "doc") return { content: props.doc.content, templateId: props.doc.templateId, theme: themeOf(options, props.doc.templateId, props.doc.theme as Partial<ResumeTheme>), name: props.doc.name, version: props.doc.version };
    const r = props.resume;
    return { content: r.content, templateId: r.templateId ?? "ats", theme: themeOf(options, r.templateId ?? "ats", r.theme), name: "", version: r.version };
    // The studio is keyed by document/resume id in the page, so initial props are read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [content, setContent] = useState<ResumeContent>(initial.content);
  const [templateId, setTemplateId] = useState(initial.templateId);
  const [theme, setTheme] = useState<ResumeTheme>(initial.theme);
  const [name, setName] = useState(initial.name);
  const [version, setVersion] = useState(initial.version);
  const [isDefault, setIsDefault] = useState(props.mode === "doc" ? props.doc.isDefault : false);
  const [save, setSave] = useState<SaveState>({ kind: "saved" });
  const [tab, setTab] = useState<Tab>("content");
  const [pane, setPane] = useState<"edit" | "preview">("edit");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const template = options.templates.find((t) => t.id === templateId) ?? options.templates[0];
  const snapshot = useMemo(() => ({ name, content, templateId, theme }), [name, content, templateId, theme]);
  const key = useMemo(() => stable(snapshot), [snapshot]);
  const savedKey = useRef(key);
  const latest = useRef({ snapshot, version });
  const saving = useRef(false);
  const again = useRef(false);
  useEffect(() => { latest.current = { snapshot, version }; });
  const dirty = key !== savedKey.current || save.kind === "saving";

  // ---- live preview (debounced; stale answers are dropped)
  const previewInput = useDebounced(useMemo(() => ({ content, templateId, theme }), [content, templateId, theme]), 450);
  const [answered, setAnswered] = useState<typeof previewInput | null>(null);
  const previewLoading = answered !== previewInput;
  const seq = useRef(0);
  useEffect(() => {
    const mine = ++seq.current;
    const input = previewInput;
    api.previewResume(previewInput.content, previewInput.templateId, previewInput.theme)
      .then((r) => { if (mine === seq.current) { setPreview({ html: r.html, pages: r.pages, target: r.targetPages, atsScore: r.atsScore, atsChecks: r.atsChecks }); setPreviewError(null); } })
      .catch((e: Error) => { if (mine === seq.current) setPreviewError(e instanceof ApiError ? e.detail : e.message); })
      .finally(() => { if (mine === seq.current) setAnswered(input); });
  }, [previewInput]);

  // ---- autosave (library documents)
  const saveDoc = useCallback(async () => {
    if (props.mode !== "doc") return;
    if (saving.current) { again.current = true; return; }
    saving.current = true;
    const { snapshot: s, version: v } = latest.current;
    const sentKey = stable(s);
    setSave({ kind: "saving" });
    try {
      const next = await api.updateResumeDoc(props.doc.id, { name: s.name, content: s.content, templateId: s.templateId, theme: s.theme, expectedVersion: v });
      savedKey.current = sentKey;
      setVersion(next.version);
      latest.current.version = next.version;
      setSave({ kind: "saved", at: Date.now() });
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 409) setSave({ kind: "conflict", message: err.message });
      else setSave({ kind: "error", message: err instanceof ApiError ? err.detail : (e as Error).message });
    } finally {
      saving.current = false;
      if (again.current) { again.current = false; setTimeout(() => void saveDoc(), 50); }
    }
  }, [props]);

  const autosave = useDebounced(key, 1200);
  useEffect(() => {
    if (!isDoc || autosave === savedKey.current || save.kind === "conflict") return;
    void saveDoc();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autosave]);

  useEffect(() => {
    if (key !== savedKey.current && save.kind === "saved") setSave({ kind: "dirty" });
  }, [key, save.kind]);

  // unsaved-changes guard and Ctrl/Cmd+S
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (key !== savedKey.current) { e.preventDefault(); e.returnValue = ""; } };
    const keys = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); if (isDoc) void saveDoc(); else void saveApplication(); }
    };
    window.addEventListener("beforeunload", warn);
    window.addEventListener("keydown", keys);
    return () => { window.removeEventListener("beforeunload", warn); window.removeEventListener("keydown", keys); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, isDoc]);

  // ---- application mode
  async function saveApplication() {
    if (props.mode !== "application") return;
    setBusy("save"); setNotice(null);
    try {
      await api.editApplicationResume(props.applicationId, { content, templateId, theme });
      savedKey.current = key;
      router.push(`/applications/${props.applicationId}`);
      router.refresh();
    } catch (e) {
      setSave({ kind: "error", message: e instanceof ApiError ? e.detail : (e as Error).message });
    } finally { setBusy(null); }
  }

  // ---- document actions
  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label); setNotice(null);
    try { await fn(); } catch (e) { setNotice(e instanceof ApiError ? e.detail : (e as Error).message); } finally { setBusy(null); }
  }
  const adopt = (d: ResumeDoc) => {
    setContent(d.content); setTemplateId(d.templateId); setTheme(themeOf(options, d.templateId, d.theme as Partial<ResumeTheme>)); setName(d.name); setVersion(d.version);
    latest.current.version = d.version;
    savedKey.current = stable({ name: d.name, content: d.content, templateId: d.templateId, theme: themeOf(options, d.templateId, d.theme as Partial<ResumeTheme>) });
    setSave({ kind: "saved", at: Date.now() });
  };
  const docId = props.mode === "doc" ? props.doc.id : "";

  const pickTemplate = (t: { id: string; theme: ResumeTheme }) => { setTemplateId(t.id); setTheme(t.theme); };
  const exportHref = (f: ResumeFormat, inline?: boolean) => (props.mode === "doc" ? resumeDocUrl(props.doc.id, f, inline) : resumeUrl(props.resume.id, f, inline));

  const status = (() => {
    if (!isDoc) return dirty ? "Unsaved changes" : "No changes yet";
    switch (save.kind) {
      case "saving": return "Saving…";
      case "dirty": return "Unsaved changes";
      case "error": return `Not saved: ${save.message}`;
      case "conflict": return "Not saved: changed elsewhere";
      default: return save.at ? `Saved · version ${version}` : `Version ${version}`;
    }
  })();

  return (
    <div className="pb-16">
      {isDoc && <h1 className="sr-only">Resume studio: {name || "Untitled resume"}</h1>}
      <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-3">
        <Link href={isDoc ? "/resume" : `/applications/${(props as AppProps).applicationId}`} className="inline-flex items-center gap-1.5 text-meta text-muted hover:text-ink">
          <Icon icon={ArrowLeft} />{isDoc ? "All resumes" : "Back to the review"}
        </Link>
        {isDoc ? (
          <input aria-label="Resume name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} className={cx(inputClass, "h-10 max-w-sm font-display text-title")} />
        ) : (
          <h1 className="font-display text-title font-medium text-ink">Edit resume for {(props as AppProps).jobTitle} at {(props as AppProps).companyName}</h1>
        )}
        <span role="status" aria-live="polite" className={cx("text-meta", save.kind === "error" || save.kind === "conflict" ? "text-accent-ink" : "text-muted")}>{status}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {isDoc && isDefault && <Pill mark="ink">Default</Pill>}
          {isDoc && !isDefault && <Button type="button" variant="secondary" icon={Star} disabled={busy !== null} onClick={() => run("default", async () => { await api.setDefaultResumeDoc(docId); setIsDefault(true); setNotice("This is now the resume the agent starts from and styles tailored resumes after."); })}>Make default</Button>}
          <ExportMenu href={exportHref} />
          {isDoc ? (
            <Button type="button" variant="primary" icon={Save} onClick={() => void saveDoc()} disabled={!dirty || save.kind === "saving" || save.kind === "conflict"}>Save now</Button>
          ) : (
            <Button type="button" variant="primary" icon={Save} onClick={() => void saveApplication()} disabled={busy !== null || !dirty}>{busy === "save" ? "Saving…" : "Save and re-render"}</Button>
          )}
        </div>
      </div>

      {save.kind === "conflict" && (
        <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-accent bg-paper px-4 py-3 text-body-sm text-ink">
          <span>{save.message}</span>
          <Button type="button" variant="secondary" onClick={() => window.location.reload()}>Reload</Button>
        </div>
      )}
      {!isDoc && <Notice label="Good to know">Your edits are marked “Edited by you” in the review. Nothing is sent until you approve, and approving sends the version you save here.</Notice>}
      {notice && <div className="mb-4"><Notice label="Note">{notice}</Notice></div>}

      <div className="mb-4 flex gap-2 lg:hidden" role="tablist" aria-label="Edit or preview">
        {(["edit", "preview"] as const).map((p) => (
          <button key={p} type="button" role="tab" aria-selected={pane === p} onClick={() => setPane(p)} className={cx("h-9 rounded-full border px-4 text-[13px] font-medium", pane === p ? "border-ink bg-ink text-paper" : "border-line text-ink")}>{p === "edit" ? "Edit" : "Preview"}</button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <div className={cx("min-w-0 space-y-5", pane === "preview" && "hidden lg:block")}>
          <div role="tablist" aria-label="Resume sections" className="flex flex-wrap gap-2">
            {(isDoc ? (["content", "design", "history"] as const) : (["content", "design"] as const)).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cx("h-9 rounded-full border px-4 text-[13px] font-medium capitalize", tab === t ? "border-ink bg-ink text-paper" : "border-line text-ink hover:border-ink")}>{t}</button>
            ))}
          </div>

          {tab === "content" && (
            <>
              {isDoc && (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" icon={RefreshCw} disabled={busy !== null} onClick={() => { if (window.confirm("Replace this resume's roles, bullets and skills with what your career graph says now? Your summary and layout are kept, and the current version stays in History.")) void run("refresh", async () => { await api.refreshResumeDoc(docId).then(adopt); setNotice("Refreshed from your career graph. The earlier version is in History."); }); }}>Refresh from my graph</Button>
                  <Button type="button" variant="secondary" icon={Copy} disabled={busy !== null} onClick={() => void run("dup", async () => { const d = await api.duplicateResumeDoc(docId); router.push(`/resume/${d.id}`); })}>Duplicate</Button>
                  <Button type="button" variant="danger" icon={Trash2} disabled={busy !== null} onClick={() => { if (window.confirm(`Delete “${name}”? This cannot be undone.`)) void run("del", async () => { await api.deleteResumeDoc(docId); savedKey.current = key; router.push("/resume"); router.refresh(); }); }}>Delete</Button>
                </div>
              )}
              <ContentEditor content={content} onChange={setContent} />
            </>
          )}

          {tab === "design" && (
            <div className="space-y-6">
              <section aria-labelledby="h-template">
                <h2 id="h-template" className="mb-3 font-display text-title font-medium text-ink">Template</h2>
                <TemplateGallery templates={options.templates} value={templateId} onPick={pickTemplate} />
                {!template.atsSafe && <p className="mt-3 text-meta text-muted">Two-column layouts can scramble the reading order in applicant tracking systems. Use this one for people, not portals.</p>}
              </section>
              <section aria-labelledby="h-theme">
                <h2 id="h-theme" className="mb-3 font-display text-title font-medium text-ink">Style</h2>
                <ThemePanel theme={theme} template={template} options={options} onChange={(p) => setTheme((t) => ({ ...t, ...p }))} onReset={() => setTheme(template.theme)} />
              </section>
            </div>
          )}

          {tab === "history" && isDoc && (
            <VersionList docId={docId} currentVersion={version} onRestore={async (v) => { await run("restore", async () => { adopt(await api.restoreResumeDocVersion(docId, v)); setNotice(`Restored version ${v}. The version it replaced is in History.`); setTab("content"); }); }} />
          )}
        </div>

        <div className={cx("min-w-0 space-y-6 lg:sticky lg:top-4 lg:self-start", pane === "edit" && "hidden lg:block")}>
          <PreviewPane html={preview?.html ?? null} pages={preview?.pages ?? null} target={preview?.target ?? theme.pages} loading={previewLoading} error={previewError} />
          <section aria-labelledby="h-ats" className="rounded-2xl border border-line bg-paper p-4 sm:p-5">
            <h2 id="h-ats" className="mb-3 flex items-center gap-2 font-display text-title font-medium text-ink"><Icon icon={FileText} />ATS check</h2>
            <AtsPanel score={preview?.atsScore ?? null} checks={preview?.atsChecks ?? []} />
          </section>
        </div>
      </div>
    </div>
  );
}
