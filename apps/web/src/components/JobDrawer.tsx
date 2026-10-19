import { ArrowRight, ExternalLink, X } from "lucide-react";
import Link from "next/link";
import { STATUS_LABEL } from "@/lib/format";
import type { ApplicationStatus, JobDetail } from "@/lib/types";
import { Accordion } from "./Accordion";
import { ApplyButton } from "./ApplyButton";
import { cx, idx } from "./cx";
import { Frame } from "./Frame";
import { Icon } from "./Icon";
import { IndexLabel, Square } from "./IndexLabel";
import { MatchRing } from "./MatchRing";
import { ResearchPanel } from "./ResearchPanel";
import { STATUS_MARK } from "./StatusPill";
import { TimeAgo } from "./TimeAgo";
import { monogram, placeName, postedIso, seniorityKey, seniorityLabel, sourceLabel, workMode } from "./jobMeta";

function Block({ n, title, aside, children }: { n: number; title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Frame as="section" className="p-5 sm:p-6">
      <header className="mb-4 flex items-center justify-between gap-3">
        <h3><IndexLabel index={idx(n)} marker tone="ink">{title}</IndexLabel></h3>
        {aside && <span className="text-[12px] text-faint tnum">{aside}</span>}
      </header>
      {children}
    </Frame>
  );
}

const sub = "mb-2 text-label font-medium uppercase text-muted";
const pill = "inline-flex h-[22px] items-center rounded-full px-2 text-[11.5px] font-medium leading-none";

function Chip({ name, matched, note }: { name: string; matched: boolean; note?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-[var(--radius-tag)] px-1.5 py-[2px] text-[12px] leading-[1.35]", matched ? "bg-stone text-ink" : "border border-line text-muted")}>
      <span className={matched ? "" : "line-through decoration-faint decoration-1"}>{name}</span>
      {note && <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-accent-ink no-underline">{note}</span>}
    </span>
  );
}

/** Server-rendered job detail drawer in the card language; `closeHref` is the board URL without ?job=. */
export function JobDrawer({ detail, closeHref, application }: {
  detail: JobDetail; closeHref: string; application?: { id: string; status: ApplicationStatus } | null;
}) {
  const { job, match, company } = detail;
  const req = job.requirements;
  const required = req?.skills.filter((s) => s.required) ?? [];
  const nice = req?.skills.filter((s) => !s.required) ?? [];
  const matchedSet = new Set(match?.explanation.matched.map((m) => m.requirement.toLowerCase()));
  const matchedUnique = [...new Map(match?.explanation.matched.map((m) => [m.requirement.toLowerCase(), m]) ?? []).values()];
  const missing = match?.explanation.missing ?? [];
  const mode = workMode(job);
  const place = placeName(job.location);
  const sen = seniorityKey(job);
  let n = 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={`${job.title} at ${job.companyName}`}>
      <Link href={closeHref} aria-label="Close" className="absolute inset-0 bg-ink/25" scroll={false} />
      <aside className="relative flex h-full w-full max-w-[640px] flex-col overflow-y-auto border-l border-line bg-canvas">
        <header className="sticky top-0 z-10 border-b border-line bg-canvas px-5 pb-5 pt-4 sm:px-8">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center bg-ink font-display text-[12px] font-medium tracking-[0.04em] text-paper">{monogram(job.companyName)}</span>
            <span className="min-w-0 flex-1 truncate text-body-sm font-medium text-ink">
              {job.companyName}
              <span className="ml-2 font-normal text-faint">Posted <TimeAgo iso={postedIso(job)} /></span>
            </span>
            <Link href={closeHref} scroll={false} aria-label="Close drawer" className="inline-flex h-8 shrink-0 items-center gap-2 rounded-full border border-line px-3 text-[12px] font-medium uppercase tracking-[0.09em] text-ink transition-colors duration-150 hover:border-ink">
              <Icon icon={X} /> Close
            </Link>
          </div>
          <h2 className="mt-4 font-display text-[1.625rem] font-medium leading-[1.06] tracking-[-0.03em] text-ink sm:text-display-md">{job.title}</h2>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {place && <span className={cx(pill, "bg-stone text-ink-2")}>{place}</span>}
            <span className={cx(pill, "bg-stone text-ink-2")}>{mode}</span>
            {sen && <span className={cx(pill, "bg-stone text-ink-2")}>{seniorityLabel(sen)}</span>}
            <span className={cx(pill, "border border-line text-muted")}>{sourceLabel(job.atsType)}</span>
          </div>
        </header>

        <div className="space-y-4 px-5 py-6 sm:px-8">
          <Frame className="p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <MatchRing score={match?.score} size={64} />
                <div>
                  <div className="text-label font-medium uppercase text-muted">Match</div>
                  <div className="mt-1 text-body-sm text-ink tnum">
                    {match ? `${matchedUnique.length} matched, ${new Set(missing.map((m) => m.requirement)).size} missing` : "Not scored yet"}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <a href={job.applyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-meta font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
                  Posting <Icon icon={ExternalLink} />
                </a>
                {application ? (
                  <Link href={`/applications/${application.id}`} className="inline-flex h-9 items-center gap-2 rounded-full bg-stone px-3.5 text-[12.5px] font-medium text-ink transition-colors duration-150 hover:bg-stone-2">
                    <Square tone={STATUS_MARK[application.status] ?? "muted"} size={6} />
                    Applied &middot; {STATUS_LABEL[application.status] ?? application.status} <Icon icon={ArrowRight} />
                  </Link>
                ) : (
                  <ApplyButton jobId={job.id} size="md" />
                )}
              </div>
            </div>
            {req?.summary && <p className="mt-5 border-t border-line pt-4 text-body text-ink-2">{/[.!?)"”]$/.test(req.summary.trim()) ? req.summary : `${req.summary.trim().replace(/\s+\S*$/, "")}…`}</p>}
          </Frame>

          <Block n={++n} title="Requirements" aside={req ? `${required.length} required · ${nice.length} nice` : undefined}>
            {req ? (
              <div className="space-y-5">
                <dl className="grid grid-cols-3 border-y border-line text-body-sm">
                  {[["Seniority", sen ? seniorityLabel(sen) : "–"], ["Min years", req.yearsMin ?? "–"], ["Family", req.roleFamily || "–"]].map(([k, v], i) => (
                    <div key={String(k)} className={i > 0 ? "border-l border-line py-3 pl-4" : "py-3"}>
                      <dt className="text-label font-medium uppercase text-muted">{k}</dt>
                      <dd className="mt-1 capitalize text-ink tnum">{v}</dd>
                    </div>
                  ))}
                </dl>
                {[["Required", required], ["Nice to have", nice]].map(([label, list]) => (
                  <div key={label as string}>
                    <div className={sub}>{label as string}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {(list as typeof required).length === 0 && <span className="text-meta text-faint">None extracted</span>}
                      {(list as typeof required).map((s) => <Chip key={s.name} name={s.name} matched={matchedSet.has(s.name.toLowerCase())} />)}
                    </div>
                  </div>
                ))}
                {req.disqualifiers.length > 0 && (
                  <p className="flex items-start gap-2 text-meta text-ink"><span aria-hidden="true" className="mt-[6px] h-[6px] w-[6px] shrink-0 bg-accent" />Watch out: {req.disqualifiers.join("; ")}</p>
                )}
              </div>
            ) : (
              <p className="text-body-sm text-muted">Requirements have not been extracted yet.</p>
            )}
          </Block>

          <Block n={++n} title="Why this match" aside={match ? `${match.explanation.reasons.length} reasons` : undefined}>
            {match ? (
              <div className="space-y-6 text-body-sm">
                <ol className="border-t border-line">
                  {match.explanation.reasons.map((r, i) => (
                    <li key={r + i} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-2 border-b border-line py-2.5">
                      <span className="text-label font-medium text-faint tnum">{idx(i + 1)}</span>
                      <span className="text-ink-2">{r}</span>
                    </li>
                  ))}
                </ol>
                <div>
                  <div className={sub}>Matched &middot; {matchedUnique.length}</div>
                  <ul className="border-t border-line">
                    {matchedUnique.map((m) => (
                      <li key={m.requirement + m.nodeId} className="grid gap-x-4 gap-y-1 border-b border-line py-2.5 sm:grid-cols-[9rem_minmax(0,1fr)]">
                        <span><Chip name={m.requirement.length > 40 ? `${m.requirement.slice(0, 38)}…` : m.requirement} matched /></span>
                        <Link href={`/graph?node=${encodeURIComponent(m.nodeId)}`} className="text-meta text-ink-2 underline decoration-line underline-offset-4 hover:decoration-ink">
                          {m.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className={sub}>Missing &middot; {missing.length}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {missing.length === 0 && <span className="text-meta text-faint">Nothing missing</span>}
                    {missing.map((m) => (
                      <Chip key={m.requirement} name={m.requirement.length > 48 ? `${m.requirement.slice(0, 46)}…` : m.requirement} matched={false} note={m.required ? "req" : undefined} />
                    ))}
                  </div>
                  {missing.length > 0 && (
                    <p className="mt-3 text-meta text-muted">Have experience with these? <Link href="/graph" className="text-ink underline decoration-line-strong underline-offset-4">Tell the agent a fact</Link> and the score updates.</p>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-body-sm text-muted">Not scored yet.</p>
            )}
          </Block>

          <Block n={++n} title={`Company research${company ? ` · ${company.name}` : ""}`} aside={company?.research ? `${company.research.citations.length} sources` : undefined}>
            <ResearchPanel jobId={job.id} initial={company?.research ?? null} />
          </Block>

          <Frame className="px-5 sm:px-6">
            <Accordion index={idx(++n)} title="Full description" meta={`${Math.max(1, Math.round(job.descriptionText.split(/\s+/).length / 230))} min read`} className="border-y-0">
              <div className="max-w-prose whitespace-pre-wrap text-body text-ink-2">{job.descriptionText}</div>
            </Accordion>
          </Frame>
        </div>
      </aside>
    </div>
  );
}
