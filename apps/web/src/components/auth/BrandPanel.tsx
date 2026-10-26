import { Check, ShieldCheck } from "lucide-react";
import { NoriMascot3D } from "@/components/mascot/NoriMascot3D";

const POINTS = [
  "Every resume line traces back to something you did",
  "Roles ranked against your history, with the reasons shown",
  "Nothing is sent until you approve it",
];

/** The right half of the sign-in pages on wide screens: sunlit botanical showcase with interactive 3D Nori. */
export function BrandPanel() {
  return (
    <aside
      aria-label="About Nori"
      className="bento-hero hidden border-l border-line lg:flex lg:min-h-screen lg:flex-col lg:justify-center"
    >
      <div className="mx-auto w-full max-w-[480px] px-10 py-12">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#bce6d1] bg-[#e6f8ef] px-3 py-1 text-[12px] font-semibold text-accent-fg shadow-2xs">
          <ShieldCheck size={14} aria-hidden="true" className="text-accent" />
          Career-graph job agent
        </span>
        <p className="mt-4 text-[1.95rem] font-semibold leading-[1.14] tracking-[-0.024em] text-ink">
          A job agent that cannot lie about you.
        </p>
        <ul className="mt-6 flex flex-col gap-3">
          {POINTS.map((p) => (
            <li key={p} className="flex items-start gap-3 text-[15px] text-ink-2">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#bce6d1] bg-[#e6f8ef] text-accent">
                <Check size={14} aria-hidden="true" />
              </span>
              {p}
            </li>
          ))}
        </ul>

        <NoriMascot3D
          variant="auth"
          className="bento-mint mt-8 border-[#bce6d1] shadow-sm"
          messages={[
            "Welcome! Type your details on the left.",
            "Click the password box—I'll cover my eyes!",
            "3 items are waiting on your OK inside.",
          ]}
        />

        <div className="bento-honey mt-4 rounded-card border p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <p className="text-[12.5px] font-medium text-ink-2">While you were away</p>
            <span className="rounded-full bg-attn px-2 py-0.5 text-[11px] font-semibold text-white">3 gates</span>
          </div>
          <p className="mt-1 text-[15px] font-semibold text-ink">3 waiting on you, nothing sent</p>
          <p className="mt-0.5 text-[13px] text-ink-2">A tailored resume to approve, a filled form to check, one question.</p>
        </div>
      </div>
    </aside>
  );
}
