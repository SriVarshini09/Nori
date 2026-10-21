import { Check, CircleAlert, CircleDashed, CircleX } from "lucide-react";
import type { MustHave, RecruiterReview } from "@/lib/types";
import { Accordion, IndexLabel, cx } from "./ui";

const VERDICT: Record<RecruiterReview["verdict"], { label: string; line: string }> = {
  strong: { label: "Strong", line: "A recruiter would likely move this forward." },
  good: { label: "Good", line: "A fair match with a few things worth fixing." },
  needs_work: { label: "Needs work", line: "A recruiter would likely pass unless the gaps are fixed." },
};

const STATUS: Record<MustHave["status"], { label: string; cls: string; icon: typeof Check }> = {
  demonstrated: { label: "shown in your experience", cls: "border-emerald-600/30 bg-emerald-50 text-emerald-900", icon: Check },
  listed: { label: "only in the skills list", cls: "border-amber-600/30 bg-amber-50 text-amber-900", icon: CircleDashed },
  missing: { label: "not on your resume", cls: "border-rose-600/30 bg-rose-50 text-rose-900", icon: CircleX },
};

const SEVERITY: Record<"high" | "medium" | "low", string> = { high: "bg-rose-500", medium: "bg-amber-500", low: "bg-stone-400" };

/**
 * What a recruiter would see on this resume for this job: a score, what is working, what is not and how to fix it, and each
 * skill the posting asks for with whether the resume shows it. A missing skill is never filled in for you: it says so.
 */
export function RecruiterView({ review }: { review: RecruiterReview }) {
  const v = VERDICT[review.verdict];
  const musts = [...review.musts].sort((a, b) => Number(b.required) - Number(a.required) || a.status.localeCompare(b.status));
  const missing = musts.filter((m) => m.status === "missing" && m.required);
  return (
    <section aria-labelledby="recruiter-h" className="rounded-2xl border border-line bg-paper p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <IndexLabel>Recruiter&apos;s view</IndexLabel>
          <h3 id="recruiter-h" className="mt-2 font-display text-title font-medium text-ink">{v.label}: {review.score} out of 100</h3>
          <p className="mt-1 text-body-sm text-muted">{v.line}</p>
        </div>
        <div className="text-meta text-muted tnum" aria-label="Resume facts">
          {review.stats.quantifiedPct}% of bullets show a result
          {review.stats.years !== null && <> &middot; {review.stats.years} yrs{review.stats.requiredYears ? ` (asked ${review.stats.requiredYears}+)` : ""}</>}
        </div>
      </div>

      {musts.length > 0 && (
        <div className="mt-5">
          <p className="text-label font-medium uppercase text-muted">What the job asks for</p>
          <ul aria-label="Skills the job asks for" className="mt-2 flex flex-wrap gap-2">
            {musts.map((m) => {
              const s = STATUS[m.status];
              return (
                <li key={m.skill} className={cx("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px]", s.cls)} title={`${m.skill}: ${s.label}${m.required ? " (required)" : ""}`}>
                  <s.icon size={13} aria-hidden="true" />
                  <span className="font-medium">{m.skill}</span>
                  <span className="sr-only">{s.label}</span>
                  {!m.required && <span className="text-[11px]">(optional)</span>}
                </li>
              );
            })}
          </ul>
          {missing.length > 0 && (
            <p className="mt-2 text-meta text-muted">
              Nori never adds a skill you have not shown. If you really have {missing.map((m) => m.skill).join(" or ")}, tell Nori the fact on the Career graph page and tailor again.
            </p>
          )}
        </div>
      )}

      {review.concerns.length > 0 && (
        <ul aria-label="What a recruiter would question" className="mt-5 space-y-3">
          {review.concerns.map((c) => (
            <li key={c.id} className="flex gap-3">
              <span aria-hidden="true" className={cx("mt-[7px] h-2 w-2 shrink-0 rounded-full", SEVERITY[c.severity])} />
              <div className="min-w-0">
                <p className="text-body-sm font-medium text-ink">{c.title}</p>
                <p className="text-meta text-muted">{c.detail}{c.fix ? <> <span className="text-ink-2">{c.fix}</span></> : null}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {review.strengths.length > 0 && (
        <div className="mt-5">
          <Accordion title={<span className="inline-flex items-center gap-2"><CircleAlert size={15} aria-hidden="true" />What is working ({review.strengths.length})</span>}>
            <ul className="list-disc space-y-1.5 pl-5 text-meta text-muted">{review.strengths.map((s) => <li key={s}>{s}</li>)}</ul>
          </Accordion>
        </div>
      )}
    </section>
  );
}
