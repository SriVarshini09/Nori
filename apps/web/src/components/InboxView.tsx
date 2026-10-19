"use client";

import { ArrowRight, Check, Copy, Inbox, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { INBOX_LABEL, INBOX_TONE } from "@/lib/format";
import type { InboxMessage } from "@/lib/types";
import { TimeAgo } from "./TimeAgo";
import { Button, EmptyState, Frame, Icon, IndexLabel, Notice, Pill, Square, TONE_MARK, cx, idx, inputClass } from "./ui";

export function InboxView({ initial, appTitles }: { initial: InboxMessage[]; appTitles: Record<string, string> }) {
  const router = useRouter();
  const [messages, setMessages] = useState(initial);
  const [selectedId, setSelectedId] = useState<string | null>(initial[0]?.id ?? null);
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(initial.map((m) => [m.id, m.draftReply ?? ""])));
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState<{ tone: "green" | "red"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const selected = messages.find((m) => m.id === selectedId) ?? null;

  function select(id: string) {
    setSelectedId(id);
    setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, read: true } : m)));
  }

  async function sync() {
    setSyncing(true);
    setNote(null);
    try {
      const { imported } = await api.syncInbox();
      setNote({ tone: "green", text: `Imported ${imported} new message${imported === 1 ? "" : "s"}.` });
      router.refresh();
    } catch (e) {
      setNote({ tone: "red", text: (e as Error).message });
    } finally {
      setSyncing(false);
    }
  }

  async function copyDraft() {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(drafts[selected.id] ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-line py-3">
        <IndexLabel>{messages.length} messages &middot; {messages.filter((m) => !m.read).length} unread</IndexLabel>
        <Button variant="primary" icon={RefreshCw} onClick={sync} disabled={syncing}>{syncing ? "Syncing..." : "Sync inbox"}</Button>
      </div>
      {note && <Notice tone={note.tone}>{note.text}</Notice>}

      {messages.length === 0 ? (
        <EmptyState icon={Inbox} title="Inbox is empty">Connect Gmail in Settings, then sync.</EmptyState>
      ) : (
        <div className="grid grid-cols-12 gap-6">
          <ol className="col-span-12 max-h-[72vh] overflow-y-auto border-t border-line lg:col-span-5">
            {messages.map((m, i) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => select(m.id)}
                  aria-current={m.id === selectedId ? "true" : undefined}
                  className={cx(
                    "grid w-full grid-cols-[2rem_minmax(0,1fr)] gap-x-3 border-b border-line px-1 py-4 text-left transition-colors duration-150",
                    m.id === selectedId ? "bg-paper" : "hover:bg-stone/50",
                  )}
                >
                  <span className="flex flex-col items-start gap-2 pt-[3px]">
                    <span className="text-label font-medium text-faint tnum">{idx(i + 1)}</span>
                    {!m.read && <Square tone="accent" size={6} />}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center justify-between gap-2">
                      <Pill mark={TONE_MARK[INBOX_TONE[m.kind]]}>{INBOX_LABEL[m.kind]}</Pill>
                      <span className="text-[12px] text-faint"><TimeAgo iso={m.receivedAt} /></span>
                    </span>
                    <span className={cx("mt-2 block truncate text-body-sm", m.read ? "text-ink-2" : "font-medium text-ink")}>{m.subject}</span>
                    <span className="block truncate text-meta text-muted">{m.fromAddress}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>

          {selected && (
            <Frame as="article" className="col-span-12 self-start lg:col-span-7">
              <header className="border-b border-line p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Pill mark={TONE_MARK[INBOX_TONE[selected.kind]]}>{INBOX_LABEL[selected.kind]}</Pill>
                  <span className="text-meta text-muted"><TimeAgo iso={selected.receivedAt} /></span>
                </div>
                <h2 className="mt-4 font-display text-[1.5rem] font-medium leading-[1.12] tracking-[-0.025em] text-ink sm:text-display-md">{selected.subject}</h2>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-muted">
                  <span>From <span className="text-ink-2">{selected.fromAddress}</span></span>
                  {selected.applicationId && (
                    <Link href={`/applications/${selected.applicationId}`} className="text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
                      {appTitles[selected.applicationId] ?? selected.applicationId} <Icon icon={ArrowRight} className="inline" />
                    </Link>
                  )}
                </div>
              </header>
              <div className="space-y-6 p-5 sm:p-6">
                {selected.code && (
                  <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
                    <IndexLabel marker="hollow">Verification code</IndexLabel>
                    <span className="font-mono text-[28px] font-medium tracking-[0.25em] text-ink tnum">{selected.code}</span>
                  </div>
                )}
                <div className="max-w-prose whitespace-pre-wrap text-body text-ink-2">{selected.bodyText}</div>
                {selected.kind !== "verification_code" && selected.kind !== "confirmation" && (
                  <div className="border-t border-line pt-5">
                    <div className="mb-3 flex items-center justify-between">
                      <IndexLabel marker tone="ink">Draft reply</IndexLabel>
                      <Button icon={copied ? Check : Copy} onClick={copyDraft} disabled={!(drafts[selected.id] ?? "").trim()}>{copied ? "Copied" : "Copy"}</Button>
                    </div>
                    <textarea
                      className={inputClass}
                      rows={6}
                      placeholder="No draft was generated for this message."
                      value={drafts[selected.id] ?? ""}
                      onChange={(e) => setDrafts((d) => ({ ...d, [selected.id]: e.target.value }))}
                    />
                    <p className="mt-2 text-[12px] text-faint">Drafts are suggestions. Nothing is sent from here.</p>
                  </div>
                )}
              </div>
            </Frame>
          )}
        </div>
      )}
    </div>
  );
}
