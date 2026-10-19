"use client";

import { Building2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import type { CompanyResearch } from "@/lib/types";
import { idx } from "./cx";
import { Tag } from "./Pill";
import { Button, Notice } from "./ui";

export function ResearchView({ research }: { research: CompanyResearch }) {
  const facts: [string, string | undefined][] = [
    ["Stage", research.stage],
    ["Funding", research.funding],
    ["Headcount", research.headcount],
    ["Interview process", research.interviewProcess],
    ["Sponsorship", research.sponsorshipSignals],
  ];
  return (
    <div className="space-y-5 text-body-sm">
      <p className="text-ink-2">{research.summary}</p>
      <dl className="border-t border-line">
        {facts.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className="grid gap-x-4 gap-y-0.5 border-b border-line py-2.5 sm:grid-cols-[8.5rem_1fr]">
            <dt className="text-meta text-muted">{k}</dt>
            <dd className="text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      {research.recentNews && research.recentNews.length > 0 && (
        <div>
          <div className="mb-2 text-label font-medium uppercase text-muted">Recent news</div>
          <ul className="space-y-1.5 text-ink-2">
            {research.recentNews.map((n) => (
              <li key={n} className="flex gap-2.5"><span aria-hidden="true" className="mt-[8px] h-[5px] w-[5px] shrink-0 bg-ink" />{n}</li>
            ))}
          </ul>
        </div>
      )}
      {research.citations.length > 0 && (
        <div>
          <div className="mb-2 text-label font-medium uppercase text-muted">Sources</div>
          <ol className="border-t border-line">
            {research.citations.map((c, i) => (
              <li key={c.url + i} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-2 border-b border-line py-2 text-meta">
                <span className="text-label font-medium text-faint tnum">{idx(i + 1)}</span>
                <span className="min-w-0">
                  <Tag className="mr-2">{c.field}</Tag>
                  <a href={c.url} target="_blank" rel="noreferrer" className="break-words text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">{c.title || c.url}</a>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

/** Company research with a "Research" action (POST /api/jobs/:id/research). */
export function ResearchPanel({ jobId, initial }: { jobId: string; initial: CompanyResearch | null }) {
  const [research, setResearch] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setResearch((await api.researchJob(jobId)).research);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {research ? <ResearchView research={research} /> : <p className="text-body-sm text-muted">No research yet. Research pulls funding, headcount, interview process and sponsorship signals with sources.</p>}
      {error && <Notice tone="red">{error}</Notice>}
      <Button icon={research ? RefreshCw : Building2} onClick={run} disabled={busy}>{busy ? "Researching..." : research ? "Refresh research" : "Research company"}</Button>
    </div>
  );
}
