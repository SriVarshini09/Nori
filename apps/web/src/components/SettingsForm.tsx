"use client";

import { CalendarDays, Check, Hash, Link2, Mail, Plug, RefreshCw, Sheet, Trash2, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { USE_MOCK, api, ApiError } from "@/lib/api";
import { pct } from "@/lib/format";
import type { Channel, Integration, Profile, TelegramInfo, TelegramLink } from "@/lib/types";
import { Button, Field, Frame, Icon, IndexLabel, Notice, Pill, TextLink, Toggle, inputClass } from "./ui";

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
        {items.map((i) => (
          <li key={i.toolkit} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-b border-line py-4">
            
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-body-sm font-medium text-ink"><Icon icon={TOOLKIT_ICON[i.toolkit] ?? Plug} />{TOOLKIT_LABEL[i.toolkit] ?? i.toolkit}</div>
            </div>
            <div className="flex items-center gap-3">
              {i.connected && <Pill mark="ink" className="hidden sm:inline-flex">Connected</Pill>}
              <Button variant={i.connected ? "secondary" : "primary"} icon={Plug} onClick={() => connect(i.toolkit)} disabled={busy === i.toolkit || i.available === false} title={i.available === false ? "Connections are not switched on for this Nori yet" : undefined}>
                {busy === i.toolkit ? "Opening..." : i.available === false ? "Not available yet" : i.connected ? "Reconnect" : "Connect"}
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

export function Channels({ channels: initial, telegram }: { channels: Channel[]; telegram?: TelegramInfo | null }) {
  const [channels, setChannels] = useState(initial);
  const [link, setLink] = useState<TelegramLink | null>(null);
  const [busy, setBusy] = useState<"link" | "check" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const has = (k: Channel["kind"]) => channels.some((c) => c.kind === k);
  const tgLinked = has("telegram");
  const bot = link?.botUsername ?? telegram?.botUsername ?? null;
  const fail = (e: unknown) => setError(e instanceof ApiError ? e.detail : (e as Error).message);

  async function getCode() {
    setBusy("link"); setError(null); setNote(null);
    try { setLink(await api.telegramLink()); } catch (e) { fail(e); } finally { setBusy(null); }
  }
  async function check() {
    setBusy("check"); setError(null);
    try {
      const next = await api.listChannels();
      setChannels(next);
      const ok = next.some((c) => c.kind === "telegram");
      setNote(ok ? "Linked. Review requests now reach your phone." : "Not linked yet. Send the code to the bot, then check again.");
      if (ok) setLink(null);
    } catch (e) { fail(e); } finally { setBusy(null); }
  }

  return (
    <div className="space-y-6 text-body-sm">
      {channels.length > 0 && (
        <ol className="border-t border-line">
          {channels.map((c) => (
            <li key={c.id} className="grid grid-cols-[6rem_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-line py-3 sm:grid-cols-[8rem_minmax(0,1fr)_auto]">
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
            <IndexLabel tone="ink">Telegram{bot ? <span className="ml-2 font-normal text-muted">@{bot}</span> : null}</IndexLabel>
            {tgLinked ? <Pill mark="ink">Linked</Pill> : <Pill mark="hollow">Not linked</Pill>}
          </div>
          {telegram && !telegram.configured ? (
            <p className="mt-4 text-meta text-ink-2">Telegram is not switched on for this Nori yet.</p>
          ) : tgLinked ? (
            <p className="mt-4 text-meta text-ink-2">Your phone is linked. Say <span className="font-medium text-ink">status</span> to the bot any time, or reply to a review request with <span className="font-medium text-ink">approve 1</span>.</p>
          ) : (
            <>
              <ol className="mt-4 list-decimal space-y-2 pl-5 text-meta text-ink-2">
                <li>Press Link Telegram to get a one-time code.</li>
                <li>{bot ? `Open @${bot} in Telegram and send the code.` : "Open your Nori bot in Telegram and send the code."}</li>
                <li>Press Check. The chat appears above once linked.</li>
              </ol>
              {link && (
                <div className="mt-4 rounded-card bg-sunken p-4" role="status">
                  <div className="text-label font-medium uppercase text-muted">Your code, valid 15 minutes</div>
                  <div className="mt-1 font-mono text-[26px] font-semibold tracking-[0.3em] text-ink">{link.code}</div>
                  {link.link && <div className="mt-2"><TextLink href={link.link} external>Open @{link.botUsername} with the code filled in</TextLink></div>}
                </div>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button icon={Link2} onClick={getCode} disabled={busy !== null}>{busy === "link" ? "Getting a code..." : link ? "New code" : "Link Telegram"}</Button>
                <Button variant="secondary" icon={RefreshCw} onClick={check} disabled={busy !== null}>{busy === "check" ? "Checking..." : "Check"}</Button>
              </div>
            </>
          )}
          {note && <p className="mt-3 text-meta text-ink-2" role="status">{note}</p>}
          {error && <div className="mt-3"><Notice tone="red">{error}</Notice></div>}
        </Frame>
        <Frame className="p-5">
          <div className="flex items-center justify-between gap-3">
            <IndexLabel tone="ink">Slack</IndexLabel>
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
          className="border-[#a8321f]! text-[#a8321f]! hover:bg-[#a8321f]! hover:text-on-ink!"
        >
          {busy ? "Deleting..." : "Delete account"}
        </Button>
        {error && <div className="min-w-0 flex-1"><Notice tone="red">{error}</Notice></div>}
        {mockNote && <div className="min-w-0 flex-1"><Notice tone="amber">Demo mode: nothing was deleted.</Notice></div>}
      </div>
    </Frame>
  );
}
