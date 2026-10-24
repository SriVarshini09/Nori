"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, Check, Hash, Mail, RefreshCw, Send, Sheet, type LucideIcon } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Integration, ModelPresetsInfo, ModelSettings } from "@/lib/types";
import { Icon, Notice, cx } from "../ui";
import { ModelPanel } from "../ModelPanel";
import { ObButton, Soft } from "./controls";

const CARDS: { toolkit: string; name: string; icon: LucideIcon; what: string }[] = [
  { toolkit: "gmail", name: "Gmail", icon: Mail, what: "Verification codes and recruiter replies" },
  { toolkit: "googlesheets", name: "Google Sheets", icon: Sheet, what: "A live tracker spreadsheet" },
  { toolkit: "slack", name: "Slack", icon: Hash, what: "Review requests where you work" },
  { toolkit: "googlecalendar", name: "Google Calendar", icon: CalendarDays, what: "Interview invites on your calendar" },
];

/** Opens a blank tab synchronously (so popup blockers allow it), then points it at the connection page. */
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

function Heading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-3 flex items-baseline gap-2">
      <h2 className="text-title font-semibold text-ink">{title}</h2>
      {hint && <span className="text-meta text-muted">{hint}</span>}
    </div>
  );
}

export function IntegrationsStep({ initial, model, presets, busy, onBack, onFinish }: {
  initial: Integration[];
  model: ModelSettings | null;
  presets: ModelPresetsInfo;
  busy?: boolean;
  onBack?: () => void;
  onFinish: () => void;
}) {
  const [items, setItems] = useState(initial);
  const [opening, setOpening] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connected = (t: string) => items.find((i) => i.toolkit === t)?.connected ?? false;
  const unavailable = (t: string) => items.find((i) => i.toolkit === t)?.available === false;

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
      <Heading title="Model" />
      <ModelPanel initial={model} presets={presets} compact />
      <div className="mt-8"><Heading title="Apps" hint="Optional" /></div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {CARDS.map((c) => {
          const on = connected(c.toolkit);
          return (
            <li key={c.toolkit}>
              <Soft className="flex h-full flex-col">
                <div className="flex items-start justify-between gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-control bg-sunken text-ink"><Icon icon={c.icon} size={19} /></span>
                  {on && <span className="inline-flex h-6 items-center gap-1 rounded-full bg-accent-tint px-2.5 text-[12px] font-semibold text-accent-fg"><Icon icon={Check} size={13} />Connected</span>}
                </div>
                <div className="mt-3 text-[15px] font-semibold text-ink">{c.name}</div>
                <div className="mt-0.5 text-meta text-muted">{c.what}</div>
                <div className="mt-auto pt-4">
                  <ObButton variant={on ? "soft" : "primary"} className="h-9" onClick={() => connect(c.toolkit)} disabled={opening === c.toolkit || unavailable(c.toolkit)} title={unavailable(c.toolkit) ? "Connections are not switched on for this Nori yet" : undefined}>
                    {opening === c.toolkit ? <span>Opening<span className="dots" /></span> : unavailable(c.toolkit) ? "Not available yet" : on ? "Reconnect" : "Connect"}
                  </ObButton>
                </div>
              </Soft>
            </li>
          );
        })}
      </ul>

      <Soft tint className="mt-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-control bg-surface text-ink"><Icon icon={Send} size={18} /></span>
          <div className="text-[15px] font-semibold text-ink">Telegram</div>
        </div>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-meta text-ink-2">
          <li>Open your Nori bot in Telegram.</li>
          <li>Send /start.</li>
          <li>Approve, skip and answer from the chat.</li>
        </ol>
      </Soft>

      {error && <div className="mt-4"><Notice tone="red">{error}</Notice></div>}

      <div className={cx("mt-8 flex flex-wrap items-center gap-3 border-t border-line pt-5")}>
        {onBack && <ObButton variant="soft" onClick={onBack} disabled={busy}><Icon icon={ArrowLeft} />Back</ObButton>}
        <ObButton variant="ghost" onClick={recheck} disabled={checking}><Icon icon={RefreshCw} className={checking ? "animate-spin" : ""} />{checking ? "Checking" : "Refresh status"}</ObButton>
        <div className="flex-1" />
        <ObButton variant="soft" onClick={onFinish} disabled={busy}>Skip for now</ObButton>
        <ObButton onClick={onFinish} disabled={busy}>
          {busy ? <span>Finishing<span className="dots" /></span> : <>Finish set-up<Icon icon={ArrowRight} className="transition-transform duration-150 group-hover:translate-x-0.5" /></>}
        </ObButton>
      </div>
    </div>
  );
}
