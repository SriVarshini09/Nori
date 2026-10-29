import { Check } from "lucide-react";

const POINTS = [
  "Every resume line traces back to something you did",
  "Roles ranked against your history, with the reasons shown",
  "Nothing is sent until you approve it",
];

/**
 * The right half of the sign-in pages on wide screens: what the account is for, in three lines. Never behind a form.
 * Dark, like the landing site's dark sections, with its dot grid texture.
 */
export function BrandPanel() {
  return (
    <aside aria-label="About Nori" className="relative isolate hidden overflow-hidden bg-[#131209] lg:flex lg:min-h-screen lg:flex-col lg:justify-center">
      <div aria-hidden="true" className="dot-grid absolute inset-0 -z-10 opacity-20" />
      <div className="mx-auto w-full max-w-[460px] px-10 py-12">
        <p className="text-display-lg text-[#edebe4]">A job agent that cannot lie about you.</p>
        <ul className="mt-8 flex flex-col gap-4">
          {POINTS.map((p) => (
            <li key={p} className="flex items-start gap-3 text-[15px] text-[#a3a097]">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#313131] text-[#5ec2b0]"><Check size={14} aria-hidden="true" /></span>
              {p}
            </li>
          ))}
        </ul>
        <div className="mt-10 rounded-card border border-[#313131] bg-[#1f1f1f] p-5">
          <p className="text-[12.5px] text-[#a3a097]">While you were away</p>
          <p className="mt-1 text-[15px] font-semibold text-[#edebe4]">3 waiting on you, nothing sent</p>
          <p className="mt-0.5 text-[13px] text-[#a3a097]">A resume to approve, a form to check, one question.</p>
        </div>
      </div>
    </aside>
  );
}
