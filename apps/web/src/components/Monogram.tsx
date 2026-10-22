import { cx } from "./cx";

const MONO_GRADS = [
  "from-emerald-400 to-teal-600",
  "from-violet-400 to-indigo-600",
  "from-amber-400 to-orange-600",
  "from-sky-400 to-blue-600",
  "from-rose-400 to-pink-600",
  "from-lime-400 to-green-600",
];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Company avatar: initial on a gradient picked from the name, so each company keeps its colour. */
export function Monogram({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      className={cx("inline-flex shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br font-display font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]", MONO_GRADS[hash(name) % MONO_GRADS.length])}
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}
