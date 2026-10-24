"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, ArrowUpRight, Play } from "lucide-react";
import { api } from "@/lib/api";
import type { AgentActivity, AgentAwaitingReview, AgentStatus } from "@/lib/types";
import { DryRunBand } from "../DryRunBand";
import { NoriMark } from "../Logo";
import { cx, Icon, inputClass } from "../ui";
import { ago, headline, inMin, KIND_ICON, KIND_LABEL } from "./kinds";

type Resolution = "approved" | "skipped";
type Msg = { id: number; from: "you" | "agent"; text: string };

function statusLine(s: AgentStatus, running: boolean, now: number): string {
  const enabled = s.lanes ? s.lanes.some((l) => l.enabled) : true;
  const capped = s.dailyCap > 0 && s.usedToday >= s.dailyCap;
  const state = running ? "Running a cycle" : enabled && s.dailyCap > 0 && !capped ? "Idle" : capped ? "Cap reached" : "Paused";
  const parts = [state];
  if (!running && s.nextTickAt && state === "Idle") parts.push(`next cycle in ${inMin(s.nextTickAt, now)}`);
  return parts.join(" · ");
}

/**
 * The 360 by 560 tray popover: status, what waits on you, a chat box. A resume can be approved right here; a filled
 * form may hold answers Nori wrote, so it always opens the full review in the browser.
 */
export function CompanionView({ initialStatus, initialActivity, initialError }: { initialStatus: AgentStatus | null; initialActivity: AgentActivity[]; initialError: string | null }) {
  const [status, setStatus] = useState(initialStatus);
  const [activity, setActivity] = useState(initialActivity);
  const [error, setError] = useState(initialError);
  const [resolved, setResolved] = useState<Record<string, Resolution>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const nextId = useRef(1);
  const scroller = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const [s, a] = await Promise.allSettled([api.agentStatus(), api.agentActivity(3)]);
    if (s.status === "fulfilled") { setStatus(s.value); setError(null); }
    if (a.status === "fulfilled") setActivity(a.value);
    setNow(Date.now());
  }, []);

  // The popover stays alive in the tray: refresh on a timer and whenever it is shown again.
  useEffect(() => {
    const t = setInterval(() => void refresh(), 30_000);
    const onShow = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", onShow);
    document.addEventListener("visibilitychange", onShow);
    return () => { clearInterval(t); window.removeEventListener("focus", onShow); document.removeEventListener("visibilitychange", onShow); };
  }, [refresh]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, sending]);

  async function run() {
    setRunning(true);
    try { await api.agentTick(); await refresh(); } catch (e) { setError((e as Error).message); } finally { setRunning(false); }
  }

  /** One waiting step of one application: after its resume is approved, the same application comes back with its form. */
  const stepKey = (a: AgentAwaitingReview) => `${a.applicationId}:${a.status ?? "resume_review"}`;

  async function resolve(a: AgentAwaitingReview, r: Resolution) {
    const id = a.applicationId;
    setBusyId(id);
    try {
      if (r === "skipped") await api.skipApplication(id);
      else await api.approveResume(id);
      setResolved((m) => ({ ...m, [stepKey(a)]: r }));
      void refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function send(raw: string) {
    const t = raw.trim();
    if (!t || sending) return;
    setText("");
    setMsgs((m) => [...m.slice(-3), { id: nextId.current++, from: "you", text: t }]);
    setSending(true);
    try {
      const { reply } = await api.agentChat(t);
      setMsgs((m) => [...m.slice(-3), { id: nextId.current++, from: "agent", text: reply }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  /** Opens a page of the full app in the person's browser (the companion window stays small). */
  function openPage(path: string) {
    return (e: React.MouseEvent) => {
      e.preventDefault();
      window.open(`${window.location.origin}${path}`, "_blank");
    };
  }

  const waiting = (status?.awaitingReview ?? []).filter((a) => !resolved[stepKey(a)]);
  const small = "inline-flex h-8 items-center rounded-control px-3 text-[12px] font-semibold disabled:pointer-events-none disabled:opacity-40";

  return (
    <div className="mx-auto flex h-dvh w-full max-w-[360px] flex-col overflow-hidden bg-bg">
      {status && status.liveSubmit === false && <DryRunBand compact />}
      <header className="flex shrink-0 items-center gap-2.5 border-b border-line px-3 py-2.5">
        <NoriMark size={24} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-ink" role="status" suppressHydrationWarning>{status ? statusLine(status, running, now) : "Status unavailable"}</p>
          {status && <p className="text-[12px] text-muted tnum">{status.usedToday} of {status.dailyCap} today</p>}
        </div>
        <button type="button" onClick={run} disabled={running} aria-label="Run a cycle now" title="Run a cycle now" className="inline-flex h-8 w-8 items-center justify-center rounded-control border border-control text-ink hover:bg-sunken disabled:opacity-40">
          <Icon icon={Play} size={14} />
        </button>
        <a href="/dashboard" onClick={openPage("/dashboard")} className="inline-flex h-8 items-center gap-1 rounded-control px-2 text-[12px] font-semibold text-accent hover:bg-accent-tint">
          Open <Icon icon={ArrowUpRight} size={13} />
        </a>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {error && <p className="mb-2 text-[12px] text-danger-fg" role="alert">{error}</p>}

        <h2 className="flex items-center gap-2 text-[13px] font-semibold text-ink">
          Waiting on you
          {waiting.length > 0 && <span className="rounded-full bg-attn-tint px-1.5 text-[11px] font-semibold leading-5 text-attn-fg ring-1 ring-inset ring-attn tnum">{waiting.length}</span>}
        </h2>
        {waiting.length === 0 ? (
          <p className="mt-1.5 text-[12.5px] text-muted">Nothing waiting. Nothing was sent without you.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {waiting.map((a) => {
              const form = a.status === "form_review";
              return (
                <li key={stepKey(a)} className="rounded-card border-2 border-attn bg-surface p-2.5">
                  <p className="truncate text-[13px] font-semibold text-ink">{a.title}</p>
                  <p className="truncate text-[12px] text-muted tnum">
                    {a.companyName} · {form ? "form filled, read it before it goes" : `resume ready, ${a.changes} change${a.changes === 1 ? "" : "s"}`}{a.atsScore != null && <> · ATS {a.atsScore}</>}
                  </p>
                  <div className="mt-2 flex items-center gap-1.5">
                    <button type="button" disabled={busyId === a.applicationId} onClick={() => resolve(a, "skipped")} className={cx(small, "border border-control text-ink hover:bg-sunken")}>Skip</button>
                    <div className="flex-1" />
                    {form ? (
                      <a href={`/applications/${a.applicationId}`} onClick={openPage(`/applications/${a.applicationId}`)} className={cx(small, "bg-ink text-on-ink hover:bg-ink-2")}>Read and approve</a>
                    ) : (
                      <>
                        <a href={`/applications/${a.applicationId}`} onClick={openPage(`/applications/${a.applicationId}`)} className={cx(small, "text-accent hover:bg-accent-tint")}>Review</a>
                        <button type="button" disabled={busyId === a.applicationId} onClick={() => resolve(a, "approved")} className={cx(small, "bg-ink text-on-ink hover:bg-ink-2")}>Approve</button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <h2 className="mt-4 text-[13px] font-semibold text-ink">Recent</h2>
        {activity.length === 0 ? (
          <p className="mt-1.5 text-[12.5px] text-muted">No activity yet.</p>
        ) : (
          <ul className="mt-1 divide-y divide-line">
            {activity.slice(0, 3).map((a) => (
              <li key={a.id} className="flex items-center gap-2.5 py-2">
                <span title={KIND_LABEL[a.kind]} className="text-muted"><Icon icon={KIND_ICON[a.kind]} size={14} /></span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{headline(a)}</span>
                <time dateTime={a.ts} className="shrink-0 text-[11.5px] text-muted tnum" suppressHydrationWarning>{ago(a.ts, now).replace(" ago", "")}</time>
              </li>
            ))}
          </ul>
        )}
      </div>

      <section className="shrink-0 border-t border-line" aria-label="Chat with Nori">
        {(msgs.length > 0 || sending) && (
          <div ref={scroller} className="flex max-h-[104px] flex-col gap-1.5 overflow-y-auto px-3 pt-3" aria-live="polite">
            {msgs.map((m) => (
              <div key={m.id} className={cx("max-w-[90%] rounded-control px-2.5 py-1.5 text-[12.5px] leading-[1.4]", m.from === "you" ? "self-end bg-ink text-on-ink" : "self-start bg-sunken text-ink")}>
                {m.text}
              </div>
            ))}
            {sending && <div className="self-start rounded-control bg-sunken px-2.5 py-1.5 text-[12.5px] text-muted">Thinking<span className="dots" /></div>}
          </div>
        )}
        <form onSubmit={(e) => { e.preventDefault(); void send(text); }} className="flex items-center gap-2 p-3">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Message Nori</span>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Tell Nori" className={cx(inputClass, "min-h-9 py-1.5 text-[13px]")} />
          </label>
          <button type="submit" disabled={sending || !text.trim()} aria-label="Send" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-ink text-on-ink hover:bg-ink-2 disabled:pointer-events-none disabled:opacity-40">
            <Icon icon={ArrowUp} />
          </button>
        </form>
      </section>
    </div>
  );
}
