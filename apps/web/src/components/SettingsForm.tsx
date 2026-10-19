"use client";

import { CalendarDays, Check, Hash, Mail, Plug, Sheet, Trash2, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { USE_MOCK, api } from "@/lib/api";
import { pct } from "@/lib/format";
import type { Channel, Integration, Profile } from "@/lib/types";
import { Button, Field, Frame, Icon, IndexLabel, Notice, Pill, Toggle, idx, inputClass } from "./ui";

export function SettingsForm({ profile }: { profile: Profile }) {
  const [autoApprove, setAutoApprove] = useState(profile.resumeAutoApprove);
  const [review, setReview] = useState(profile.reviewBeforeSubmit);
  const [cap, setCap] = useState(profile.autoApplyDailyCap);
  const [minScore, setMinScore] = useState(pct(profile.autoApplyMinScore));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "green" | "red"; text: string } | null>(null);

  async function save() {
    setBusy(true);
    setNote(null);
    try {
      await api.updateProfile({
        resumeAutoApprove: autoApprove,
        reviewBeforeSubmit: review,
        autoApplyDailyCap: cap,
        autoApplyMinScore: minScore / 100,
      });
      setNote({ tone: "green", text: "Settings saved." });
    } catch (e) {
      setNote({ tone: "red", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Frame className="p-5 sm:p-6">
      <div className="-mt-4 divide-y divide-line">
        <Toggle
          label="Auto-approve tailored resumes"
          hint="Skip the resume review. Changes are still recorded."
          checked={autoApprove}
          onChange={setAutoApprove}
        />
        <Toggle
          label="Review before submit"
          hint="Pause on every filled form until you approve it."
          checked={review}
          onChange={setReview}
        />
      </div>
      <div className="grid gap-x-5 gap-y-5 border-t border-line pt-5 sm:grid-cols-2">
        <Field label="Auto-apply daily cap" hint="0 disables auto-apply.">
          <input className={`${inputClass} tnum`} type="number" min={0} max={100} value={cap} onChange={(e) => setCap(Math.max(0, Number(e.target.value) || 0))} />
        </Field>
        <Field label={<>Auto-apply minimum match &middot; <span className="text-ink tnum">{minScore}%</span></>}>
          <input className="mt-3 w-full" type="range" min={0} max={100} step={5} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} />
        </Field>
      </div>
      {!review && cap > 0 && (
        <div className="mt-5"><Notice tone="amber">With review off and a daily cap set, the agent will submit applications without asking. Real submission also requires ALLOW_REAL_SUBMIT=true on the server.</Notice></div>
      )}
      <div className="mt-6 flex flex-wrap items-center gap-4 border-t border-line pt-5">
        <Button variant="primary" icon={Check} onClick={save} disabled={busy}>{busy ? "Saving..." : "Save settings"}</Button>
        {note && <div className="min-w-0 flex-1"><Notice tone={note.tone}>{note.text}</Notice></div>}
      </div>
    </Frame>
  );
}

const TOOLKIT_ICON: Record<string, LucideIcon> = { gmail: Mail, googlesheets: Sheet, googlecalendar: CalendarDays, slack: Hash };
const TOOLKIT_LABEL: Record<string, string> = {
  gmail: "Gmail", googlesheets: "Google Sheets", googlecalendar: "Google Calendar", slack: "Slack",
};

export function Integrations({ initial }: { initial: Integration[] }) {
  const [items] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function connect(toolkit: string) {
    setBusy(toolkit);
    setError(null);
    try {
      const { redirectUrl } = await api.connectIntegration(toolkit);
      window.open(redirectUrl, "_blank", "noopener,noreferrer");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <ol className="border-t border-line">
        {items.map((i, n) => (
          <li key={i.toolkit} className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-line py-4 sm:grid-cols-[2.75rem_minmax(0,1fr)_auto] sm:gap-x-4">
            <span className="text-label font-medium text-faint tnum">{idx(n + 1)}</span>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-body-sm font-medium text-ink"><Icon icon={TOOLKIT_ICON[i.toolkit] ?? Plug} />{TOOLKIT_LABEL[i.toolkit] ?? i.toolkit}</div>
            </div>
            <div className="flex items-center gap-3">
              {i.connected && <Pill mark="ink" className="hidden sm:inline-flex">Connected</Pill>}
              <Button variant={i.connected ? "secondary" : "primary"} icon={Plug} onClick={() => connect(i.toolkit)} disabled={busy === i.toolkit}>
                {busy === i.toolkit ? "Opening..." : i.connected ? "Reconnect" : "Connect"}
              </Button>
            </div>
          </li>
        ))}
        {items.length === 0 && <li className="border-b border-line py-6 text-center text-body-sm text-muted">No integrations available.</li>}
      </ol>
      {(error ?? items.find((i) => i.error)?.error) && <Notice tone="red">{error ?? items.find((i) => i.error)?.error}</Notice>}
    </div>
  );
}

export function Channels({ channels }: { channels: Channel[] }) {
  const has = (k: Channel["kind"]) => channels.some((c) => c.kind === k);
  return (
    <div className="space-y-6 text-body-sm">
      {channels.length > 0 && (
        <ol className="border-t border-line">
          {channels.map((c, n) => (
            <li key={c.id} className="grid grid-cols-[2rem_6rem_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-line py-3 sm:grid-cols-[2.75rem_8rem_minmax(0,1fr)_auto] sm:gap-x-4">
              <span className="text-label font-medium text-faint tnum">{idx(n + 1)}</span>
              <span className="font-medium capitalize text-ink">{c.kind}</span>
              <span className="truncate text-muted">{c.address}</span>
              <Pill mark="ink">Linked</Pill>
            </li>
          ))}
        </ol>
      )}
      <div className="grid gap-4 sm:gap-6 md:grid-cols-2">
        <Frame className="p-5">
          <div className="flex items-center justify-between gap-3">
            <IndexLabel index="A" marker tone="ink">Telegram</IndexLabel>
            {has("telegram") ? <Pill mark="ink">Linked</Pill> : <Pill mark="hollow">Not linked</Pill>}
          </div>
          <ol className="mt-4 space-y-2 text-meta text-ink-2">
            {[
              "Make sure the server has TELEGRAM_BOT_TOKEN set.",
              "Open Telegram and start a chat with your Nori bot.",
              "Send /start. The chat appears here once linked, and you can say things like “apply to #2”.",
            ].map((s, i) => (
              <li key={i} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-1">
                <span className="text-label font-medium text-faint tnum">{idx(i + 1)}</span>{s}
              </li>
            ))}
          </ol>
        </Frame>
        <Frame className="p-5">
          <div className="flex items-center justify-between gap-3">
            <IndexLabel index="B" marker tone="ink">Slack</IndexLabel>
            {has("slack") ? <Pill mark="ink">Linked</Pill> : <Pill mark="hollow">Not linked</Pill>}
          </div>
          <p className="mt-4 text-meta text-ink-2">Connect Slack under Integrations above, then invite the bot to a channel or DM it. Review requests and replies are posted there.</p>
        </Frame>
      </div>
    </div>
  );
}

/** Irreversible: deletes the account and everything keyed on it. The button stays disabled until the email is typed exactly. */
export function DangerZone({ email }: { email: string }) {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mockNote, setMockNote] = useState(false);
  const matches = typed.trim().toLowerCase() === email.toLowerCase();

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api.deleteAccount(typed.trim());
      if (USE_MOCK) { setMockNote(true); setBusy(false); return; }
      router.replace("/signup");
      router.refresh();
    } catch (e) {
      setError((e as { detail?: string }).detail ?? (e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Frame className="p-5 sm:p-6">
      <p className="text-body-sm text-ink-2">
        Deleting your account permanently removes your career graph, resumes, applications, inbox, linked channels and stored model key. This cannot be undone.
      </p>
      <div className="mt-5 max-w-md">
        <Field label="Type your email to confirm" hint={email}>
          <input
            className={inputClass}
            type="email"
            autoComplete="off"
            spellCheck={false}
            value={typed}
            placeholder={email}
            onChange={(e) => setTyped(e.target.value)}
          />
        </Field>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-4 border-t border-line pt-5">
        <Button
          icon={Trash2}
          onClick={remove}
          disabled={!matches || busy}
          className="border-[#a8321f]! text-[#a8321f]! hover:bg-[#a8321f]! hover:text-paper!"
        >
          {busy ? "Deleting..." : "Delete account"}
        </Button>
        {error && <div className="min-w-0 flex-1"><Notice tone="red">{error}</Notice></div>}
        {mockNote && <div className="min-w-0 flex-1"><Notice tone="amber">Demo mode: nothing was deleted.</Notice></div>}
      </div>
    </Frame>
  );
}
