import { cx } from "./cx";

const PALETTES = [
  "border-[#b6e4cc] bg-[linear-gradient(145deg,#e2f7ec_0%,#c6eed9_100%)] text-[#074d38]",
  "border-[#bdd7f7] bg-[linear-gradient(145deg,#e6f1ff_0%,#cde2fc_100%)] text-[#153f75]",
  "border-[#f2cf9d] bg-[linear-gradient(145deg,#fff1dc_0%,#fde1b8_100%)] text-[#753506]",
  "border-[#f2c2cf] bg-[linear-gradient(145deg,#ffeaef_0%,#fbd2dd_100%)] text-[#781b34]",
  "border-[#cfc1f5] bg-[linear-gradient(145deg,#efeaff_0%,#dfd5fc_100%)] text-[#3f276e]",
  "border-[#b4e3e3] bg-[linear-gradient(145deg,#e2f7f7_0%,#c5ecec_100%)] text-[#0c4f52]",
  "border-[#d4e3b3] bg-[linear-gradient(145deg,#f0f7df_0%,#dcebc0_100%)] text-[#334f10]",
  "border-[#f5c8b8] bg-[linear-gradient(145deg,#ffece6_0%,#fbd6ca_100%)] text-[#782610]",
];

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % PALETTES.length;
}

/** Company avatar with deterministic sunlit pastel palette. */
export function Monogram({ name, size = 40, className }: { name: string; size?: number; className?: string }) {
  const clean = name.trim() || "C";
  const palette = PALETTES[hashName(clean.toLowerCase())];
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-xl border font-bold shadow-[0_2px_6px_rgba(19,28,24,0.05),inset_0_1px_0_rgba(255,255,255,0.7)]",
        palette,
        className,
      )}
    >
      {clean.charAt(0).toUpperCase()}
    </span>
  );
}
