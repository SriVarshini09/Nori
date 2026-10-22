"use client";

import { AutopilotRow } from "./AutopilotRow";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Play } from "lucide-react";
import { api } from "@/lib/api";
import type { AgentActivity, AgentStatus, AgentTickSummary, Lane, ModelMode } from "@/lib/types";
import { pct } from "@/lib/format";
import { Button, cx, Frame, Icon, IndexLabel, Notice, Square, Tag } from "../ui";
import { AgentChat } from "./AgentChat";
import { CapFrame, LanesFrame } from "./Lanes";
import { ago, headline, inMin, KIND_ICON, KIND_LABEL } from "./kinds";

type Resolution = "approved" | "skipped";

const MODE_TAG: Record<ModelMode, string> = {
  cline: "Open models via Cline",
  ollama: "Local Ollama",
  "openai-compatible": "Your endpoint",
  anthropic: "Anthropic",
  heuristic: "Heuristics only",
};

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-meta text-ink">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cx("relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f9a72]", checked ? "border-[#0f9a72] bg-[#0f9a72]" : "border-line-strong bg-transparent")}
      >
        <span className={cx("absolute top-[3px] h-4 w-4 rounded-full shadow-sm transition-[left,background-color] duration-150 ease-[var(--ease)]", checked ? "left-[23px] bg-white" : "left-[3px] bg-faint")} />
      </button>
    </div>
  );
}

function summarize(s: AgentTickSummary): string {
  const parts: string[] = [];
  if (s.discovered) parts.push(`found ${s.discovered}`);
  if (s.queued) parts.push(`queued ${s.queued}`);
  if (s.skipped.length) parts.push(`skipped ${s.skipped.length}`);
  if (s.submitted) parts.push(`submitted ${s.submitted}`);
  if (s.awaitingReview) parts.push(`${s.awaitingReview} waiting on you`);
  if (s.needsUser) parts.push(`${s.needsUser} need${s.needsUser === 1 ? "s" : ""} an answer`);
  if (parts.length === 0) return s.note ?? "Nothing new this run.";
  const text = parts.join(", ");
  // When nothing was queued, say why instead of leaving the user to guess.
  return text.charAt(0).toUpperCase() + text.slice(1) + "." + (!s.queued && s.note ? ` ${s.note}` : "");
}

function StatusStrip({ status, now, onStatus, onTick }: { status: AgentStatus; now: number; onStatus: (s: AgentStatus) => void; onTick: () => void }) {
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const s = await api.agentTick();
      setSummary(summarize(s));
      onTick();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  async function toggle(key: "autoApprove" | "reviewBeforeSubmit", value: boolean) {
    const prev = status;
    onStatus({ ...status, [key]: value });
    try {
      await api.updateProfile(key === "autoApprove" ? { resumeAutoApprove: value } : { reviewBeforeSubmit: value });
    } catch (e) {
      onStatus(prev);
      setError((e as Error).message);
    }
  }

  return (
    <Frame as="section">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-line px-4 py-3 sm:px-5">
        <p className="text-body-sm text-ink tnum" suppressHydrationWarning>
          Last run {ago(status.lastTickAt, now)}
          <span className="mx-2 text-line-strong">&middot;</span>
          <span className="text-muted">next in {inMin(status.nextTickAt, now)}</span>
        </p>
        <div className="flex items-center gap-3">
          {status.mode && <Tag mark={status.mode === "heuristic" ? "hollow" : "ink"}>{MODE_TAG[status.mode]}</Tag>}
          <Button variant="primary" icon={Play} onClick={run} disabled={running}>{running ? "Running..." : "Run now"}</Button>
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-3 [&>*]:p-4 sm:[&>*]:p-5">
        <div className="min-w-0">
          <IndexLabel>Min score</IndexLabel>
          <div className="mt-2 font-display text-[1.5rem] font-medium leading-none tracking-[-0.03em] text-ink tnum">
            {pct(status.minScore)}<span className="text-body-sm text-muted">%</span>
          </div>
        </div>
        <div className="col-span-2 min-w-0 space-y-3 border-t border-line lg:col-span-1 lg:border-l lg:border-t-0">
          <Switch label="Auto-approve" checked={status.autoApprove} onChange={(v) => toggle("autoApprove", v)} />
          <Switch label="Review before submit" checked={status.reviewBeforeSubmit} onChange={(v) => toggle("reviewBeforeSubmit", v)} />
        </div>
        <div className="col-span-2 min-w-0 border-t border-line lg:col-span-1 lg:border-l lg:border-t-0">
          <IndexLabel>Channels</IndexLabel>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {status.channels.length === 0
              ? <span className="text-meta text-muted">None linked</span>
              : status.channels.map((c) => <Tag key={`${c.kind}-${c.address}`} kind={c.kind}>{c.address.split(" ")[0]}</Tag>)}
          </div>
        </div>
      </div>
      <AutopilotRow status={status} onStatus={onStatus} onError={setError} />
      {(summary || error) && (
        <p className={cx("border-t border-line px-4 py-3 text-body-sm sm:px-5", error ? "text-accent-ink" : "text-ink")} role="status">{error ?? summary}</p>
      )}
    </Frame>
  );
}

function WaitingFrame({ status, resolved, onResolve, busyId }: {
  status: AgentStatus; resolved: Record<string, Resolution>; onResolve: (id: string, r: Resolution) => void; busyId: string | null;
}) {
  const items = status.awaitingReview.filter((a) => !resolved[a.applicationId]);
  return (
    <Frame as="section">
      <header className="flex h-12 items-center justify-between border-b border-line px-4 sm:px-5">
        <IndexLabel index="02" marker={items.length > 0 ? "accent" : "hollow"} tone="ink">Waiting on you</IndexLabel>
        <span className="text-meta text-muted tnum">{items.length}</span>
      </header>
      {items.length === 0 ? (
        <p className="px-4 py-6 text-body-sm text-muted sm:px-5">Nothing waiting.</p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((a) => (
            <li key={a.applicationId} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
              <Link href={`/applications/${a.applicationId}`} className="group min-w-0">
                <span className="line-clamp-2 text-body-sm font-medium text-ink decoration-line-strong underline-offset-4 group-hover:underline">{a.title}</span>
                <span className="block text-meta text-muted tnum">
                  {a.companyName}{a.atsScore != null && <> &middot; ATS {a.atsScore}</>} &middot; {a.changes} changes
                </span>
              </Link>
              <Button variant="secondary" className="h-8 px-3" disabled={busyId === a.applicationId} onClick={() => onResolve(a.applicationId, "approved")}>Approve</Button>
            </li>
          ))}
        </ul>
      )}
    </Frame>
  );
}

function Timeline({ items, resolved, onResolve, busyId, now }: {
  items: AgentActivity[]; resolved: Record<string, Resolution>; onResolve: (id: string, r: Resolution) => void; busyId: string | null; now: number;
}) {
  return (
    <Frame as="section">
      <header className="flex h-12 items-center justify-between border-b border-line px-4 sm:px-5">
        <IndexLabel index="04" marker tone="ink">Activity</IndexLabel>
        <span className="text-meta text-muted tnum">{items.length}</span>
      </header>
      {items.length === 0 ? (
        <p className="px-4 py-10 text-center text-body-sm text-muted sm:px-5">No activity yet.</p>
      ) : (
        <ol className="relative px-4 py-2 sm:px-5">
          <span aria-hidden="true" className="absolute bottom-6 top-6 left-[calc(1rem+20px+12px+15px)] w-px bg-line sm:left-[calc(1.25rem+20px+12px+15px)]" />
          {items.map((a, i) => {
            const res = a.applicationId ? resolved[a.applicationId] : undefined;
            const waiting = (a.kind === "review_requested" && !!a.applicationId && !res) || a.kind === "needs_user";
            return (
              <li key={a.id} className="relative flex gap-3 py-3">
                <span className="w-5 shrink-0 pt-[8px] text-label font-medium text-faint tnum">{String(i + 1).padStart(2, "0")}</span>
                <span className="relative z-10 flex h-[30px] w-[30px] shrink-0 items-center justify-center border border-line bg-paper text-ink" title={KIND_LABEL[a.kind]}>
                  <Icon icon={KIND_ICON[a.kind]} />
                  {waiting && <Square tone="accent" size={6} className="absolute -right-[3px] -top-[3px]" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className="pt-[5px] text-body-sm text-ink">{headline(a)}</p>
                    <time dateTime={a.ts} title={new Date(a.ts).toLocaleString()} className="shrink-0 whitespace-nowrap pt-[7px] text-[12px] text-muted tnum" suppressHydrationWarning>
                      {ago(a.ts, now)}
                    </time>
                  </div>
                  {a.kind === "submitted" && a.data.dryRun && <div className="mt-2"><Tag mark="hollow">Dry run, nothing was sent</Tag></div>}
                  {a.kind === "skipped" && a.data.reasons && a.data.reasons.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">{a.data.reasons.map((r) => <Tag key={r}>{r}</Tag>)}</div>
                  )}
                  {a.kind === "review_requested" && a.applicationId && (
                    <div className="mt-2 flex items-center gap-2">
                      {res ? (
                        <span className="text-meta text-muted">{res === "approved" ? "Approved" : "Skipped"}</span>
                      ) : (
                        <>
                          <Button variant="primary" className="h-8 px-3" disabled={busyId === a.applicationId} onClick={() => onResolve(a.applicationId!, "approved")}>Approve</Button>
                          <Button variant="secondary" className="h-8 px-3" disabled={busyId === a.applicationId} onClick={() => onResolve(a.applicationId!, "skipped")}>Skip</Button>
                        </>
                      )}
                    </div>
                  )}
                  {a.kind === "needs_user" && a.applicationId && (
                    <Link href={`/applications/${a.applicationId}`} className="group mt-1.5 inline-flex items-center gap-1.5 text-meta font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
                      Open application<Icon icon={ArrowRight} className="transition-transform duration-150 group-hover:translate-x-0.5" />
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Frame>
  );
}

export function AgentView({ initialStatus, initialActivity, initialLanes }: { initialStatus: AgentStatus; initialActivity: AgentActivity[]; initialLanes: Lane[] }) {
  const [status, setStatus] = useState(initialStatus);
  const [lanes, setLanes] = useState(initialLanes);
  const [activity, setActivity] = useState(initialActivity);
  const [resolved, setResolved] = useState<Record<string, Resolution>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const refresh = useCallback(async () => {
    const [s, a] = await Promise.allSettled([api.agentStatus(), api.agentActivity(50)]);
    if (s.status === "fulfilled") setStatus(s.value);
    if (a.status === "fulfilled") setActivity(a.value);
    setNow(Date.now());
  }, []);

  async function resolve(id: string, r: Resolution) {
    setBusyId(id);
    setError(null);
    try {
      if (r === "approved") await api.approveResume(id);
      else await api.skipApplication(id);
      setResolved((m) => ({ ...m, [id]: r }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-12">
      {status.dailyCap === 0 && (
        <div className="lg:col-span-12">
          <Notice tone="amber" label="Auto apply is off">The daily cap is 0, so the agent will not start any application on its own. Raise the cap below.</Notice>
        </div>
      )}
      {status.liveSubmit === false && (
        <div className="lg:col-span-12">
          <Notice tone="amber" label="Dry run">Forms are filled and stopped at the last step, nothing is sent to employers. Start the server with ALLOW_REAL_SUBMIT=true to apply for real.</Notice>
        </div>
      )}
      <div className="lg:col-span-12"><StatusStrip status={status} now={now} onStatus={setStatus} onTick={refresh} /></div>
      <div className="lg:col-span-12"><CapFrame status={status} onStatus={setStatus} /></div>
      <div className="lg:col-span-12"><LanesFrame lanes={lanes} status={status} onLanes={setLanes} /></div>
      {error && <p className="text-meta text-accent-ink lg:col-span-12" role="alert">{error}</p>}
      <aside className="flex flex-col gap-4 sm:gap-6 lg:order-2 lg:col-span-4">
        <WaitingFrame status={status} resolved={resolved} onResolve={resolve} busyId={busyId} />
        <AgentChat index="03" />
      </aside>
      <div className="lg:order-1 lg:col-span-8">
        <Timeline items={activity} resolved={resolved} onResolve={resolve} busyId={busyId} now={now} />
      </div>
    </div>
  );
}
