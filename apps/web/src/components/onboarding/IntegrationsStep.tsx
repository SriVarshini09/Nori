"use client";

import { useState } from "react";
import { ArrowLeft, CalendarDays, Check, Hash, Mail, RefreshCw, Send, Sheet, type LucideIcon } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Integration, ModelSettings } from "@/lib/types";
import { Button, Frame, Icon, IndexLabel, Notice, Pill, idx } from "../ui";
import { ModelPanel } from "../ModelPanel";

const CARDS: { toolkit: string; name: string; icon: LucideIcon; what: string }[] = [
  { toolkit: "gmail", name: "Gmail", icon: Mail, what: "Verification codes and recruiter replies" },
  { toolkit: "googlesheets", name: "Google Sheets", icon: Sheet, what: "A live tracker spreadsheet" },
  { toolkit: "slack", name: "Slack", icon: Hash, what: "Review requests where you work" },
  { toolkit: "googlecalendar", name: "Google Calendar", icon: CalendarDays, what: "Interview invites on your calendar" },
];

/** Opens a blank tab synchronously (so popup blockers allow it), then points it at the Composio redirect. */
async function openConnect(toolkit: string) {
  const tab = window.open("about:blank", "_blank");
  try {
    const { redirectUrl } = await api.connectIntegration(toolkit);
    if (tab) {
      tab.opener = null;
      tab.location.href = redirectUrl;
    } else {
      window.open(redirectUrl, "_blank", "noopener,noreferrer");
    }
  } catch (e) {
    tab?.close();
    throw e;
  }
}

export function IntegrationsStep({ initial, model, busy, onBack, onFinish }: {
  initial: Integration[];
  model: ModelSettings | null;
  busy?: boolean;
  onBack?: () => void;
  onFinish: () => void;
}) {
  const [items, setItems] = useState(initial);
  const [opening, setOpening] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connected = (t: string) => items.find((i) => i.toolkit === t)?.connected ?? false;

  async function connect(toolkit: string) {
    setOpening(toolkit);
    setError(null);
    try {
      await openConnect(toolkit);
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : (e as Error).message);
    } finally {
      setOpening(null);
    }
  }

  async function recheck() {
    setChecking(true);
    try { setItems(await api.listIntegrations()); } catch (e) { setError((e as Error).message); } finally { setChecking(false); }
  }

  return (
    <div>
      <div className="mb-4"><IndexLabel index="01" marker tone="ink">Model</IndexLabel></div>
      <ModelPanel initial={model} compact />
      <div className="mb-4 mt-12"><IndexLabel index="02" marker tone="ink">Tools</IndexLabel></div>
      <ul className="grid gap-4 sm:grid-cols-2">
        {CARDS.map((c) => {
          const on = connected(c.toolkit);
          return (
            <li key={c.toolkit}>
              <Frame className="flex h-full flex-col p-5">
                <div className="flex items-start justify-between gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-canvas"><Icon icon={c.icon} /></span>
                  {on && <Pill mark="none"><Icon icon={Check} />Connected</Pill>}
                </div>
                <div className="mt-4 text-body-sm font-medium text-ink">{c.name}</div>
                <div className="mt-0.5 text-meta text-muted">{c.what}</div>
                <div className="mt-auto pt-5">
                  <Button variant={on ? "secondary" : "primary"} onClick={() => connect(c.toolkit)} disabled={opening === c.toolkit}>
                    {opening === c.toolkit ? "Opening..." : on ? "Reconnect" : "Connect"}
                  </Button>
                </div>
              </Frame>
            </li>
          );
        })}
      </ul>

      <Frame surface="none" className="mt-4 p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-canvas"><Icon icon={Send} /></span>
          <div className="text-body-sm font-medium text-ink">Telegram</div>
        </div>
        <ol className="mt-4 grid gap-2 text-meta text-ink-2 sm:grid-cols-3 sm:gap-6">
          {["Open your Nori bot in Telegram.", "Send /start.", "Reply to review requests from the chat."].map((s, i) => (
            <li key={s} className="flex gap-2"><span className="text-label font-medium text-faint tnum">{idx(i + 1)}</span>{s}</li>
          ))}
        </ol>
      </Frame>

      {error && <div className="mt-5"><Notice tone="red">{error}</Notice></div>}

      <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-line pt-5">
        {onBack && <Button variant="secondary" icon={ArrowLeft} onClick={onBack} disabled={busy}>Back</Button>}
        <Button variant="ghost" icon={RefreshCw} onClick={recheck} disabled={checking}>{checking ? "Checking..." : "Refresh status"}</Button>
        <div className="flex-1" />
        <Button variant="secondary" onClick={onFinish} disabled={busy}>Skip for now</Button>
        <Button variant="primary" arrow={!busy} onClick={onFinish} disabled={busy}>{busy ? "Finishing..." : "Finish"}</Button>
      </div>
    </div>
  );
}
