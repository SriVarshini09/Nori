"use client";

import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Check, LoaderCircle, Plus, X } from "lucide-react";
import { Icon, cx, inputClass } from "../ui";

/** Rounded card used inside steps (replaces the old crop-tick frame). */
export function Soft({ children, className, tint = false }: { children: ReactNode; className?: string; tint?: boolean }) {
  return (
    <div className={cx("rounded-2xl border border-black/[0.07] p-5", tint ? "bg-gradient-to-br from-emerald-50 via-white to-amber-50/60" : "bg-white", className)}>
      {children}
    </div>
  );
}

const obBase = "group inline-flex h-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full px-6 text-[14px] font-semibold transition-all duration-150 disabled:pointer-events-none disabled:opacity-45";

/** Onboarding button: `primary` is the glowing gradient pill, `soft` a quiet outline, `ghost` plain text. */
export function ObButton({ variant = "primary", className, children, ...rest }: { variant?: "primary" | "soft" | "ghost" } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cx(
        obBase,
        variant === "primary" && "dash-btn",
        variant === "soft" && "border border-black/10 bg-white text-ink hover:-translate-y-px hover:border-black/25 hover:shadow-sm",
        variant === "ghost" && "h-9 px-3 text-[13px] font-medium text-ink-2 hover:text-ink",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Pill radio group: the chosen option fills with the nori gradient. */
export function Segmented<T extends string>({ value, onChange, options, label }: {
  value: T | undefined; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-full bg-stone/70 p-1">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cx(
              "h-8 rounded-full px-4 text-[13px] font-medium transition-all duration-200",
              on ? "bg-gradient-to-br from-[#0f2a21] to-[#1d5a45] text-white shadow-[0_6px_14px_-6px_rgba(15,42,33,0.7)]" : "text-ink-2 hover:bg-white hover:text-ink",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const YES_NO = [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] as const;

export function YesNo({ value, onChange, label }: { value: boolean | null | undefined; onChange: (v: boolean) => void; label: string }) {
  return (
    <Segmented
      label={label}
      value={value == null ? undefined : value ? "yes" : "no"}
      onChange={(v) => onChange(v === "yes")}
      options={[...YES_NO]}
    />
  );
}

/** Question row: the question on the left, the control on the right; stacks on phones. */
export function Question({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-x-6 gap-y-2.5 border-b border-black/[0.06] py-4 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <div className="text-[14.5px] font-medium text-ink">{label}</div>
        {hint && <div className="mt-0.5 text-meta text-muted">{hint}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Free-text chips: type, press Enter or comma to add; x removes. */
export function ChipInput({ value, onChange, placeholder, label }: {
  value: string[]; onChange: (v: string[]) => void; placeholder?: string; label: string;
}) {
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const items = raw.split(",").map((s) => s.trim()).filter(Boolean).filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()));
    if (items.length) onChange([...value, ...items]);
    setDraft("");
  };
  return (
    <div className={cx(inputClass, "flex min-h-[44px] flex-wrap items-center gap-1.5 py-[6px] focus-within:border-emerald-500 focus-within:ring-4 focus-within:ring-emerald-500/15")}>
      {value.map((v) => (
        <span key={v} className="ob-pop inline-flex h-7 items-center gap-1 rounded-full bg-gradient-to-br from-emerald-100 to-teal-50 pl-3 pr-1 text-[13px] font-medium text-emerald-900 ring-1 ring-inset ring-emerald-600/15">
          {v}
          <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))} className="flex h-5 w-5 items-center justify-center rounded-full text-emerald-800/70 transition-colors hover:bg-emerald-200 hover:text-emerald-950">
            <Icon icon={X} size={13} />
          </button>
        </span>
      ))}
      <input
        aria-label={label}
        value={draft}
        onChange={(e) => (e.target.value.endsWith(",") ? add(e.target.value) : setDraft(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); add(draft); }
          if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => draft.trim() && add(draft)}
        placeholder={value.length ? "" : placeholder}
        className="min-w-[8rem] flex-1 bg-transparent py-[2px] text-body-sm text-ink placeholder:text-faint focus:outline-none"
      />
    </div>
  );
}

/** Multi-select from fixed options, rendered as toggle pills. */
export function PillSelect({ value, onChange, options }: { value: string[]; onChange: (v: string[]) => void; options: string[] }) {
  const all = [...options, ...value.filter((v) => !options.includes(v))];
  return (
    <div className="flex flex-wrap gap-2">
      {all.map((o) => {
        const on = value.includes(o);
        return (
          <button
            key={o}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== o) : [...value, o])}
            className={cx(
              "inline-flex h-9 items-center gap-1.5 rounded-full border px-4 text-[13px] font-medium transition-all duration-200",
              on
                ? "border-transparent bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-[0_8px_18px_-8px_rgba(16,185,129,0.8)]"
                : "border-black/10 bg-white text-ink-2 hover:-translate-y-px hover:border-emerald-500/50 hover:text-ink",
            )}
          >
            <Icon icon={on ? Check : Plus} size={14} />
            {o}
          </button>
        );
      })}
    </div>
  );
}

const GROUP_HUE = ["from-emerald-400 to-teal-500", "from-sky-400 to-indigo-500", "from-amber-300 to-orange-500", "from-rose-400 to-pink-500"];

/** Lettered group heading inside a step. */
export function Group({ letter, title, children, note }: { letter: string; title: string; children: ReactNode; note?: ReactNode }) {
  const hue = GROUP_HUE[Math.max(0, letter.charCodeAt(0) - 65) % GROUP_HUE.length];
  return (
    <section className="border-t border-black/[0.06] pt-6 first:border-t-0 first:pt-0">
      <div className="flex items-center gap-3">
        <span className={cx("flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br text-[12px] font-bold text-white shadow-sm", hue)}>{letter}</span>
        <h3 className="font-display text-[17px] font-medium tracking-[-0.02em] text-ink">{title}</h3>
      </div>
      {note && <p className="mt-2 text-meta text-muted">{note}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Back / Continue row under every step. `status` sits between them (errors, "Saved"). */
export function StepFooter({ busy, onBack, label = "Continue", status, extra, disabled }: {
  busy?: boolean; onBack?: () => void; label?: string; status?: ReactNode; extra?: ReactNode; disabled?: boolean;
}) {
  return (
    <div className="mt-9 flex flex-wrap items-center gap-3 border-t border-black/[0.06] pt-6">
      {onBack && <ObButton variant="soft" onClick={onBack} disabled={busy}><Icon icon={ArrowLeft} />Back</ObButton>}
      <div className="min-w-0 flex-1">{status}</div>
      {extra}
      <ObButton type="submit" variant="primary" disabled={busy || disabled}>
        {busy ? <><Icon icon={LoaderCircle} className="animate-spin" />Saving</> : <>{label}<Icon icon={ArrowRight} className="transition-transform duration-150 group-hover:translate-x-0.5" /></>}
      </ObButton>
    </div>
  );
}
