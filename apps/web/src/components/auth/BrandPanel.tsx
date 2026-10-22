import { Check } from "lucide-react";
import { NoriBuddy } from "@/components/home/NoriBuddy";

const POINTS = [
  "Every resume line traces back to something you did",
  "Roles ranked against your history, with the reasons shown",
  "Nothing is sent until you approve it",
];

/** The right half of the sign-in pages on wide screens: Nori and what the account is for. Never behind a form. */
export function BrandPanel() {
  return (
    <aside aria-label="About Nori" className="relative hidden overflow-hidden border-l border-rule bg-sun-soft lg:flex lg:min-h-screen lg:flex-col lg:justify-center">
      <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(circle_at_70%_10%,#fffaf0_0%,#fff1c2_45%,#ffe39a_100%)]" />
      <div className="relative mx-auto w-full max-w-[520px] px-10 py-12">
        <NoriBuddy className="mx-auto block h-auto w-full max-w-[420px]" signText={["Your", "growth", "starts", "here."]} note={["Takes about", "a minute."]} />
        <p className="mt-6 font-display text-[1.75rem] font-semibold leading-[1.15] tracking-[-0.02em] text-bark">
          A job agent that cannot lie about you.
        </p>
        <ul className="mt-5 space-y-3">
          {POINTS.map((p) => (
            <li key={p} className="flex items-start gap-3 text-[15px] text-bark-2">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-sage"><Check size={15} aria-hidden="true" /></span>
              {p}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
