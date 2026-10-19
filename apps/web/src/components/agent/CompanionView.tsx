"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, ArrowUpRight, Play } from "lucide-react";
import { api } from "@/lib/api";
import type { AgentActivity, AgentStatus } from "@/lib/types";
import { cx, Frame, Icon, IndexLabel, inputClass, Square } from "../ui";
import { ago, headline, inMin, KIND_ICON, KIND_LABEL } from "./kinds";

type Resolution = "approved" | "skipped";
type Msg = { id: number; from: "you" | "agent"; text: string };

function statusLine(s: AgentStatus, running: boolean, now: number): { tone: "ink" | "hollow"; text: string } {
  const enabled = s.lanes ? s.lanes.some((l) => l.enabled) : true;
  const capped = s.dailyCap > 0 && s.usedToday >= s.dailyCap;
  const state = running || (enabled && s.dailyCap > 0 && !capped) ? "Working" : capped ? "Cap reached" : "Paused";
  const parts = [state, `${s.usedToday} of ${s.dailyCap} today`];
  if (s.nextTickAt) parts.push(`next run in ${inMin(s.nextTickAt, now)}`);
  return { tone: state === "Working" ? "ink" : "hollow", text: parts.join(" · ") };
}

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

  async function resolve(id: string, r: Resolution) {
    setBusyId(id);
    try {
      if (r === "approved") await api.approveResume(id); else await api.skipApplication(id);
      setResolved((m) => ({ ...m, [id]: r }));
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

  function openDashboard(e: React.MouseEvent) {
    e.preventDefault();
    window.open(`${window.location.origin}/agent`, "_blank");
  }

  const waiting = (status?.awaitingReview ?? []).filter((a) => !resolved[a.applicationId]);
  const line = status ? statusLine(status, running, now) : null;
  const small = "inline-flex h-7 items-center rounded-full px-3 text-[12px] font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40";

  return (
    <div className="mx-auto flex h-dvh w-full max-w-[360px] flex-col overflow-hidden bg-canvas">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-line px-3">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="relative block h-[10px] w-[10px] bg-ink"><span className="absolute bottom-0 right-0 h-[3px] w-[3px] bg-accent" /></span>
          <span className="font-display text-[15px] font-semibold tracking-[-0.04em] text-ink">Nori</span>
        </span>
        <span className="flex items-center gap-1.5">
          <a href="/agent" onClick={openDashboard} className="group inline-flex h-7 items-center gap-1 px-1.5 text-[12px] font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
            Open dashboard<Icon icon={ArrowUpRight} size={14} className="transition-transform duration-150 group-hover:translate-x-px" />
          </a>
          <button
            type="button"
            onClick={run}
            disabled={running}
            aria-label="Run now"
            title="Run now"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-ink text-paper transition-colors duration-150 hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
          >
            <Icon icon={Play} size={14} />
          </button>
        </span>
      </header>

      <p className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3 text-meta text-ink tnum" role="status" suppressHydrationWarning>
        {line ? (
          <>
            <Square tone={line.tone} size={6} pulse={line.tone === "ink" && running} />
            <span className="truncate">{line.text}</span>
          </>
        ) : (
          <span className="truncate text-muted">Status unavailable</span>
        )}
      </p>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {error && <p className="text-[12px] text-accent-ink" role="alert">{error}</p>}

        <Frame as="section">
          <header className="flex h-9 items-center justify-between border-b border-line px-3">
            <IndexLabel index="01" marker={waiting.length > 0 ? "accent" : "hollow"} tone="ink">Waiting on you</IndexLabel>
            <span className="text-[12px] text-muted tnum">{waiting.length}</span>
          </header>
          {waiting.length === 0 ? (
            <p className="px-3 py-3 text-meta text-muted">Nothing waiting.</p>
          ) : (
            <ul className="divide-y divide-line">
              {waiting.map((a) => (
                <li key={a.applicationId} className="flex items-center justify-between gap-2 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium text-ink">{a.title}</div>
                    <div className="truncate text-[12px] text-muted tnum">{a.companyName}{a.atsScore != null && <> &middot; ATS {a.atsScore}</>}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button type="button" disabled={busyId === a.applicationId} onClick={() => resolve(a.applicationId, "approved")} className={cx(small, "bg-ink text-paper hover:bg-accent")}><span className="text-[12px]">Approve</span></button>
                    <button type="button" disabled={busyId === a.applicationId} onClick={() => resolve(a.applicationId, "skipped")} className={cx(small, "border border-line text-ink hover:border-ink")}><span className="text-[12px]">Skip</span></button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Frame>

        <Frame as="section">
          <header className="flex h-9 items-center border-b border-line px-3">
            <IndexLabel index="02" marker tone="ink">Recent</IndexLabel>
          </header>
          {activity.length === 0 ? (
            <p className="px-3 py-3 text-meta text-muted">No activity yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {activity.slice(0, 3).map((a) => (
                <li key={a.id} className="flex items-center gap-2.5 px-3 py-2">
                  <span title={KIND_LABEL[a.kind]} className="text-ink-2"><Icon icon={KIND_ICON[a.kind]} /></span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{headline(a)}</span>
                  <time dateTime={a.ts} className="shrink-0 text-[11.5px] text-muted tnum" suppressHydrationWarning>{ago(a.ts, now).replace(" ago", "")}</time>
                </li>
              ))}
            </ul>
          )}
        </Frame>
      </div>

      <section className="shrink-0 border-t border-line bg-canvas" aria-label="Ask the agent">
        {(msgs.length > 0 || sending) && (
          <div ref={scroller} className="flex max-h-[104px] flex-col gap-1.5 overflow-y-auto px-3 pt-3">
            {msgs.map((m) => (
              <div
                key={m.id}
                className={cx(
                  "max-w-[90%] px-2.5 py-1.5 text-[13px] leading-[1.4] text-ink",
                  m.from === "you" ? "self-end rounded-[10px] rounded-br-[2px] bg-stone" : "self-start rounded-[10px] rounded-bl-[2px] border border-line",
                )}
              >
                {m.text}
              </div>
            ))}
            {sending && (
              <div className="flex items-center gap-1.5 self-start rounded-[10px] rounded-bl-[2px] border border-line px-2.5 py-2" aria-label="Agent is typing">
                {[0, 1, 2].map((i) => <span key={i} className="h-1 w-1 animate-pulse bg-muted" style={{ animationDelay: `${i * 150}ms` }} />)}
              </div>
            )}
          </div>
        )}
        {msgs.length === 0 && !sending && (
          <div className="px-3 pt-3">
            <button type="button" onClick={() => send("What did you do today?")} className="rounded-full border border-line px-3 py-1 text-[12px] text-ink-2 transition-colors duration-150 hover:border-ink hover:text-ink">
              What did you do today?
            </button>
          </div>
        )}
        <form onSubmit={(e) => { e.preventDefault(); void send(text); }} className="flex items-center gap-2 p-3">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message the agent" aria-label="Message the agent" className={cx(inputClass, "h-8")} />
          <button
            type="submit"
            disabled={sending || !text.trim()}
            aria-label="Send"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink text-paper transition-colors duration-150 hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
          >
            <Icon icon={ArrowUp} />
          </button>
        </form>
      </section>
    </div>
  );
}
