"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft, ArrowUpRight, Check, CircleCheck, CircleX, ExternalLink, LoaderCircle, Pencil, RotateCcw, Send, SkipForward,
} from "lucide-react";
import { api, artifactUrl, USE_MOCK } from "@/lib/api";
import { NEEDS_YOU, STATUS_LABEL } from "@/lib/format";
import {
  APPLICATION_STATUSES,
  type Application, type ApplicationDetail, type ApplicationStatus, type Company, type Job, type Resume, type RunEvent, type RunEventRow,
} from "@/lib/types";
import { DiffRow } from "./DiffRow";
import { EventLog } from "./EventLog";
import { ResearchView } from "./ResearchPanel";
import { RecruiterView } from "./RecruiterView";
import { ResumePreview } from "./ResumePreview";
import { PIPELINE, Stepper } from "./Stepper";
import { StatusPill } from "./StatusPill";
import { TimeAgo } from "./TimeAgo";
import {
  Accordion, Button, Frame, Icon, IndexLabel, LinkButton, Notice, Pill, Tag, cx, idx, inputClass,
} from "./ui";

type NodeLabels = Record<string, { label: string; type: string }>;

const TERMINAL: ApplicationStatus[] = ["submitted", "failed", "skipped", "viewed", "replied", "interview", "offer", "rejected"];
const evKey = (e: { step: string; message: string }) => `${e.step}|${e.message}`;

/** Block header: hairline, index + label on the left, one action on the right. No paragraph. */
function BlockHead({ index, label, action }: { index: string; label: ReactNode; action?: ReactNode }) {
  return (
    <header className="flex min-h-12 flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
      <IndexLabel index={index} marker tone="ink">{label}</IndexLabel>
      {action}
    </header>
  );
}

export function ApplicationReview({ initial, nodeLabels }: { initial: ApplicationDetail; nodeLabels: NodeLabels }) {
  const [app, setApp] = useState<Application>(initial.application);
  const [resume, setResume] = useState<Resume | null>(initial.resume);
  const [recruiter, setRecruiter] = useState(initial.recruiter ?? null);
  const [events, setEvents] = useState<RunEventRow[]>(initial.events);
  const job: Job = initial.job;
  const company: Company | null = initial.company;
  const [transport, setTransport] = useState<"live" | "polling">("live");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [answers, setAnswers] = useState<Record<string, string>>(initial.application.answers);
  const [pending, setPending] = useState<Record<string, string>>({});

  const seen = useRef(new Set(initial.events.map(evKey)));
  const statusRef = useRef(app.status);
  useEffect(() => { statusRef.current = app.status; }, [app.status]);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pushEvent = useCallback((ev: RunEventRow) => {
    const k = evKey(ev);
    if (seen.current.has(k)) return;
    seen.current.add(k);
    setEvents((prev) => [...prev, ev].sort((a, b) => +new Date(a.ts) - +new Date(b.ts)));
  }, []);

  /** Re-read the application from the API (no-op in mock mode, where state is local). */
  const refresh = useCallback(async () => {
    if (USE_MOCK) return;
    try {
      const d = await api.getApplication(app.id);
      setApp(d.application);
      setResume(d.resume);
      setRecruiter(d.recruiter ?? null);
      setAnswers((prev) => (Object.keys(prev).length === 0 ? d.application.answers : { ...d.application.answers, ...prev }));
      d.events.forEach(pushEvent);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [app.id, pushEvent]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(refresh, 500);
  }, [refresh]);

  const onRunEvent = useCallback((e: RunEvent) => {
    pushEvent({ ts: e.ts ?? new Date().toISOString(), level: e.level ?? "info", step: e.step, message: e.message, data: e.data });
    if ((APPLICATION_STATUSES as readonly string[]).includes(e.step)) {
      if (USE_MOCK) setApp((a) => ({ ...a, status: e.step as ApplicationStatus }));
      else scheduleRefresh();
    }
  }, [pushEvent, scheduleRefresh]);

  // Live stream: SSE with polling fallback. In mock mode, play a scripted run.
  const live = !TERMINAL.includes(app.status);
  const mode = !live ? "idle" : USE_MOCK ? "simulated" : transport;
  useEffect(() => {
    if (!live) return;
    if (USE_MOCK) {
      let cancelled = false;
      const timers: ReturnType<typeof setTimeout>[] = [];
      import("@/lib/mock").then((m) => {
        if (cancelled) return;
        m.eventScript(statusRef.current).forEach((ev, i) => {
          timers.push(setTimeout(() => onRunEvent({ applicationId: app.id, ...ev }), 1800 * (i + 1)));
        });
      });
      return () => { cancelled = true; timers.forEach(clearTimeout); };
    }

    let es: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    const startPolling = () => {
      if (poll) return;
      setTransport("polling");
      poll = setInterval(refresh, 3000);
    };
    try {
      es = new EventSource(api.eventsUrl(app.id));
      es.onopen = () => setTransport("live");
      const handler = (m: MessageEvent) => {
        try { onRunEvent(JSON.parse(m.data as string) as RunEvent); } catch { /* ignore keep-alives */ }
      };
      es.onmessage = handler;
      es.addEventListener("run_event", handler as EventListener);
      es.onerror = () => {
        es?.close();
        es = null;
        startPolling();
      };
    } catch {
      setTimeout(startPolling, 0);
    }
    return () => { es?.close(); if (poll) clearInterval(poll); };
  }, [live, app.id, onRunEvent, refresh]);

  useEffect(() => () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); }, []);

  // ---- actions
  async function act(name: string, fn: () => Promise<void>, optimistic?: Partial<Application>) {
    setBusy(name);
    setError(null);
    try {
      await fn();
      if (optimistic) setApp((a) => ({ ...a, ...optimistic }));
      scheduleRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const now = () => new Date().toISOString();
  const approveResume = () =>
    act("resume", () => api.approveResume(app.id), { status: "filling", resumeApprovedAt: now() });
  const skip = () => act("skip", () => api.skipApplication(app.id), { status: "skipped" });
  const retry = () => act("retry", () => api.retryApplication(app.id), { status: "queued", error: null });

  const requiredMissing = app.pendingQuestions.filter((q) => q.required && !pending[q.label]?.trim());
  const approveForm = () =>
    act("form", async () => {
      const filled = Object.fromEntries(Object.entries(pending).filter(([, v]) => v.trim()));
      if (Object.keys(filled).length > 0) await api.answerQuestions(app.id, filled);
      await api.approveForm(app.id, { ...answers, ...filled });
    }, { status: "submitting", formApprovedAt: now(), pendingQuestions: [], answers: { ...answers, ...pending } });

  // What Autopilot decided about this form, in its own words (see runner/autopilot.ts).
  const autopilotEvent = [...events].reverse().find((e) => e.step === "autopilot");
  const autopilotNote = autopilotEvent ? { sent: app.autopilot === true, text: autopilotEvent.message.replace(/^Autopilot /, "").replace(/^./, (c) => c.toUpperCase()) } : null;
  const lastStep = [...events].reverse().map((e) => e.step).find((s) => (PIPELINE as string[]).includes(s));
  const formEditable = app.status === "form_review" || app.status === "needs_user";
  const showForm = formEditable || app.status === "awaiting_code" || (Object.keys(answers).length > 0 && !app.receipt);
  const answerCount = Object.keys(answers).length;
  const canSkip = !["skipped", "submitted", "viewed", "replied", "interview", "offer", "rejected"].includes(app.status);
  const canRetry = ["failed", "needs_user", "skipped"].includes(app.status);

  // numbering follows the on-screen order (the form jumps first when it needs you)
  const order: string[] = [
    ...(formEditable && showForm ? ["form"] : []),
    "resume",
    ...(resume && resume.changes.length > 0 ? ["changes"] : []),
    ...(!formEditable && showForm ? ["form"] : []),
    ...(app.receipt ? ["receipt"] : []),
  ];
  const num = (k: string) => idx(order.indexOf(k) + 1);
  const failing = resume?.atsChecks.filter((c) => !c.pass) ?? [];

  // ---- 01 hero: the rendered resume, ATS score beside it
  const resumeBlock = (
    <section id="resume" className="scroll-mt-24">
      <BlockHead index={num("resume")} label={resume ? `Resume · v${resume.version}` : "Resume"} />
      <div className="mt-6 grid grid-cols-12 gap-x-6 gap-y-8">
        <figure className="col-span-12 lg:col-span-8">
          <Frame className="p-2 sm:p-3">
            {resume ? (
              <ResumePreview resume={resume} className="h-[560px] sm:h-[880px]" />
            ) : (
              <div className="flex h-[420px] flex-col items-center justify-center gap-3 text-center">
                <Icon icon={app.status === "queued" || app.status === "tailoring" ? LoaderCircle : CircleX} className={cx(app.status === "tailoring" && "animate-spin")} />
                <p className="font-display text-title font-medium text-ink">
                  {app.status === "queued" || app.status === "tailoring" ? "Building your resume" : "No resume for this one"}
                </p>
              </div>
            )}
          </Frame>
        </figure>

        <aside className="col-span-12 flex flex-col gap-8 lg:col-span-4">
          {resume && recruiter && <RecruiterView review={recruiter} />}
          {resume && (
            <div>
              <IndexLabel>ATS score</IndexLabel>
              <div className="mt-3 font-display text-[88px] font-medium leading-[0.85] tracking-[-0.05em] text-ink tnum">
                {resume.atsScore ?? "–"}
              </div>
              {resume.edited && <p className="mt-2"><Pill mark="accent">Edited by you</Pill></p>}
              <p className="mt-3 text-meta text-muted tnum">
                {resume.templateId ? <>{resume.templateId === "ats" ? "ATS Standard" : resume.templateId[0].toUpperCase() + resume.templateId.slice(1)} template &middot; </> : null}{resume.pages ?? "?"} page{resume.pages === 1 ? "" : "s"}
                {resume.keywordCoverage != null && <> &middot; keywords {Math.round(resume.keywordCoverage * 100)}%</>}
                {failing.length > 0 && <> &middot; <span title={failing.map((c) => c.label).join("\n")} className="cursor-help underline decoration-line-strong decoration-dotted underline-offset-4">{failing.length} check{failing.length === 1 ? "" : "s"} to fix</span></>}
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                {app.resumeApprovedAt ? (
                  <Pill mark="none"><Icon icon={Check} />Approved</Pill>
                ) : (
                  <Button variant="primary" icon={CircleCheck} onClick={approveResume} disabled={busy !== null || app.status !== "resume_review"}>
                    {busy === "resume" ? "Approving..." : "Approve resume"}
                  </Button>
                )}
                {!USE_MOCK && app.status === "resume_review" && (
                  <LinkButton href={`/applications/${app.id}/resume`} variant="secondary" icon={Pencil}>Edit resume</LinkButton>
                )}
                {!USE_MOCK && (
                  <a href={api.resumePdfUrl(resume.id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-meta font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
                    Open PDF <Icon icon={ArrowUpRight} />
                  </a>
                )}
              </div>
            </div>
          )}
          <div className={cx(resume && "border-t border-line pt-6")}>
            <EventLog events={events} mode={mode} />
          </div>
        </aside>
      </div>
    </section>
  );

  // ---- changes: one line each, reason + provenance on hover / "why"
  const changesBlock = resume && resume.changes.length > 0 ? (
    <section>
      <BlockHead index={num("changes")} label={<>Changes <span className="text-faint">{resume.changes.length}</span></>} />
      <ol className="mt-2 border-t border-line">
        {resume.changes.map((c, i) => <DiffRow key={c.bulletId} change={c} nodeLabels={nodeLabels} index={i + 1} />)}
      </ol>
    </section>
  ) : null;

  const answerRows = (
    <ol className="border-t border-line">
      {Object.entries(answers).map(([label, value], i) => (
        <li key={label} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-b border-line py-2.5 sm:grid-cols-[2.5rem_minmax(0,13rem)_minmax(0,1fr)] sm:items-center sm:gap-x-4">
          <span className="text-label font-medium text-faint tnum">{idx(i + 1)}</span>
          <label htmlFor={`ans-${i}`} className="text-meta text-ink-2">{label}</label>
          <div className="col-start-2 sm:col-start-3">
            {value.length > 70 ? (
              <textarea id={`ans-${i}`} className={inputClass} rows={3} value={value} disabled={!formEditable} onChange={(e) => setAnswers((a) => ({ ...a, [label]: e.target.value }))} />
            ) : (
              <input id={`ans-${i}`} className={inputClass} value={value} disabled={!formEditable} onChange={(e) => setAnswers((a) => ({ ...a, [label]: e.target.value }))} />
            )}
          </div>
        </li>
      ))}
    </ol>
  );

  // ---- form: only what needs you; everything else folded
  const formBlock = showForm ? (
    <section>
      <BlockHead
        index={num("form")}
        label="Form"
        action={
          formEditable ? (
            <Button variant="primary" icon={Send} onClick={approveForm} disabled={busy !== null || requiredMissing.length > 0}>
              {busy === "form" ? "Sending..." : "Approve and send"}
            </Button>
          ) : app.formApprovedAt ? (
            <Pill mark="none"><Icon icon={Check} />Approved</Pill>
          ) : undefined
        }
      />

      {app.pendingQuestions.length > 0 && (
        <Frame className="mt-4 p-5 sm:p-6">
          <IndexLabel marker="accent" tone="ink">Needs you &middot; {app.pendingQuestions.length}</IndexLabel>
          <div className="mt-5 space-y-5">
            {app.pendingQuestions.map((q) => (
              <label key={q.label} className="block">
                <span className="mb-1.5 block text-body-sm font-medium text-ink">
                  {q.label}{q.required && <span className="ml-1 text-accent-ink" aria-label="required">*</span>}
                </span>
                {q.options?.length ? (
                  <select className={inputClass} value={pending[q.label] ?? ""} onChange={(e) => setPending((p) => ({ ...p, [q.label]: e.target.value }))}>
                    <option value="">Select...</option>
                    {q.options.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : q.type === "textarea" ? (
                  <textarea className={inputClass} rows={3} value={pending[q.label] ?? ""} onChange={(e) => setPending((p) => ({ ...p, [q.label]: e.target.value }))} />
                ) : (
                  <input className={inputClass} value={pending[q.label] ?? ""} onChange={(e) => setPending((p) => ({ ...p, [q.label]: e.target.value }))} />
                )}
              </label>
            ))}
          </div>
        </Frame>
      )}

      {answerCount > 0 ? (
        <Accordion className="mt-4" title={`All ${answerCount} filled fields`}>{answerRows}</Accordion>
      ) : (
        <p className="mt-4 border-y border-line py-4 text-body-sm text-muted">No answers yet.</p>
      )}
    </section>
  ) : null;

  // ---- receipt: the screenshot is the proof
  const receiptBlock = app.receipt ? (
    <section>
      <BlockHead
        index={num("receipt")}
        label="Receipt"
        action={
          <div className="flex flex-wrap items-center gap-2 text-meta text-muted">
            {app.receipt.dryRun && <Pill mark="accent">Dry run</Pill>}
            <span>Sent <TimeAgo iso={app.submittedAt} /> via {app.receipt.submittedVia}</span>
          </div>
        }
      />
      {app.receipt.screenshotPath && (
        <figure className="mt-6">
          <Frame className="p-2 sm:p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={USE_MOCK ? mockScreenshot(job.companyName) : artifactUrl(app.receipt.screenshotPath)}
              alt="Confirmation page screenshot"
              className="block w-full grayscale"
            />
          </Frame>
          {app.receipt.confirmationText && (
            <figcaption className="mt-3 text-meta text-ink-2">&ldquo;{app.receipt.confirmationText}&rdquo;</figcaption>
          )}
        </figure>
      )}
      <Accordion className="mt-4" title={`Submitted fields`} meta={app.receipt.fields.length}>
        <dl className="border-t border-line text-body-sm">
          {app.receipt.fields.map((f) => (
            <div key={f.label} className="grid gap-x-4 gap-y-0.5 border-b border-line py-2.5 sm:grid-cols-[11rem_1fr]">
              <dt className="text-meta text-muted">{f.label}</dt>
              <dd className="break-words text-ink">{f.value}</dd>
            </div>
          ))}
        </dl>
        {app.receipt.files.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            {app.receipt.files.map((f) => <Tag key={f} kind="file">{f}</Tag>)}
          </div>
        )}
      </Accordion>
    </section>
  ) : null;

  return (
    <div>
      {/* header */}
      <header className="grid grid-cols-12 gap-x-6 gap-y-4">
        <div className="col-span-12 lg:col-span-8">
          <Link href="/applications" className="inline-flex items-center gap-1.5 text-meta text-muted transition-colors duration-150 hover:text-ink">
            <Icon icon={ArrowLeft} /> Applications
          </Link>
          <h1 className="mt-4 font-display text-[2.375rem] font-medium leading-[1] tracking-[-0.04em] text-ink text-balance sm:text-display-xl">{job.title}</h1>
          <p className="mt-3 font-display text-title text-ink-2">
            {job.companyName}{job.location && <span className="text-muted"> &middot; {job.location}</span>}
          </p>
        </div>
        <div className="col-span-12 flex flex-col gap-4 lg:col-span-4 lg:items-end lg:self-end">
          <div className="flex flex-wrap items-center gap-3 lg:justify-end">
            <StatusPill status={app.status} />
            <span className="text-meta text-muted"><TimeAgo iso={app.updatedAt} /></span>
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            {canRetry && <Button variant="secondary" icon={RotateCcw} onClick={retry} disabled={busy !== null}>Retry</Button>}
            {canSkip && <Button variant="secondary" icon={SkipForward} onClick={skip} disabled={busy !== null}>Skip</Button>}
            <a href={job.applyUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 px-1 text-[13px] font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
              Posting <Icon icon={ExternalLink} />
            </a>
          </div>
        </div>
      </header>

      <Frame className="mt-10 px-5 py-6 sm:px-8 sm:py-7">
        <Stepper status={app.status} lastStep={lastStep} />
      </Frame>

      {(error || app.error || NEEDS_YOU.includes(app.status) || autopilotNote) && (
        <div className="mt-6 space-y-3">
          {error && <Notice tone="red">{error}</Notice>}
          {autopilotNote && <Notice tone={autopilotNote.sent ? "green" : "amber"} label="Autopilot">{autopilotNote.text}</Notice>}
          {app.error && <Notice tone="red" label="Run error">{app.error}</Notice>}
          {NEEDS_YOU.includes(app.status) && (
            <Notice tone="amber" label="Your turn">
              {app.status === "resume_review" && "Approve the resume to continue."}
              {app.status === "form_review" && "Check the form, then send."}
              {app.status === "needs_user" && `${app.pendingQuestions.length || "Some"} question${app.pendingQuestions.length === 1 ? "" : "s"} need${app.pendingQuestions.length === 1 ? "s" : ""} your answer.`}
              {app.status === "awaiting_code" && (<>Waiting for the verification code from your <Link href="/inbox" className="underline underline-offset-4">inbox</Link>.</>)}
            </Notice>
          )}
        </div>
      )}

      <div className="mt-14 flex min-w-0 flex-col gap-20">
        {formEditable && formBlock}
        {resumeBlock}
        {changesBlock}
        {!formEditable && formBlock}
        {receiptBlock}

        <section className="grid grid-cols-12 gap-x-6">
          <div className="col-span-12 lg:col-span-8">
            <Accordion title="Company research" meta={company?.name ?? job.companyName}>
              {company?.research ? <ResearchView research={company.research} /> : (
                <p className="text-body-sm text-muted">
                  None yet. <Link href={`/jobs?job=${job.id}`} className="text-ink underline decoration-line-strong underline-offset-4">Run it from the job</Link>.
                </p>
              )}
            </Accordion>
            <Accordion className="border-t-0" title="Run details" meta={`${app.attempts} attempt${app.attempts === 1 ? "" : "s"}`}>
              <dl className="text-body-sm">
                {[
                  ["Status", STATUS_LABEL[app.status]],
                  ["Created", <TimeAgo key="c" iso={app.createdAt} />],
                  ["Job", <Link key="j" href={`/jobs?job=${job.id}`} className="text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">Details</Link>],
                ].map(([k, v], i) => (
                  <div key={String(k)} className={cx("flex justify-between gap-3 py-2", i > 0 && "border-t border-line")}>
                    <dt className="text-muted">{k}</dt>
                    <dd className="text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
            </Accordion>
          </div>
        </section>
      </div>
    </div>
  );
}

function mockScreenshot(company: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500"><rect width="800" height="500" fill="#f3efe8"/><rect x="0" y="0" width="800" height="48" fill="#141311"/><text x="24" y="31" font-family="sans-serif" font-size="18" fill="#faf8f4">${company}</text><rect x="200" y="120" width="400" height="220" fill="#faf8f4" stroke="#d9d3c7"/><rect x="380" y="160" width="40" height="40" fill="#141311"/><path d="M389 181l8 8 15-17" stroke="#faf8f4" stroke-width="4" fill="none"/><text x="400" y="250" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#141311">Application received</text><text x="400" y="280" text-anchor="middle" font-family="sans-serif" font-size="13" fill="#6f6a60">Thank you for applying. We will be in touch.</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
