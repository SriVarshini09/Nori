"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { AgentStatus } from "@/lib/types";
import { Notice, cx } from "../ui";

type Mode = NonNullable<AgentStatus["autopilot"]>;

const OPTIONS: { id: Mode; label: string; line: string }[] = [
  { id: "off", label: "Off", line: "You approve every form before it is sent." },
  { id: "safe", label: "On, profile answers only", line: "Nori sends by itself only when every check passes. Anything unusual waits for you." },
  { id: "written", label: "On, short answers allowed", line: "The same, and it may send short answers it wrote, such as \"why this role\"." },
];

/** Checks Nori runs for each application. They depend on the job, so they are shown as rules, not as a state. */
const PER_APPLICATION = [
  "The form is on a site that needs no account (Greenhouse, Lever or Ashby). A CAPTCHA always hands the form to you.",
  "The match is at or above your minimum.",
  "No conflict with citizenship, clearance, sponsorship, location, experience or pay.",
  "Nothing in the posting depends on a profile answer you have not given.",
  "Every required question is answered, and every answer comes from your profile unless you allowed short answers.",
  "The resume reads cleanly for applicant systems.",
  "You have not applied to the same company in the last 30 days.",
];

function CheckRow({ ok, children, detail }: { ok: boolean | null; children: React.ReactNode; detail?: string }) {
  return (
    <li className="flex items-start gap-2.5 py-2">
      <span
        aria-hidden="true"
        className={cx(
          "mt-1 h-3 w-3 shrink-0 rounded-full",
          ok === true && "bg-accent",
          ok === false && "border-2 border-attn",
          ok === null && "border border-control",
        )}
      />
      <div className="min-w-0">
        <p className="text-meta text-ink">{children}</p>
        {detail && <p className="text-[12px] text-muted">{detail}</p>}
      </div>
      <span className="sr-only">{ok === true ? "passes" : ok === false ? "does not pass yet" : "checked for each application"}</span>
    </li>
  );
}

/**
 * Hands-free sending: the Autopilot mode and the checks it runs. The first three checks are this account's state
 * right now; the rest are evaluated per application and written on that application's page when one fails.
 */
export function AutopilotRow({ status, onStatus, onError }: { status: AgentStatus; onStatus: (s: AgentStatus) => void; onError: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const mode: Mode = status.autopilot ?? "off";
  const trust = status.autopilotTrust;
  const earned = !trust || trust.approved >= trust.needed;
  const lockOpen = status.liveSubmit !== false;

  async function choose(next: Mode) {
    if (next === mode || busy) return;
    if (mode === "off" && !window.confirm("Turn on Autopilot?\n\nNori will send an application by itself, without asking, whenever every check passes. Anything unusual still waits for you. You can turn it off at any time.")) return;
    setBusy(true);
    try {
      await api.updateProfile({ autopilot: next });
      onStatus({ ...status, autopilot: next, ...(next !== "off" ? { reviewBeforeSubmit: true } : {}) });
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="checks" aria-labelledby="autopilot-h" className="scroll-mt-20 rounded-card border border-line bg-surface p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 id="autopilot-h" className="text-title font-semibold text-ink">Hands-free sending</h2>
        <span className={cx("rounded-full px-2.5 py-0.5 text-[12px] font-medium", mode === "off" ? "bg-sunken text-muted" : "bg-accent-tint text-accent-fg")}>{mode === "off" ? "Off" : "On"}</span>
      </div>
      <p className="mt-1 text-meta text-muted">Nori may send without asking only when every check below passes. Otherwise the application waits for you, with the reason on its page.</p>

      <div role="radiogroup" aria-label="Autopilot" className="mt-4 flex flex-col gap-2">
        {OPTIONS.map((o) => (
          <button
            key={o.id} type="button" role="radio" aria-checked={mode === o.id} disabled={busy} onClick={() => void choose(o.id)}
            className={cx("flex items-start gap-3 rounded-control border p-3 text-left transition-colors", mode === o.id ? "border-ink bg-sunken" : "border-line hover:border-control")}
          >
            <span aria-hidden="true" className={cx("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border", mode === o.id ? "border-ink" : "border-control")}>
              {mode === o.id && <span className="h-2 w-2 rounded-full bg-ink" />}
            </span>
            <span>
              <span className="block text-body-sm font-semibold text-ink">{o.label}</span>
              <span className="mt-0.5 block text-meta text-muted">{o.line}</span>
            </span>
          </button>
        ))}
      </div>

      <h3 className="mt-5 text-body-sm font-semibold text-ink">Right now</h3>
      <ul className="divide-y divide-line">
        <CheckRow ok={mode !== "off"}>{mode !== "off" ? "Autopilot is on" : "Autopilot is off"}</CheckRow>
        <CheckRow ok={lockOpen} detail={lockOpen ? undefined : "The server owner's switch. You can see it here but not change it."}>
          {lockOpen ? "This server is allowed to send" : "This server's submit lock is off, so nothing can be sent"}
        </CheckRow>
        {trust && (
          <CheckRow ok={earned}>
            {earned ? `You approved ${trust.approved} applications yourself` : `Trust: ${trust.approved} of ${trust.needed} hand approvals so far`}
          </CheckRow>
        )}
      </ul>

      <h3 className="mt-4 text-body-sm font-semibold text-ink">For each application</h3>
      <ul className="divide-y divide-line">
        {PER_APPLICATION.map((c) => <CheckRow key={c} ok={null}>{c}</CheckRow>)}
      </ul>

      {mode !== "off" && !lockOpen && (
        <div className="mt-3"><Notice tone="slate" label="Dry run">Autopilot prepares applications, but this server sends nothing.</Notice></div>
      )}
    </section>
  );
}
