"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import { api } from "@/lib/api";
import { cx, Frame, Icon, IndexLabel, inputClass } from "../ui";

type Msg = { id: number; from: "you" | "agent"; text: string };

const SUGGESTIONS = ["What did you do today?", "Find staff frontend roles, remote", "What am I missing for the top match?"];

export function AgentChat({ index }: { index?: string }) {
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

  return (
    <Frame as="section">
      <header className="flex h-12 items-center border-b border-line px-4 sm:px-5">
        <IndexLabel index={index} marker tone="ink">Ask the agent</IndexLabel>
      </header>
      <div ref={scroller} className="flex max-h-[340px] min-h-[120px] flex-col gap-2.5 overflow-y-auto px-4 py-4 sm:px-5">
        {msgs.length === 0 && !busy && (
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(s)}
                className="rounded-full border border-line px-3 py-1.5 text-left text-[12.5px] text-ink-2 transition-colors duration-150 hover:border-ink hover:text-ink"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {msgs.map((m) => (
          <div
            key={m.id}
            className={cx(
              "max-w-[88%] px-3 py-2 text-body-sm text-ink",
              m.from === "you" ? "self-end rounded-[10px] rounded-br-[2px] bg-stone" : "self-start rounded-[10px] rounded-bl-[2px] border border-line",
            )}
          >
            {m.text}
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-1.5 self-start rounded-[10px] rounded-bl-[2px] border border-line px-3 py-2.5" aria-label="Agent is typing">
            {[0, 1, 2].map((i) => <span key={i} className="h-1 w-1 animate-pulse bg-muted" style={{ animationDelay: `${i * 150}ms` }} />)}
          </div>
        )}
        {error && <p className="text-[12px] text-accent-ink">{error}</p>}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void send(text); }} className="flex items-center gap-2 border-t border-line p-3 sm:px-4">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Message the agent"
          aria-label="Message the agent"
          className={cx(inputClass, "h-9")}
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          aria-label="Send"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-paper transition-colors duration-150 hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
        >
          <Icon icon={ArrowUp} />
        </button>
      </form>
    </Frame>
  );
}
