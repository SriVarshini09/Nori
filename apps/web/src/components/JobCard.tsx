import Link from "next/link";
import type { JobWithMatch } from "@/lib/types";
import { ApplyButton } from "./ApplyButton";
import { idx } from "./cx";
import { Frame } from "./Frame";
import { MatchBadge } from "./MatchBadge";
import { Tag } from "./Pill";

/** Framed job card: index, company, display title, one reason, score + apply. */
export function JobCard({ item, href, index }: { item: JobWithMatch; href?: string; index?: number }) {
  const { job, match } = item;
  const to = href ?? `/jobs?job=${job.id}`;
  return (
    <Frame as="article" className="flex h-full flex-col p-5 transition-colors duration-150 hover:border-line-strong">
      <div className="flex items-start justify-between gap-4">
        <span className="text-label font-medium uppercase text-muted tnum">
          {index !== undefined && <span className="mr-2 text-faint">{idx(index)}</span>}
          {job.companyName}
        </span>
        <MatchBadge score={match?.score} />
      </div>
      <Link href={to} className="mt-5 block font-display text-[21px] font-medium leading-[1.12] tracking-[-0.025em] text-ink decoration-line-strong underline-offset-4 hover:underline" title={job.title}>
        {job.title}
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-meta text-muted">
        <span>{job.location ?? "Location not listed"}</span>
        {job.remote && <Tag>Remote</Tag>}
      </div>
      {match && match.explanation.reasons[0] && <p className="mt-4 line-clamp-2 text-meta text-ink-2">{match.explanation.reasons[0]}</p>}
      <div className="mt-auto pt-6">
        <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
          <Link href={to} className="text-meta font-medium text-muted transition-colors duration-150 hover:text-ink">Details</Link>
          <ApplyButton jobId={job.id} />
        </div>
      </div>
    </Frame>
  );
}
