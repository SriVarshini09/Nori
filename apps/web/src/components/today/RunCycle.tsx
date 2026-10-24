"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Play } from "lucide-react";
import { api } from "@/lib/api";
import type { AgentTickSummary } from "@/lib/types";
import { Button } from "../ui";

export function summarizeTick(s: AgentTickSummary): string {
  const parts: string[] = [];
  if (s.discovered) parts.push(`found ${s.discovered}`);
  if (s.queued) parts.push(`queued ${s.queued}`);
  if (s.skipped.length) parts.push(`skipped ${s.skipped.length}`);
  if (s.submitted) parts.push(`sent ${s.submitted}`);
  if (s.awaitingReview) parts.push(`${s.awaitingReview} waiting on you`);
  if (s.needsUser) parts.push(`${s.needsUser} need${s.needsUser === 1 ? "s" : ""} an answer`);
  if (parts.length === 0) return s.note ?? "Nothing new this time.";
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1) + "." + (!s.queued && s.note ? ` ${s.note}` : "");
}

/**
 * Starts one agent cycle. A cycle can take minutes on a local model, so the button says what is happening and
 * that leaving is safe; the cycle keeps running on the server either way.
 */
export function RunCycle({ size = "md" }: { size?: "sm" | "md" }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    setMessage(null);
    try {
      const s = await api.agentTick();
      setMessage(summarizeTick(s));
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1.5 sm:items-end">
      <Button variant="secondary" size={size} icon={Play} onClick={run} disabled={running}>
        {running ? <span>Running a cycle<span className="dots" /></span> : "Run a cycle now"}
      </Button>
      <p className="max-w-[40ch] text-[12px] text-muted sm:text-right" role="status" aria-live="polite">
        {running && "This can take a few minutes on a local model. You can leave this page; it keeps going."}
        {!running && message}
        {!running && error && <span className="text-danger-fg">{error}</span>}
      </p>
    </div>
  );
}
