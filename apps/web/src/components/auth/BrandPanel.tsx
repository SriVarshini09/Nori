import { Check } from "lucide-react";
import { Meadow, MeadowFront } from "@/components/landing/Meadow";
import "@/components/landing/landing.css";

const POINTS = [
  "Every resume line traces back to something you did",
  "Roles ranked against your history, with the reasons shown",
  "Nothing is sent until you approve it",
];

/**
 * The right half of the sign-in pages on wide screens: the landing page's meadow, so the step from the front page to
 * the form feels like one place, with what the account is for in three lines on a pane of frosted glass in the sky.
 * Never behind a form.
 */
export function BrandPanel() {
  return (
    <aside aria-label="About Nori" className="ln relative isolate hidden overflow-hidden lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
      <Meadow variant="day" className="-z-10" />
      <div className="relative z-30 mx-auto mt-[11vh] w-full max-w-[460px] px-8">
        <div className="rounded-[24px] border border-white/60 bg-white/65 p-7 shadow-[0_24px_60px_-34px_rgba(40,60,20,0.55)] backdrop-blur-md">
          <p className="text-[1.75rem] font-semibold leading-tight tracking-[-0.02em] text-[#1c2615]">A job agent that cannot lie about you.</p>
          <ul className="mt-5 flex flex-col gap-3">
            {POINTS.map((p) => (
              <li key={p} className="flex items-start gap-3 text-[15px] text-[#2b2722]">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--sprout)] text-[var(--sprout-ink)]"><Check size={15} strokeWidth={3} aria-hidden="true" /></span>
                {p}
              </li>
            ))}
          </ul>
          <div className="mt-6 rounded-[16px] border border-[var(--rice-line)] bg-white/90 p-4">
            <p className="text-[12.5px] text-muted">While you were away</p>
            <p className="mt-1 text-[15px] font-semibold text-ink">3 waiting on you, nothing sent</p>
            <p className="mt-0.5 text-[13px] text-ink-2">A resume to approve, a form to check, one question.</p>
          </div>
        </div>
      </div>
      <MeadowFront variant="day" className="z-20" />
    </aside>
  );
}
