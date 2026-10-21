"use client";

import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import type { AgentStatus } from "@/lib/types";
import { Accordion, IndexLabel, Notice, cx } from "../ui";

type Mode = NonNullable<AgentStatus["autopilot"]>;

const OPTIONS: { id: Mode; label: string; line: string }[] = [
  { id: "off", label: "Off", line: "You approve every form before it is sent." },
  { id: "safe", label: "Safe", line: "Nori sends by itself only when every check passes. Anything unusual waits for you." },
  { id: "written", label: "Safe + short answers", line: "The same, and it may also send answers it wrote itself, such as \"why this role\"." },
];

const CHECKS = [
  "The form is on a site that needs no account: Greenhouse, Lever or Ashby.",
  "The match is at or above your minimum score.",
  "The posting does not need a citizenship, clearance, sponsorship, location, experience or pay you do not meet.",
  "Nothing in the posting depends on a profile answer you have not given.",
  "Every required question is answered, and every answer comes from your profile (unless you chose short answers).",
  "The resume reads cleanly for applicant systems.",
  "You have approved a few applications yourself first.",
  "You have not applied to the same company in the last 30 days.",
  "The server is allowed to send (ALLOW_REAL_SUBMIT).",
];

/** Autopilot: turns the "Review before submit" wait into "review unless every check passes". */
export function AutopilotRow({ status, onStatus, onError }: { status: AgentStatus; onStatus: (s: AgentStatus) => void; onError: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const mode: Mode = status.autopilot ?? "off";
  const trust = status.autopilotTrust;
  const earned = !trust || trust.approved >= trust.needed;

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
    <div className="border-t border-line px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <IndexLabel>Autopilot</IndexLabel>
        {mode !== "off" && trust && (
          <span className={cx("text-meta tnum", earned ? "text-ink" : "text-muted")} role="status">
            {earned ? `Active: you approved ${trust.approved} yourself` : `Starts after you approve ${trust.needed} yourself (${trust.approved} so far)`}
          </span>
        )}
      </div>
      <div role="radiogroup" aria-label="Autopilot" className="mt-3 grid gap-2 sm:grid-cols-3">
        {OPTIONS.map((o) => (
          <button
            key={o.id} type="button" role="radio" aria-checked={mode === o.id} disabled={busy} onClick={() => void choose(o.id)}
            className={cx("rounded-xl border p-3 text-left transition-colors duration-150", mode === o.id ? "border-ink bg-ink text-paper" : "border-line hover:border-ink")}
          >
            <span className="block text-body-sm font-medium">{o.label}</span>
            <span className={cx("mt-1 block text-meta", mode === o.id ? "text-paper/80" : "text-muted")}>{o.line}</span>
          </button>
        ))}
      </div>
      {mode !== "off" && status.liveSubmit === false && (
        <div className="mt-3"><Notice tone="amber" label="Dry run">This server is in dry-run mode, so Autopilot prepares applications but nothing is sent.</Notice></div>
      )}
      <div className="mt-3">
        <Accordion title={<span className="inline-flex items-center gap-2"><ShieldCheck size={15} aria-hidden="true" />What Autopilot checks before it sends</span>}>
          <ul className="list-disc space-y-1.5 pl-5 text-meta text-muted">{CHECKS.map((c) => <li key={c}>{c}</li>)}</ul>
          <p className="mt-3 text-meta text-muted">If any check fails, the application waits for you with the reason written on its page.</p>
        </Accordion>
      </div>
    </div>
  );
}
