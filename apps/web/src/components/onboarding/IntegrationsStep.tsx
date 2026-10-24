"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, Check, Hash, LoaderCircle, Mail, RefreshCw, Send, Sheet, Sparkles, type LucideIcon } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Integration } from "@/lib/types";
import { Icon, Notice, cx } from "../ui";
import { ObButton, Soft } from "./controls";

const CARDS: { toolkit: string; name: string; icon: LucideIcon; what: string; grad: string }[] = [
  { toolkit: "gmail", name: "Gmail", icon: Mail, what: "Verification codes and recruiter replies", grad: "from-rose-400 to-orange-500" },
  { toolkit: "googlesheets", name: "Google Sheets", icon: Sheet, what: "A live tracker spreadsheet", grad: "from-emerald-400 to-teal-500" },
  { toolkit: "slack", name: "Slack", icon: Hash, what: "Review requests where you work", grad: "from-violet-400 to-indigo-500" },
  { toolkit: "googlecalendar", name: "Google Calendar", icon: CalendarDays, what: "Interview invites on your calendar", grad: "from-sky-400 to-blue-500" },
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

function Heading({ n, title, hint }: { n: string; title: string; hint?: string }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-teal-500 text-[12px] font-bold text-white shadow-sm">{n}</span>
      <h3 className="font-display text-[17px] font-medium tracking-[-0.02em] text-ink">{title}</h3>
      {hint && <span className="text-meta text-muted">{hint}</span>}
    </div>
  );
}

export function IntegrationsStep({ initial, busy, onBack, onFinish }: {
  initial: Integration[];
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
      <Heading n="A" title="Tools" hint="Optional" />
      <ul className="grid gap-4 sm:grid-cols-2">
        {CARDS.map((c, i) => {
          const on = connected(c.toolkit);
          return (
            <li key={c.toolkit} className="ob-pop" style={{ ["--i" as string]: i }}>
              <Soft className={cx("group flex h-full flex-col transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_20px_40px_-24px_rgba(20,19,17,0.35)]", on && "border-emerald-500/40 bg-gradient-to-br from-emerald-50/70 to-white")}>
                <div className="flex items-start justify-between gap-3">
                  <span className={cx("flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-md transition-transform duration-200 group-hover:rotate-[-6deg] group-hover:scale-105", c.grad)}>
                    <Icon icon={c.icon} size={20} />
                  </span>
                  {on && <span className="inline-flex h-6 items-center gap-1 rounded-full bg-emerald-100 px-2.5 text-[12px] font-semibold text-emerald-800"><Icon icon={Check} size={13} />Connected</span>}
                </div>
                <div className="mt-4 text-[15px] font-medium text-ink">{c.name}</div>
                <div className="mt-0.5 text-meta text-muted">{c.what}</div>
                <div className="mt-auto pt-5">
                  <ObButton variant={on ? "soft" : "primary"} className="h-10 px-5 text-[13px]" onClick={() => connect(c.toolkit)} disabled={opening === c.toolkit || unavailable(c.toolkit)} title={unavailable(c.toolkit) ? "Connections are not switched on for this Nori yet" : undefined}>
                    {opening === c.toolkit ? <><Icon icon={LoaderCircle} className="animate-spin" />Opening</> : unavailable(c.toolkit) ? "Not available yet" : on ? "Reconnect" : "Connect"}
                  </ObButton>
                </div>
              </Soft>
            </li>
          );
        })}
      </ul>

      <Soft className="mt-4 bg-stone/40">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-400 to-cyan-500 text-white shadow-md"><Icon icon={Send} size={18} /></span>
          <div className="text-[15px] font-medium text-ink">Telegram</div>
        </div>
        <ol className="mt-4 grid gap-3 text-meta text-ink-2 sm:grid-cols-3 sm:gap-5">
          {["Open your Nori bot in Telegram.", "Send /start.", "Reply to review requests from the chat."].map((s, i) => (
            <li key={s} className="flex items-start gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-[11px] font-semibold text-ink ring-1 ring-black/10">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
      </Soft>

      {error && <div className="mt-5"><Notice tone="red">{error}</Notice></div>}

      <div className="mt-9 flex flex-wrap items-center gap-3 border-t border-black/[0.06] pt-6">
        {onBack && <ObButton variant="soft" onClick={onBack} disabled={busy}><Icon icon={ArrowLeft} />Back</ObButton>}
        <ObButton variant="ghost" onClick={recheck} disabled={checking}><Icon icon={RefreshCw} className={checking ? "animate-spin" : ""} />{checking ? "Checking" : "Refresh status"}</ObButton>
        <div className="flex-1" />
        <ObButton variant="soft" onClick={onFinish} disabled={busy}>Skip for now</ObButton>
        <ObButton onClick={onFinish} disabled={busy}>
          {busy ? <><Icon icon={LoaderCircle} className="animate-spin" />Finishing</> : <><Icon icon={Sparkles} />Finish setup<Icon icon={ArrowRight} className="transition-transform duration-150 group-hover:translate-x-0.5" /></>}
        </ObButton>
      </div>
    </div>
  );
}

