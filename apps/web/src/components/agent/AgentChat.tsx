"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import { api } from "@/lib/api";
import { cx, Icon, inputClass } from "../ui";

type Msg = { id: number; from: "you" | "agent"; text: string };

/** The same commands work here, on Telegram, WhatsApp and Slack. */
const SUGGESTIONS = ["status", "What did you do today?", "find senior frontend remote", "What am I missing for the top match?"];

/**
 * Talk to Nori in words. `variant="page"` fills the Chat page; `"panel"` is a compact box for other screens.
 */
export function AgentChat({ variant = "panel" }: { variant?: "page" | "panel"; index?: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, busy]);

  async function send(raw: string) {
    const t = raw.trim();
    if (!t || busy) return;
    setText("");
    setError(null);
    setMsgs((m) => [...m, { id: nextId.current++, from: "you", text: t }]);
    setBusy(true);
    try {
      const { reply } = await api.agentChat(t);
      setMsgs((m) => [...m, { id: nextId.current++, from: "agent", text: reply }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const page = variant === "page";
  return (
    <section aria-label="Chat with Nori" className={cx("flex flex-col rounded-card border border-line bg-surface", page && "min-h-[60dvh] lg:min-h-[calc(100dvh-14rem)]")}>
      <div ref={scroller} className={cx("flex flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-4", page ? "max-h-[calc(100dvh-18rem)]" : "max-h-[340px] min-h-[140px]")} aria-live="polite">
        {msgs.length === 0 && !busy && (
          <div className="flex flex-col gap-3">
            <p className="text-body-sm text-ink-2">Ask what Nori did, tell it what to find, or approve and skip in words. The same commands work on your phone channels.</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => send(s)} className="min-h-9 rounded-full border border-line bg-surface px-3.5 text-left text-[13px] text-ink-2 hover:border-control hover:text-ink">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m) => (
          <div
            key={m.id}
            className={cx(
              "max-w-[85%] whitespace-pre-wrap rounded-card px-3.5 py-2.5 text-body-sm",
              m.from === "you" ? "self-end rounded-br-[4px] bg-ink text-on-ink" : "self-start rounded-bl-[4px] bg-sunken text-ink",
            )}
          >
            <span className="sr-only">{m.from === "you" ? "You: " : "Nori: "}</span>
            {m.text}
          </div>
        ))}
        {busy && <div className="self-start rounded-card rounded-bl-[4px] bg-sunken px-3.5 py-2.5 text-body-sm text-muted">Nori is thinking<span className="dots" /></div>}
        {error && <p className="text-meta text-danger-fg" role="alert">{error}</p>}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void send(text); }} className="flex items-center gap-2 border-t border-line p-3">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Message Nori</span>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask or tell Nori" className={inputClass} />
        </label>
        <button
          type="submit"
          disabled={busy || !text.trim()}
          aria-label="Send"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-ink text-on-ink hover:bg-ink-2 disabled:pointer-events-none disabled:opacity-40"
        >
          <Icon icon={ArrowUp} />
        </button>
      </form>
    </section>
  );
}
