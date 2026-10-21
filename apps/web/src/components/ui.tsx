import Link from "next/link";
import { ArrowRight, ArrowUpRight, CircleAlert, CircleCheck, Inbox, Info, type LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { Tone } from "@/lib/format";
import { cx } from "./cx";
import { Frame } from "./Frame";
import { Icon } from "./Icon";
import { IndexLabel } from "./IndexLabel";
import { Pill, TONE_MARK } from "./Pill";
import { SectionHeader } from "./SectionHeader";

export { cx, idx } from "./cx";
export { Frame, Ticks } from "./Frame";
export { IndexLabel, Square, type MarkTone } from "./IndexLabel";
export { Pill, Tag, TONE_MARK } from "./Pill";
export { SectionHeader } from "./SectionHeader";
export { NumberedList, type NumberedItem } from "./NumberedList";
export { Accordion, SquareToggle } from "./Accordion";
export { Icon } from "./Icon";

/** Back-compat: a status-style pill keyed by legacy tone. Prefer <Pill mark> or <Tag>. */
export function Chip({ children, tone = "slate", className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return <Pill mark={TONE_MARK[tone]} className={className}>{children}</Pill>;
}

/** Page header = SectionHeader at display-xl, no top rule. */
export function PageHeader({ label, title, subtitle, actions, index }: {
  label: ReactNode; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; index?: string;
}) {
  return (
    <SectionHeader as="h1" size="xl" rule={false} index={index} label={label} title={title} description={subtitle} actions={actions} className="mb-12 sm:mb-16" />
  );
}

/** Framed card with an optional index-label header row. */
export function Card({ children, className, title, actions, pad = true, index, id, ticks = true }: {
  children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode; pad?: boolean; index?: string; id?: string; ticks?: boolean;
}) {
  return (
    <Frame as="section" className={className} id={id} ticks={ticks}>
      {(title || actions) && (
        <header className="flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line px-4 py-2.5 sm:px-5">
          <h2><IndexLabel index={index} marker tone="ink">{title}</IndexLabel></h2>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={pad ? "p-4 sm:p-5" : ""}>{children}</div>
    </Frame>
  );
}

const btnBase =
  "group inline-flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full text-[13px] font-medium tracking-[-0.005em] transition-[background-color,border-color,color,opacity] duration-150 ease-[var(--ease)] disabled:pointer-events-none disabled:opacity-40";
const btnVariants = {
  primary: "dash-btn px-5",
  secondary: "border border-black/10 bg-white px-4 text-ink shadow-sm hover:-translate-y-px hover:border-black/25",
  ghost: "px-1 text-ink underline-offset-4 decoration-line-strong hover:underline",
  danger: "border border-black/10 bg-white px-4 text-ink hover:border-rose-400 hover:text-rose-700",
} as const;
const btnSizes = { sm: "", md: "" } as const;

export type ButtonStyle = { variant?: keyof typeof btnVariants; size?: keyof typeof btnSizes; arrow?: boolean; icon?: LucideIcon };

export function buttonClass({ variant = "secondary", size = "md" }: Omit<ButtonStyle, "arrow" | "icon"> = {}, extra?: string) {
  return cx(btnBase, btnVariants[variant], btnSizes[size], extra);
}

function Arrow({ external }: { external?: boolean }) {
  return <Icon icon={external ? ArrowUpRight : ArrowRight} className="transition-transform duration-150 ease-[var(--ease)] group-hover:translate-x-0.5" />;
}

/** Pill button, 36px, 13px. Primary = ink, secondary = hairline. `icon` leads, `arrow` trails and nudges on hover. */
export function Button({ variant, size, arrow, icon, className, children, ...rest }: ButtonStyle & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={buttonClass({ variant, size }, className)} {...rest}>
      {icon && <Icon icon={icon} />}
      {children}
      {arrow && <Arrow />}
    </button>
  );
}

export function LinkButton({ href, variant, size, arrow, icon, className, children, external }: ButtonStyle & {
  href: string; className?: string; children: ReactNode; external?: boolean;
}) {
  const content = <>{icon && <Icon icon={icon} />}{children}{arrow && <Arrow external={external} />}</>;
  if (external) {
    return <a href={href} target="_blank" rel="noreferrer" className={buttonClass({ variant, size }, className)}>{content}</a>;
  }
  return <Link href={href} className={buttonClass({ variant, size }, className)}>{content}</Link>;
}

/** Quiet inline text link with an arrow. */
export function TextLink({ href, children, external, className }: { href: string; children: ReactNode; external?: boolean; className?: string }) {
  const cls = cx("group inline-flex items-center gap-1.5 text-meta font-medium text-ink underline decoration-line-strong underline-offset-4 transition-colors duration-150 hover:decoration-ink", className);
  const content = <>{children}<Icon icon={external ? ArrowUpRight : ArrowRight} className="transition-transform duration-150 group-hover:translate-x-0.5" /></>;
  return external
    ? <a href={href} target="_blank" rel="noreferrer" className={cls}>{content}</a>
    : <Link href={href} className={cls}>{content}</Link>;
}

export const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2 text-body-sm text-ink placeholder:text-faint transition-[border-color,box-shadow] duration-150 hover:border-black/25 focus:border-emerald-500 focus:outline-none focus:ring-4 focus:ring-emerald-500/15 disabled:border-transparent disabled:bg-stone/60 disabled:text-ink-2";

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1.5 block text-label font-medium uppercase text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-[12px] text-faint">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-6 py-4">
      <div className="min-w-0">
        <div className="text-body-sm font-medium text-ink">{label}</div>
        {hint && <div className="mt-0.5 max-w-prose text-meta text-muted">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cx("relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f9a72]", checked ? "border-[#0f9a72] bg-[#0f9a72]" : "border-line-strong bg-transparent")}
      >
        <span className={cx("absolute top-[3px] h-4 w-4 rounded-full shadow-sm transition-[left,background-color] duration-150 ease-[var(--ease)]", checked ? "left-[23px] bg-white" : "left-[3px] bg-faint")} />
      </button>
    </div>
  );
}

export function EmptyState({ title, children, icon = Inbox }: { title: string; children?: ReactNode; icon?: LucideIcon }) {
  return (
    <Frame surface="none" className="px-6 py-14 text-center">
      <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-line text-ink"><Icon icon={icon} /></span>
      <p className="mt-4 font-display text-title font-medium text-ink">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-body-sm text-muted">{children}</div>}
    </Frame>
  );
}

/** One-line notice: hairline box with a leading icon and an uppercase lead ("Your turn", "Error"). */
export function Notice({ tone = "slate", children, label }: { tone?: Tone; children: ReactNode; label?: string }) {
  const icon = tone === "red" || tone === "amber" || tone === "orange" ? CircleAlert : tone === "green" ? CircleCheck : Info;
  const defaultLabel = tone === "red" ? "Error" : tone === "green" ? "Done" : tone === "amber" || tone === "orange" ? "Note" : undefined;
  const l = label ?? defaultLabel;
  return (
    <div role={tone === "red" ? "alert" : "status"} className="flex items-start gap-3 border border-line bg-paper px-4 py-3 text-body-sm text-ink">
      <Icon icon={icon} className="mt-[2px]" />
      <div className="min-w-0">
        {l && <span className="mr-2 text-label font-medium uppercase text-muted">{l}</span>}
        {children}
      </div>
    </div>
  );
}

export function Stat({ label, value, hint, index }: { label: string; value: ReactNode; hint?: string; index?: string }) {
  return (
    <div className="min-w-0">
      <IndexLabel index={index}>{label}</IndexLabel>
      <div className="mt-3 font-display text-[2.5rem] font-medium leading-none tracking-[-0.04em] text-ink tnum sm:text-[3rem]">{value}</div>
      {hint && <div className="mt-2 text-meta text-muted">{hint}</div>}
    </div>
  );
}
