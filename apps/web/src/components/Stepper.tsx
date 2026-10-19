import { STATUS_LABEL } from "@/lib/format";
import type { ApplicationStatus } from "@/lib/types";
import { cx, idx } from "./cx";

export const PIPELINE: ApplicationStatus[] = [
  "queued", "tailoring", "resume_review", "filling", "form_review", "submitting", "awaiting_code", "submitted",
];

/**
 * Pipeline stepper: hairline track, square dots, 01-08 index labels.
 * Done = ink square, current = accent square (fills over 150ms), upcoming = hollow.
 * For terminal side-states (needs_user, failed, skipped) pass the last pipeline step the run
 * reached as `lastStep` so the stepper shows where it stopped.
 */
export function Stepper({ status, lastStep }: { status: ApplicationStatus; lastStep?: string }) {
  const post = ["viewed", "replied", "interview", "offer", "rejected"].includes(status);
  let current = PIPELINE.indexOf(status);
  let problem: "needs_user" | "failed" | "skipped" | null = null;
  if (post) current = PIPELINE.length - 1;
  else if (current < 0) {
    problem = status as "needs_user" | "failed" | "skipped";
    const li = lastStep ? PIPELINE.indexOf(lastStep as ApplicationStatus) : -1;
    current = li >= 0 ? li : status === "failed" ? 3 : 4;
  }
  const done = post || status === "submitted";
  const label = done ? STATUS_LABEL[status] : problem ? `${STATUS_LABEL[PIPELINE[current]]} · ${STATUS_LABEL[problem]}` : STATUS_LABEL[PIPELINE[current]];

  return (
    <div>
      {/* compact summary for phones, where step labels are hidden */}
      <p className="mb-4 flex items-baseline gap-2 text-meta text-muted sm:hidden">
        <span className="text-label font-medium uppercase text-faint tnum">Step {idx(current + 1)} / {idx(PIPELINE.length)}</span>
        <span className="font-medium text-ink">{label}</span>
      </p>
      <ol className="grid grid-cols-8" aria-label="Application pipeline">
        {PIPELINE.map((step, i) => {
          const isDone = done || i < current;
          const isCurrent = !done && i === current;
          const bad = isCurrent && problem !== null;
          return (
            <li key={step} className="relative min-w-0" aria-current={isCurrent ? "step" : undefined}>
              <div className="flex items-center">
                <span
                  className={cx(
                    "relative z-10 block h-[11px] w-[11px] shrink-0 border transition-colors duration-150",
                    isDone && "border-ink bg-ink",
                    isCurrent && !bad && "border-accent bg-accent",
                    bad && "border-accent bg-paper",
                    !isDone && !isCurrent && "border-line-strong bg-paper",
                  )}
                >
                  {bad && <span className="absolute inset-[2px] bg-accent" />}
                </span>
                {i < PIPELINE.length - 1 && (
                  <span className={cx("h-px flex-1", isDone ? "bg-ink" : "bg-line")} />
                )}
              </div>
              <div className="mt-3 hidden pr-2 sm:block">
                <div className="text-label font-medium text-faint tnum">{idx(i + 1)}</div>
                <div className={cx("mt-1 text-[12px] leading-snug", isCurrent ? "font-medium text-ink" : isDone ? "text-ink-2" : "text-faint")}>
                  {STATUS_LABEL[step]}
                </div>
                {bad && <div className="mt-0.5 text-[12px] font-medium text-accent-ink">{STATUS_LABEL[problem!]}</div>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
