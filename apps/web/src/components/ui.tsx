import Link from "next/link";
import { ArrowRight, ArrowUpRight, CircleAlert, CircleCheck, Info, type LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { Tone } from "@/lib/format";
import { cx } from "./cx";
import { Frame } from "./Frame";
import { Icon } from "./Icon";
import { NoriMark } from "./Logo";
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

/** A status-style pill keyed by an older tone name. Prefer <Pill mark> or <StatusPill>. */
export function Chip({ children, tone = "slate", className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return <Pill mark={TONE_MARK[tone]} className={className}>{children}</Pill>;
}

function poseForTitle(title: ReactNode): string {
  const s = typeof title === "string" ? title.toLowerCase() : "";
  if (s.includes("job") || s.includes("compan")) return "/mascot/3d/nori-3d-curious.png";
  if (s.includes("resume") || s.includes("profile")) return "/mascot/3d/nori-3d-typing.png";
  if (s.includes("graph")) return "/mascot/3d/nori-3d-wink.png";
  if (s.includes("lane") || s.includes("autopilot")) return "/mascot/3d/nori-3d-celebrate.png";
  if (s.includes("inbox") || s.includes("chat")) return "/mascot/3d/nori-3d-wave.png";
  return "/mascot/3d/nori-3d-idle.png";
}

/** Page header: Sunlit Botanical Banner Card with Nori 3D pose, title, subtitle, and actions. */
export function PageHeader({ label, title, subtitle, actions }: {
  label?: ReactNode; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; index?: string;
}) {
  const pose = poseForTitle(title);
  return (
    <div className="bento-hero mb-6 flex flex-wrap items-center justify-between gap-4 rounded-card border border-[#bce6d1] p-5 shadow-[0_10px_28px_-10px_rgba(13,117,86,0.10)] sm:mb-7 sm:px-6">
      <div className="flex min-w-0 items-center gap-4">
        <div className="hidden h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-[#bce6d1] bg-white p-1 shadow-xs sm:flex">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={pose} alt="" aria-hidden="true" className="h-full w-full object-contain" />
        </div>
        <SectionHeader as="h1" size="xl" label={label} title={title} description={subtitle} className="flex-1" />
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
    </div>
  );
}

/** Card with an optional header row: a title on the left, actions on the right. */
export function Card({ children, className, title, actions, pad = true, id, tone }: {
  children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode; pad?: boolean; index?: string; id?: string; ticks?: boolean; tone?: "attn";
}) {
  return (
    <Frame as="section" className={className} id={id} tone={tone}>
      {(title || actions) && (
        <header className="flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line/80 bg-sunken/35 px-4 py-2.5 sm:px-5 rounded-t-card">
          <h2 className="text-body-sm font-semibold text-ink">{title}</h2>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={pad ? "p-4 sm:p-5" : ""}>{children}</div>
    </Frame>
  );
}

const btnBase =
  "group inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-control text-[13px] font-semibold transition-all duration-150 ease-[var(--ease)] disabled:pointer-events-none disabled:opacity-45";
const btnVariants = {
  primary:
    "bg-[linear-gradient(180deg,#158f6a_0%,#0b664a_100%)] px-4 text-white shadow-[0_3px_10px_rgba(13,117,86,0.22),inset_0_1px_0_rgba(255,255,255,0.25)] hover:brightness-105 active:translate-y-px",
  secondary:
    "border border-control/60 bg-surface px-4 text-ink shadow-[0_1px_2px_rgba(19,28,24,0.04)] hover:bg-sunken/75 hover:border-control",
  ghost: "px-2.5 text-ink hover:bg-sunken/80",
  danger: "border border-danger bg-surface px-4 text-danger hover:bg-danger-tint",
} as const;
const btnSizes = { sm: "h-8", md: "h-10", lg: "h-12 text-[14px]" } as const;

export type ButtonStyle = { variant?: keyof typeof btnVariants; size?: keyof typeof btnSizes; arrow?: boolean; icon?: LucideIcon };

export function buttonClass({ variant = "secondary", size = "md" }: Omit<ButtonStyle, "arrow" | "icon"> = {}, extra?: string) {
  return cx(btnBase, btnVariants[variant], btnSizes[size], extra);
}

function Arrow({ external }: { external?: boolean }) {
  return <Icon icon={external ? ArrowUpRight : ArrowRight} className="transition-transform duration-150 ease-[var(--ease)] group-hover:translate-x-0.5" />;
}

/** Button. Primary = warm ink, secondary = outlined, ghost = text, danger = brick outline. Label says what it does. */
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

/** Quiet inline link in the accent colour, with an arrow. */
export function TextLink({ href, children, external, className }: { href: string; children: ReactNode; external?: boolean; className?: string }) {
  const cls = cx("group inline-flex items-center gap-1 text-meta font-medium text-accent underline-offset-4 hover:underline", className);
  const content = <>{children}<Icon icon={external ? ArrowUpRight : ArrowRight} size={14} className="transition-transform duration-150 group-hover:translate-x-0.5" /></>;
  return external
    ? <a href={href} target="_blank" rel="noreferrer" className={cls}>{content}</a>
    : <Link href={href} className={cls}>{content}</Link>;
}

export const inputClass =
  "w-full min-h-10 rounded-control border border-control bg-surface px-3 py-2 text-body-sm text-ink placeholder:text-muted transition-[border-color,box-shadow] duration-150 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:border-line disabled:bg-sunken disabled:text-ink-2";

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1.5 block text-meta font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-[12px] text-muted">{hint}</span>}
    </label>
  );
}

/** A labelled switch. The label says what "on" means. */
export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-6 py-3.5">
      <div className="min-w-0">
        <div className="text-body-sm font-medium text-ink">{label}</div>
        {hint && <div className="mt-0.5 max-w-prose text-meta text-muted">{hint}</div>}
      </div>
      <Switch checked={checked} onChange={onChange} label={label} disabled={disabled} />
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative mt-0.5 h-6 w-10 shrink-0 rounded-full border transition-colors duration-150 disabled:opacity-45",
        checked ? "border-ink bg-ink" : "border-control bg-sunken",
      )}
    >
      <span className={cx("absolute top-[3px] h-4 w-4 rounded-full transition-[left,background-color] duration-150 ease-[var(--ease)]", checked ? "left-[19px] bg-on-ink" : "left-[3px] bg-control")} />
    </button>
  );
}

/** Empty state: what is missing, why it matters, the one action that fixes it. Features Nori's 3D mascot pose. */
export function EmptyState({
  title,
  children,
  action,
  pose = "sleeping",
}: {
  title: string;
  children?: ReactNode;
  icon?: LucideIcon;
  action?: ReactNode;
  pose?: "idle" | "wave" | "celebrate" | "shy" | "typing" | "curious" | "wink" | "sleeping";
}) {
  return (
    <Frame surface="none" className="flex flex-col items-start gap-3.5 px-6 py-8 sm:flex-row sm:items-center sm:gap-5">
      <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-card border border-line bg-sunken p-1.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/mascot/3d/nori-3d-${pose}.png`}
          alt=""
          aria-hidden="true"
          className="h-full w-full object-contain"
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-title font-semibold text-ink">{title}</p>
        {children && <div className="mt-1 max-w-prose text-body-sm text-muted">{children}</div>}
        {action && <div className="mt-3">{action}</div>}
      </div>
    </Frame>
  );
}

const NOTICE_STYLE: Record<"danger" | "attn" | "good" | "neutral", string> = {
  danger: "bg-danger-tint text-danger-fg",
  attn: "bg-attn-tint text-attn-fg",
  good: "bg-accent-tint text-accent-fg",
  neutral: "bg-sunken text-ink",
};

/** One-line notice. Red: something broke. Amber/orange: you must act. Green: done. Slate: information. */
export function Notice({ tone = "slate", children, label }: { tone?: Tone; children: ReactNode; label?: string }) {
  const kind = tone === "red" ? "danger" : tone === "amber" || tone === "orange" ? "attn" : tone === "green" || tone === "teal" ? "good" : "neutral";
  const icon = kind === "danger" || kind === "attn" ? CircleAlert : kind === "good" ? CircleCheck : Info;
  return (
    <div role={kind === "danger" ? "alert" : "status"} className={cx("flex items-start gap-3 rounded-card px-4 py-3 text-body-sm", NOTICE_STYLE[kind])}>
      <Icon icon={icon} className="mt-[2px]" />
      <div className="min-w-0">
        {label && <span className="mr-1.5 font-semibold">{label}.</span>}
        {children}
      </div>
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string; index?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-meta font-medium text-muted">{label}</div>
      <div className="mt-1 text-display-lg font-semibold text-ink tnum">{value}</div>
      {hint && <div className="mt-1 text-meta text-muted">{hint}</div>}
    </div>
  );
}
