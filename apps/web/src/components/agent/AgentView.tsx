"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { AgentStatus, Lane } from "@/lib/types";
import { Frame, Notice, Toggle } from "../ui";
import { AutopilotRow } from "./AutopilotRow";
import { CapFrame, LanesFrame } from "./Lanes";

/**
 * Lanes and autopilot: the rules Nori follows. Lanes say which jobs may be queued, the cap says how many per day,
 * the two switches say where Nori stops to ask, and the panel on the right says when it may send on its own.
 */
export function AgentView({ initialStatus, initialLanes }: { initialStatus: AgentStatus; initialLanes: Lane[] }) {
  const [status, setStatus] = useState(initialStatus);
  const [lanes, setLanes] = useState(initialLanes);
  const [error, setError] = useState<string | null>(null);

  async function toggle(key: "autoApprove" | "reviewBeforeSubmit", value: boolean) {
    const prev = status;
    setStatus({ ...status, [key]: value });
    setError(null);
    try {
      await api.updateProfile(key === "autoApprove" ? { resumeAutoApprove: value } : { reviewBeforeSubmit: value });
    } catch (e) {
      setStatus(prev);
      setError((e as Error).message);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex min-w-0 flex-col gap-5">
        {error && <Notice tone="red">{error}</Notice>}
        <LanesFrame lanes={lanes} status={status} onLanes={setLanes} />
        <CapFrame status={status} onStatus={setStatus} />
        <Frame as="section" className="px-4 sm:px-5">
          <h2 className="pt-4 text-body-sm font-semibold text-ink">Where Nori stops to ask</h2>
          <div className="divide-y divide-line">
            <Toggle
              label="Review every resume"
              hint="On: you approve each tailored resume. Off: a resume is approved by itself when its checks pass."
              checked={!status.autoApprove}
              onChange={(v) => void toggle("autoApprove", !v)}
            />
            <Toggle
              label="Review every form before it is sent"
              hint="Recommended until you trust it. Autopilot replaces this with its checks when it is on."
              checked={status.reviewBeforeSubmit}
              onChange={(v) => void toggle("reviewBeforeSubmit", v)}
            />
          </div>
        </Frame>
      </div>
      <div className="flex min-w-0 flex-col gap-5">
        <AutopilotRow status={status} onStatus={setStatus} onError={setError} />
      </div>
    </div>
  );
}
