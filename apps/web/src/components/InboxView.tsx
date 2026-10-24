"use client";

import { ArrowRight, Check, Copy, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { INBOX_LABEL } from "@/lib/format";
import type { InboxKind, InboxMessage } from "@/lib/types";
import { TimeAgo } from "./TimeAgo";
import { Button, EmptyState, Frame, Icon, Notice, cx, inputClass } from "./ui";

const NEEDS_REPLY: InboxKind[] = ["interview", "offer", "recruiter_reply"];

const KIND_STYLE: Record<InboxKind, string> = {
  interview: "bg-accent-tint text-accent-fg",
  offer: "bg-accent text-on-ink",
  recruiter_reply: "bg-accent-tint text-accent-fg",
  verification_code: "bg-sunken text-ink",
  confirmation: "bg-sunken text-ink-2",
  rejection: "bg-sunken text-muted",
  other: "bg-sunken text-muted",
};

function KindPill({ kind }: { kind: InboxKind }) {
  return <span className={cx("inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11px] font-semibold", KIND_STYLE[kind])}>{INBOX_LABEL[kind]}</span>;
}

/**
 * Mail Nori read for you: the newest verification code on top, then messages that need a reply, then the ones
 * kept for the record. Drafts are suggestions you copy; nothing is sent from here.
 */
export function InboxView({ initial, appTitles }: { initial: InboxMessage[]; appTitles: Record<string, string> }) {
  const router = useRouter();
  const [messages, setMessages] = useState(initial);
  const [selectedId, setSelectedId] = useState<string | null>(initial.find((m) => NEEDS_REPLY.includes(m.kind))?.id ?? initial[0]?.id ?? null);
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(initial.map((m) => [m.id, m.draftReply ?? ""])));
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState<{ tone: "green" | "red"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const selected = messages.find((m) => m.id === selectedId) ?? null;
  const code = messages.find((m) => m.kind === "verification_code" && m.code);
  const groups: [string, InboxMessage[]][] = [
    ["Needs a reply", messages.filter((m) => NEEDS_REPLY.includes(m.kind))],
    ["For the record", messages.filter((m) => !NEEDS_REPLY.includes(m.kind))],
  ];

  function select(id: string) {
    setSelectedId(id);
    setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, read: true } : m)));
  }

  async function sync() {
    setSyncing(true);
    setNote(null);
    try {
      const { imported } = await api.syncInbox();
      setNote({ tone: "green", text: imported > 0 ? `Imported ${imported} new message${imported === 1 ? "" : "s"}.` : "No new mail." });
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-meta text-muted tnum">{messages.length} messages · {messages.filter((m) => !m.read).length} unread</p>
        <Button variant="secondary" icon={RefreshCw} onClick={sync} disabled={syncing}>{syncing ? "Checking mail..." : "Check mail now"}</Button>
      </div>
      {note && <Notice tone={note.tone}>{note.text}</Notice>}

      {code && (
        <Frame className="flex flex-wrap items-center gap-x-5 gap-y-2 p-4">
          <KindPill kind="verification_code" />
          <span className="font-mono text-[24px] font-semibold tracking-[0.2em] text-ink tnum">{code.code}</span>
          <span className="min-w-0 basis-full text-meta text-muted [overflow-wrap:anywhere] sm:basis-0 sm:flex-1">
            {code.fromAddress} · <TimeAgo iso={code.receivedAt} />
            {code.applicationId && appTitles[code.applicationId] ? <> · for {appTitles[code.applicationId]}</> : null}
          </span>
        </Frame>
      )}

      {messages.length === 0 ? (
        <EmptyState title="No mail yet">Connect Gmail in Settings so codes, replies and interview invites arrive here and move your applications along.</EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="flex min-w-0 flex-col gap-4">
            {groups.filter(([, list]) => list.length > 0).map(([label, list]) => (
              <section key={label} aria-label={label}>
                <h2 className="mb-2 text-meta font-medium text-muted">{label}</h2>
                <ul className="divide-y divide-line rounded-card border border-line bg-surface">
                  {list.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => select(m.id)}
                        aria-current={m.id === selectedId ? "true" : undefined}
                        className={cx("flex w-full flex-col gap-1 px-4 py-3 text-left", m.id === selectedId ? "bg-sunken" : "hover:bg-sunken/50")}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-2">
                            {!m.read && <span className="h-2 w-2 rounded-full bg-accent" aria-label="Unread" />}
                            <KindPill kind={m.kind} />
                          </span>
                          <TimeAgo iso={m.receivedAt} className="text-[12px] text-muted" />
                        </span>
                        <span className={cx("truncate text-body-sm", m.read ? "text-ink-2" : "font-semibold text-ink")}>{m.subject}</span>
                        <span className="truncate text-meta text-muted">{m.fromAddress}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          {selected && (
            <Frame as="article" className="self-start">
              <header className="border-b border-line p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <KindPill kind={selected.kind} />
                  <TimeAgo iso={selected.receivedAt} className="text-meta text-muted" />
                </div>
                <h2 className="mt-3 text-display-md font-semibold text-ink">{selected.subject}</h2>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-muted">
                  <span>From <span className="text-ink-2">{selected.fromAddress}</span></span>
                  {selected.applicationId && (
                    <Link href={`/applications/${selected.applicationId}`} className="inline-flex items-center gap-1 font-medium text-accent underline-offset-4 hover:underline">
                      {appTitles[selected.applicationId] ?? "Open the application"} <Icon icon={ArrowRight} size={13} />
                    </Link>
                  )}
                </div>
              </header>
              <div className="flex flex-col gap-5 p-4 sm:p-5">
                {selected.code && (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-control bg-sunken px-4 py-3">
                    <span className="text-meta font-medium text-muted">Verification code</span>
                    <span className="font-mono text-[24px] font-semibold tracking-[0.2em] text-ink tnum">{selected.code}</span>
                  </div>
                )}
                <div className="max-w-prose whitespace-pre-wrap text-body text-ink-2">{selected.bodyText}</div>
                {selected.kind !== "verification_code" && selected.kind !== "confirmation" && (
                  <div className="border-t border-line pt-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <label htmlFor="draft" className="text-body-sm font-semibold text-ink">Nori&apos;s draft reply</label>
                      <Button size="sm" icon={copied ? Check : Copy} onClick={copyDraft} disabled={!(drafts[selected.id] ?? "").trim()}>{copied ? "Copied" : "Copy draft"}</Button>
                    </div>
                    <textarea
                      id="draft"
                      className={inputClass}
                      rows={6}
                      placeholder="No draft was written for this message."
                      value={drafts[selected.id] ?? ""}
                      onChange={(e) => setDrafts((d) => ({ ...d, [selected.id]: e.target.value }))}
                    />
                    <p className="mt-2 text-[12px] text-muted">A suggestion only. Nothing is sent from here: copy it into your mail.</p>
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
