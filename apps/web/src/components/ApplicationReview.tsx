"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowUpRight, Check, ExternalLink, Pencil, RotateCcw, SkipForward } from "lucide-react";
import { api, artifactUrl, USE_MOCK } from "@/lib/api";
import { pct, STATUS_LABEL } from "@/lib/format";
import {
  APPLICATION_STATUSES,
  type Application, type ApplicationDetail, type ApplicationStatus, type Company, type Job, type Resume, type ResumeContent, type RunEvent, type RunEventRow,
} from "@/lib/types";
import { EventLog } from "./EventLog";
import { ResearchView } from "./ResearchPanel";
import { RecruiterView } from "./RecruiterView";
import { ResumePreview } from "./ResumePreview";
import { PIPELINE, Stepper } from "./Stepper";
import { StatusPill } from "./StatusPill";
import { TimeAgo } from "./TimeAgo";
import { ChangeCard, type NodeInfo } from "./review/ChangeCard";
import { Accordion, Button, Card, Frame, Icon, LinkButton, Notice, cx, inputClass } from "./ui";

const TERMINAL: ApplicationStatus[] = ["submitted", "failed", "skipped", "viewed", "replied", "interview", "offer", "rejected"];
const RUNNING: ApplicationStatus[] = ["queued", "tailoring", "filling", "submitting"];
const POST: ApplicationStatus[] = ["submitted", "viewed", "replied", "interview", "offer", "rejected"];
const evKey = (e: { step: string; message: string }) => `${e.step}|${e.message}`;

/** Put the "before" text back for every reverted line. Bullets are found by id in experience and projects. */
function withReverts(content: ResumeContent, resume: Resume, reverted: Set<string>): ResumeContent {
  const before = new Map(resume.changes.filter((c) => reverted.has(c.bulletId)).map((c) => [c.bulletId, c.before]));
  const fix = <T extends { id: string; text: string }>(b: T): T => (before.has(b.id) ? { ...b, text: before.get(b.id)!, edited: true } : b);
  return {
    ...content,
    experience: content.experience.map((e) => ({ ...e, bullets: e.bullets.map(fix) })),
    projects: content.projects?.map((p) => ({ ...p, bullets: p.bullets.map(fix) })),
  };
}

const RUNNING_COPY: Partial<Record<ApplicationStatus, { title: string; line: string }>> = {
  queued: { title: "Queued", line: "Nori will start this one in its next step. Nothing is needed from you yet." },
  tailoring: { title: "Tailoring your resume", line: "Reading the posting and choosing lines from your graph. On a local model this can take a few minutes." },
  filling: { title: "Filling the form", line: "Opening the application and answering from your profile. Nothing is sent: it stops for your review." },
  submitting: { title: "Sending", line: "Clicking submit and waiting for the employer's confirmation page." },
};

export function ApplicationReview({ initial, nodes, liveSubmit }: { initial: ApplicationDetail; nodes: Record<string, NodeInfo>; liveSubmit: boolean }) {
  const [app, setApp] = useState<Application>(initial.application);
  const [resume, setResume] = useState<Resume | null>(initial.resume);
  const [recruiter, setRecruiter] = useState(initial.recruiter ?? null);
  const [events, setEvents] = useState<RunEventRow[]>(initial.events);
  const job: Job = initial.job;
  const company: Company | null = initial.company;
  const [transport, setTransport] = useState<"live" | "polling">("live");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reverted, setReverted] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(initial.resume?.changes[0]?.bulletId ?? null);

  const [answers, setAnswers] = useState<Record<string, string>>(initial.application.answers);
  const [pending, setPending] = useState<Record<string, string>>({});

  const seen = useRef(new Set(initial.events.map(evKey)));
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pushEvent = useCallback((ev: RunEventRow) => {
    const k = evKey(ev);
    if (seen.current.has(k)) return;
    seen.current.add(k);
    setEvents((prev) => [...prev, ev].sort((a, b) => +new Date(a.ts) - +new Date(b.ts)));
  }, []);

  /** Re-read the application from the API (no-op in demo mode, where state is local). */
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

  // Live stream: server-sent events with a polling fallback. In demo mode, play a scripted run.
  const live = !TERMINAL.includes(app.status);
  const mode = !live ? "idle" : USE_MOCK ? "simulated" : transport;
  // Demo mode: replay the scripted steps from wherever the application now stands (it stops at each gate).
  const demoStatus = USE_MOCK && live ? app.status : null;
  useEffect(() => {
    if (!demoStatus) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    import("@/lib/mock").then((m) => {
      if (cancelled) return;
      m.eventScript(demoStatus).forEach((ev, i) => {
        timers.push(setTimeout(() => onRunEvent({ applicationId: app.id, ...ev }), 1800 * (i + 1)));
      });
    });
    return () => { cancelled = true; timers.forEach(clearTimeout); };
  }, [demoStatus, app.id, onRunEvent]);

  useEffect(() => {
    if (!live || USE_MOCK) return;
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
        try { onRunEvent(JSON.parse(m.data as string) as RunEvent); } catch { /* keep-alives */ }
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
    act("resume", async () => {
      // Reverted lines go back to the server first, so the approved resume is exactly what is on screen.
      if (resume && reverted.size > 0 && !USE_MOCK) await api.editApplicationResume(app.id, { content: withReverts(resume.content, resume, reverted) });
      await api.approveResume(app.id);
    }, { status: "filling", resumeApprovedAt: now() });
  const skip = () => act("skip", () => api.skipApplication(app.id), { status: "skipped" });
  const retry = () => act("retry", () => api.retryApplication(app.id), { status: "queued", error: null });

  const requiredMissing = app.pendingQuestions.filter((q) => q.required && !pending[q.label]?.trim());
  const approveForm = () =>
    act("form", async () => {
      const filled = Object.fromEntries(Object.entries(pending).filter(([, v]) => v.trim()));
      if (Object.keys(filled).length > 0) await api.answerQuestions(app.id, filled);
      await api.approveForm(app.id, { ...answers, ...filled });
    }, { status: "submitting", formApprovedAt: now(), pendingQuestions: [], answers: { ...answers, ...pending } });

  const autopilotEvent = [...events].reverse().find((e) => e.step === "autopilot");
  const autopilotNote = autopilotEvent ? { sent: app.autopilot === true, text: autopilotEvent.message.replace(/^Autopilot /, "").replace(/^./, (c) => c.toUpperCase()) } : null;
  const lastStep = [...events].reverse().map((e) => e.step).find((s) => (PIPELINE as string[]).includes(s));
  const canSkip = !["skipped", ...POST].includes(app.status);
  const canRetry = ["failed", "needs_user", "skipped"].includes(app.status);
  const kept = resume ? resume.changes.length - reverted.size : 0;
  const gaps = useMemo(() => (recruiter?.musts ?? []).filter((m) => m.status === "missing" && m.required), [recruiter]);

  // ---- stage panels -------------------------------------------------------------------------------------------

  const resumePanel = resume && (
    <section aria-labelledby="stage-h" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="stage-h" className="text-title font-semibold text-ink">
          {resume.changes.length > 0 ? `${resume.changes.length} change${resume.changes.length === 1 ? "" : "s"}, each from your graph` : "Your resume for this job"}
        </h2>
        <p className="flex flex-wrap items-center gap-x-2 text-meta text-muted tnum">
          {resume.edited && <span className="rounded-full bg-sunken px-2 py-0.5 text-[12px] font-medium text-ink">Edited by you</span>}
          {resume.templateId && <span>{resume.templateId.charAt(0).toUpperCase() + resume.templateId.slice(1)} template ·</span>}
          <span>ATS {resume.atsScore ?? "?"} · {resume.pages ?? "?"} page{resume.pages === 1 ? "" : "s"}</span>
          {resume.keywordCoverage != null && <span>· keywords {Math.round(resume.keywordCoverage * 100)}%</span>}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="flex flex-col gap-3">
          {resume.changes.length > 0 ? (
            <ul className="flex flex-col gap-2.5">
              {resume.changes.map((c) => (
                <ChangeCard
                  key={c.bulletId}
                  change={c}
                  nodes={nodes}
                  kept={!reverted.has(c.bulletId)}
                  disabled={app.status !== "resume_review" || busy !== null}
                  selected={selected === c.bulletId}
                  onSelect={() => setSelected(c.bulletId)}
                  onKeep={(k) => setReverted((s) => { const n = new Set(s); if (k) n.delete(c.bulletId); else n.add(c.bulletId); return n; })}
                />
              ))}
            </ul>
          ) : (
            <p className="rounded-card bg-sunken px-4 py-3 text-body-sm text-ink-2">Nothing needed changing: your base resume already fits this posting.</p>
          )}
          {gaps.length > 0 && (
            <div className="rounded-card bg-sunken px-4 py-3">
              <p className="text-body-sm font-semibold text-ink">Not claimed</p>
              <p className="mt-0.5 text-meta text-ink-2">
                The posting asks for {gaps.map((g) => g.skill).join(", ")}. Nothing in your graph shows it, so it is left out.{" "}
                <Link href="/graph" className="font-medium text-accent underline-offset-4 hover:underline">Add a fact</Link>
              </p>
            </div>
          )}
          {USE_MOCK && reverted.size > 0 && <p className="text-meta text-muted">Demo mode keeps reverts on this screen only.</p>}
        </div>
        <Frame className="overflow-hidden p-1.5">
          <ResumePreview resume={resume} className="h-[520px] rounded-[8px] xl:h-[640px]" />
        </Frame>
      </div>
      {resume.atsChecks.length > 0 && (
        <Accordion title="Applicant system checks" meta={`${resume.atsChecks.filter((c) => c.pass).length} of ${resume.atsChecks.length} pass`}>
          <ul className="flex flex-col gap-1.5">
            {resume.atsChecks.map((c) => (
              <li key={c.id} className="flex items-start gap-2 text-meta">
                <span className={cx("mt-1 h-2 w-2 shrink-0 rounded-full", c.pass ? "bg-accent" : "bg-danger")} aria-hidden="true" />
                <span className={c.pass ? "text-ink-2" : "text-ink"}>{c.label}{c.detail ? <span className="text-muted"> · {c.detail}</span> : null}</span>
                <span className="sr-only">{c.pass ? "passes" : "fails"}</span>
              </li>
            ))}
          </ul>
        </Accordion>
      )}
    </section>
  );

  const longAnswers = Object.entries(answers).filter(([, v]) => v.length > 70);
  const shortAnswers = Object.entries(answers).filter(([, v]) => v.length <= 70);
  const formEditable = app.status === "form_review" || app.status === "needs_user";

  const answerField = ([label, value]: [string, string], i: number, long: boolean) => (
    <div key={label} className={cx("grid gap-1.5", long ? "" : "sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:items-center sm:gap-4")}>
      <label htmlFor={`ans-${long ? "l" : "s"}-${i}`} className="text-meta text-ink-2">{label}</label>
      {long ? (
        <textarea id={`ans-l-${i}`} className={inputClass} rows={4} value={value} disabled={!formEditable} onChange={(e) => setAnswers((a) => ({ ...a, [label]: e.target.value }))} />
      ) : (
        <input id={`ans-s-${i}`} className={inputClass} value={value} disabled={!formEditable} onChange={(e) => setAnswers((a) => ({ ...a, [label]: e.target.value }))} />
      )}
    </div>
  );

  const formPanel = (
    <section aria-labelledby="stage-h" className="flex flex-col gap-4">
      {app.pendingQuestions.length > 0 && (
        <Frame tone="attn" className="p-4 sm:p-5">
          <h2 id="stage-h" className="text-title font-semibold text-ink">
            {app.pendingQuestions.length === 1 ? "One question for you" : `${app.pendingQuestions.length} questions for you`}
          </h2>
          <dl className="mt-3 grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-meta">
            <dt className="text-muted">Why</dt>
            <dd className="text-ink-2">Required on the form, and your profile has no answer. Nori never guesses legal or personal answers.</dd>
            <dt className="text-muted">Job</dt>
            <dd className="text-ink-2">{job.title}, {job.companyName}</dd>
            <dt className="text-muted">If ignored</dt>
            <dd className="text-ink-2">Nothing is sent. The application waits here until you answer or skip it.</dd>
          </dl>
          <div className="mt-4 flex flex-col gap-4">
            {app.pendingQuestions.map((q, i) => (
              <label key={q.label} className="block" htmlFor={`q-${i}`}>
                <span className="mb-1.5 block text-body-sm font-semibold text-ink">
                  {q.label}{q.required && <span className="ml-1 text-attn-fg" aria-label="required">*</span>}
                </span>
                {q.options?.length ? (
                  <select id={`q-${i}`} className={inputClass} value={pending[q.label] ?? ""} onChange={(e) => setPending((p) => ({ ...p, [q.label]: e.target.value }))}>
                    <option value="">Choose an answer</option>
                    {q.options.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : q.type === "textarea" ? (
                  <textarea id={`q-${i}`} className={inputClass} rows={3} value={pending[q.label] ?? ""} onChange={(e) => setPending((p) => ({ ...p, [q.label]: e.target.value }))} />
                ) : (
                  <input id={`q-${i}`} className={inputClass} value={pending[q.label] ?? ""} onChange={(e) => setPending((p) => ({ ...p, [q.label]: e.target.value }))} />
                )}
              </label>
            ))}
          </div>
        </Frame>
      )}

      {app.pendingQuestions.length === 0 && (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="stage-h" className="text-title font-semibold text-ink">
            {app.status === "awaiting_code" ? "Waiting for a verification code" : `${Object.keys(answers).length} fields filled`}
          </h2>
          {app.receipt?.submittedVia && <p className="text-meta text-muted">on {app.receipt.submittedVia}</p>}
        </div>
      )}

      {app.status === "awaiting_code" && (
        <Notice tone="amber">
          The site sent a code to your email. If your inbox is connected Nori reads it by itself; otherwise check <Link href="/inbox" className="font-semibold underline underline-offset-4">your inbox</Link>.
        </Notice>
      )}

      {longAnswers.length > 0 && (
        <Frame className="p-4 sm:p-5">
          <p className="text-body-sm font-semibold text-ink">Read these first</p>
          <p className="mt-0.5 text-meta text-muted">Longer written answers. Each one should only say what your graph and profile support.</p>
          <div className="mt-3 flex flex-col gap-4">{longAnswers.map((a, i) => answerField(a, i, true))}</div>
        </Frame>
      )}

      {shortAnswers.length > 0 && (
        <Accordion title={`${shortAnswers.length} short field${shortAnswers.length === 1 ? "" : "s"}`} meta="from your profile" defaultOpen={shortAnswers.length <= 8}>
          <div className="flex flex-col gap-3">{shortAnswers.map((a, i) => answerField(a, i, false))}</div>
        </Accordion>
      )}

      {app.receipt?.screenshotPath && (
        <figure>
          <Frame className="overflow-hidden p-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={USE_MOCK ? mockScreenshot(job.companyName) : artifactUrl(app.receipt.screenshotPath)} alt="Screenshot of the filled form" className="block w-full rounded-[8px]" />
          </Frame>
          <figcaption className="mt-1.5 text-meta text-muted">What the form looked like when Nori stopped.</figcaption>
        </figure>
      )}
    </section>
  );

  const runningCopy = RUNNING_COPY[app.status];
  const runningPanel = runningCopy && (
    <section aria-labelledby="stage-h" className="rounded-card bg-sunken p-5">
      <h2 id="stage-h" className="text-title font-semibold text-ink">{runningCopy.title}<span className="dots" /></h2>
      <p className="mt-1 max-w-prose text-body-sm text-ink-2">{runningCopy.line}</p>
      <p className="mt-2 text-meta text-muted">You can leave this page. The run log on the right keeps a record, and Today will show it when it needs you.</p>
    </section>
  );

  const receipt = app.receipt;
  const receiptPanel = POST.includes(app.status) && (
    <section aria-labelledby="stage-h" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="stage-h" className="text-title font-semibold text-ink">{receipt?.dryRun ? "Filled, not sent (dry run)" : "Sent"}</h2>
        {receipt && <p className="text-meta text-muted">{app.submittedAt ? <>on <TimeAgo iso={app.submittedAt} /> </> : null}via {receipt.submittedVia}</p>}
      </div>
      {receipt?.screenshotPath && (
        <figure>
          <Frame className="overflow-hidden p-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={USE_MOCK ? mockScreenshot(job.companyName) : artifactUrl(receipt.screenshotPath)} alt="Confirmation page screenshot" className="block w-full rounded-[8px]" />
          </Frame>
          {receipt.confirmationText && <figcaption className="mt-1.5 text-meta text-ink-2">&ldquo;{receipt.confirmationText}&rdquo;</figcaption>}
        </figure>
      )}
      {receipt && (
        <Accordion title="What was in the form" meta={receipt.fields.length}>
          <dl className="divide-y divide-line text-body-sm">
            {receipt.fields.map((f) => (
              <div key={f.label} className="grid gap-x-4 gap-y-0.5 py-2 sm:grid-cols-[12rem_1fr]">
                <dt className="text-meta text-muted">{f.label}</dt>
                <dd className="break-words text-ink">{f.value}</dd>
              </div>
            ))}
          </dl>
        </Accordion>
      )}
      {!receipt && <p className="text-body-sm text-muted">No receipt was recorded for this application.</p>}
    </section>
  );

  const stoppedPanel = (app.status === "failed" || app.status === "skipped") && (
    <section aria-labelledby="stage-h" className={cx("rounded-card p-5", app.status === "failed" ? "bg-danger-tint" : "bg-sunken")}>
      <h2 id="stage-h" className={cx("text-title font-semibold", app.status === "failed" ? "text-danger-fg" : "text-ink")}>
        {app.status === "failed" ? "This run stopped" : "Skipped"}
      </h2>
      <p className={cx("mt-1 max-w-prose text-body-sm", app.status === "failed" ? "text-danger-fg" : "text-ink-2")}>
        {app.error ?? (app.status === "skipped" ? "Nothing was sent. You can start it again any time." : "Nothing was sent.")}
      </p>
      <Button variant="secondary" icon={RotateCcw} className="mt-3" onClick={retry} disabled={busy !== null}>Try again</Button>
    </section>
  );

  const showResume = app.status === "resume_review" || (resume && !formEditable && !RUNNING.includes(app.status) && !POST.includes(app.status) && app.status !== "awaiting_code" && app.status !== "failed" && app.status !== "skipped");
  const stage: ReactNode =
    app.status === "resume_review" ? (resumePanel ?? runningPanel)
    : formEditable || app.status === "awaiting_code" ? formPanel
    : RUNNING.includes(app.status) ? runningPanel
    : POST.includes(app.status) ? receiptPanel
    : stoppedPanel || (showResume ? resumePanel : null);

  // ---- the one primary action for the current gate
  const footer =
    app.status === "resume_review" ? (
      <ActionBar
        next="Next, Nori fills the form, then asks you again."
        primary={<Button variant="primary" icon={Check} onClick={approveResume} disabled={busy !== null || !resume}>
          {busy === "resume" ? "Approving..." : resume && resume.changes.length > 0 ? `Approve resume · ${kept} kept${reverted.size ? `, ${reverted.size} reverted` : ""}` : "Approve resume"}
        </Button>}
        extra={!USE_MOCK && <LinkButton href={`/applications/${app.id}/resume`} variant="ghost" icon={Pencil}>Edit resume</LinkButton>}
        onSkip={skip} busy={busy !== null}
      />
    ) : formEditable ? (
      <ActionBar
        next={liveSubmit ? "Approving sends this application to the employer." : "Dry run: approving records your OK. Nothing is sent."}
        primary={<Button variant="primary" icon={Check} onClick={approveForm} disabled={busy !== null || requiredMissing.length > 0}>
          {busy === "form" ? "Working..." : app.pendingQuestions.length > 0 ? (liveSubmit ? "Answer and send" : "Answer and continue") : liveSubmit ? "Approve and send" : "Approve form"}
        </Button>}
        onSkip={skip} busy={busy !== null}
        warn={requiredMissing.length > 0 ? `Answer ${requiredMissing.length} required question${requiredMissing.length === 1 ? "" : "s"} first.` : undefined}
      />
    ) : null;

  return (
    <div className="flex flex-col gap-5">
      {/* header */}
      <header className="flex flex-col gap-3">
        <Link href="/applications" className="inline-flex w-fit items-center gap-1.5 text-meta text-muted hover:text-ink">
          <Icon icon={ArrowLeft} size={14} /> Applications
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h1 className="text-balance text-[1.5rem] font-semibold leading-tight tracking-[-0.015em] text-ink sm:text-display-lg">{job.title}</h1>
            <p className="mt-1 text-body text-ink-2">
              {job.companyName}{job.location && <span className="text-muted"> · {job.location}</span>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={app.status} />
            {canRetry && app.status !== "failed" && app.status !== "skipped" && <Button variant="secondary" size="sm" icon={RotateCcw} onClick={retry} disabled={busy !== null}>Start again</Button>}
            {canSkip && !footer && <Button variant="ghost" size="sm" icon={SkipForward} onClick={skip} disabled={busy !== null}>Skip</Button>}
            <a href={job.applyUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-control px-2 text-[13px] font-medium text-accent hover:bg-accent-tint">
              Posting <Icon icon={ExternalLink} size={14} />
            </a>
          </div>
        </div>
      </header>

      <Frame className="px-4 py-4 sm:px-5">
        <Stepper status={app.status} lastStep={lastStep} />
      </Frame>

      {(error || autopilotNote || (app.error && app.status !== "failed" && app.status !== "skipped")) && (
        <div className="flex flex-col gap-2.5">
          {error && <Notice tone="red">{error}</Notice>}
          {autopilotNote && <Notice tone={autopilotNote.sent ? "green" : "slate"} label="Autopilot">{autopilotNote.text}</Notice>}
          {app.error && app.status !== "failed" && app.status !== "skipped" && <Notice tone="red" label="Last run">{app.error}</Notice>}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-5">
          {stage}
          {footer}
          {app.status !== "resume_review" && resume && !showResume && (
            <Accordion title="The resume that was used" meta={`${app.resumeApprovedAt ? "Approved · " : ""}ATS ${resume.atsScore ?? "?"}`}>
              <div className="flex flex-col gap-3">
                <Frame className="overflow-hidden p-1.5"><ResumePreview resume={resume} className="h-[520px] rounded-[8px]" /></Frame>
                {!USE_MOCK && <a href={api.resumePdfUrl(resume.id)} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1 text-meta font-medium text-accent underline-offset-4 hover:underline">Open PDF <Icon icon={ArrowUpRight} size={14} /></a>}
              </div>
            </Accordion>
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <Card title="Job">
            <dl className="flex flex-col gap-1.5 text-meta">
              <div className="flex justify-between gap-3"><dt className="text-muted">Company</dt><dd className="text-right text-ink">{job.companyName}</dd></div>
              {job.location && <div className="flex justify-between gap-3"><dt className="text-muted">Location</dt><dd className="text-right text-ink">{job.location}{job.remote ? ", remote OK" : ""}</dd></div>}
              {recruiter && <div className="flex justify-between gap-3"><dt className="text-muted">Recruiter read</dt><dd className="text-right text-ink tnum">{recruiter.score} of 100</dd></div>}
              {resume?.keywordCoverage != null && <div className="flex justify-between gap-3"><dt className="text-muted">Keywords covered</dt><dd className="text-ink tnum">{pct(resume.keywordCoverage)}%</dd></div>}
              <div className="flex justify-between gap-3"><dt className="text-muted">Started</dt><dd className="text-ink"><TimeAgo iso={app.createdAt} /></dd></div>
            </dl>
            <Link href={`/jobs?job=${job.id}`} className="mt-3 inline-flex items-center gap-1 text-meta font-medium text-accent underline-offset-4 hover:underline">Posting, requirements, research</Link>
          </Card>
          {recruiter && <RecruiterView review={recruiter} />}
          <Card><EventLog events={events} mode={mode} /></Card>
          <Accordion title="Company research" meta={company?.name ?? job.companyName}>
            {company?.research ? <ResearchView research={company.research} /> : (
              <p className="text-body-sm text-muted">
                None yet. <Link href={`/jobs?job=${job.id}`} className="font-medium text-accent underline-offset-4 hover:underline">Run it from the job</Link>.
              </p>
            )}
          </Accordion>
          <p className="px-1 text-[12px] text-muted">{app.attempts} attempt{app.attempts === 1 ? "" : "s"} · {STATUS_LABEL[app.status]} <TimeAgo iso={app.updatedAt} /></p>
        </aside>
      </div>
    </div>
  );
}

/**
 * The bottom of a gate: the consequence in one sentence, skip, and the primary action. Sticks to the bottom on
 * phones so the decision is always within thumb reach.
 */
function ActionBar({ next, primary, extra, onSkip, busy, warn }: { next: string; primary: ReactNode; extra?: ReactNode; onSkip: () => void; busy: boolean; warn?: string }) {
  return (
    <div className="sticky bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-30 -mx-4 border-t border-line bg-bg/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:rounded-card sm:border sm:bg-surface sm:px-4 lg:bottom-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="min-w-0 flex-1 text-meta text-muted">{warn ? <span className="text-attn-fg">{warn}</span> : next}</p>
        <div className="flex flex-wrap items-center gap-2">
          {extra}
          <Button variant="secondary" icon={SkipForward} onClick={onSkip} disabled={busy}>Skip job</Button>
          {primary}
        </div>
      </div>
    </div>
  );
}

function mockScreenshot(company: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500"><rect width="800" height="500" fill="#f3f1ed"/><rect x="0" y="0" width="800" height="48" fill="#2b2722"/><text x="24" y="31" font-family="sans-serif" font-size="18" fill="#fffefc">${company}</text><rect x="200" y="120" width="400" height="220" rx="12" fill="#fffefc" stroke="#e9e5df"/><circle cx="400" cy="180" r="22" fill="#2f5a8a"/><path d="M389 181l8 8 15-17" stroke="#fffefc" stroke-width="4" fill="none"/><text x="400" y="250" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#2b2722">Application received</text><text x="400" y="280" text-anchor="middle" font-family="sans-serif" font-size="13" fill="#6b645b">Thank you for applying. We will be in touch.</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
