import {
  Award, Ban, CalendarClock, CircleAlert, CircleCheck, CircleX, ClipboardCheck, Clock, Eye, FileSearch, KeyRound,
  MessageSquareReply, PenLine, Send, SkipForward, TextCursorInput, type LucideIcon,
} from "lucide-react";
import { STATUS_LABEL } from "@/lib/format";
import type { ApplicationStatus } from "@/lib/types";
import { cx } from "./cx";
import { Icon } from "./Icon";
import type { MarkTone } from "./IndexLabel";

/**
 * Status -> meaning. accent = waiting on you (orange edge); ink = sent or a good outcome (blue tint);
 * hollow = Nori is working; outline = failed (brick); muted = parked or closed. Rejected is an outcome, not an
 * error, so it stays neutral.
 */
export const STATUS_MARK: Record<ApplicationStatus, MarkTone> = {
  queued: "hollow",
  tailoring: "hollow",
  filling: "hollow",
  submitting: "hollow",
  resume_review: "accent",
  form_review: "accent",
  awaiting_code: "accent",
  needs_user: "accent",
  submitted: "ink",
  viewed: "ink",
  replied: "ink",
  interview: "ink",
  offer: "ink",
  failed: "outline",
  rejected: "muted",
  skipped: "muted",
  ghosted: "muted",
};

export const STATUS_ICON: Record<ApplicationStatus, LucideIcon> = {
  queued: Clock,
  tailoring: PenLine,
  resume_review: FileSearch,
  filling: TextCursorInput,
  form_review: ClipboardCheck,
  submitting: Send,
  awaiting_code: KeyRound,
  submitted: CircleCheck,
  needs_user: CircleAlert,
  failed: CircleX,
  skipped: SkipForward,
  viewed: Eye,
  replied: MessageSquareReply,
  interview: CalendarClock,
  offer: Award,
  rejected: Ban,
  ghosted: Clock,
};

const STYLE: Record<MarkTone, string> = {
  accent: "bg-attn-tint text-attn-fg ring-1 ring-inset ring-attn",
  ink: "bg-accent-tint text-accent-fg",
  hollow: "bg-sunken text-ink",
  outline: "bg-danger-tint text-danger-fg",
  muted: "bg-sunken text-muted",
};

/**
 * Stage pill: icon plus word. Working stages show a dot that breathes; skipped is dashed; an offer is the one
 * solid fill.
 */
export function StatusPill({ status, className }: { status: ApplicationStatus | string; className?: string }) {
  const s = status as ApplicationStatus;
  const mark = STATUS_MARK[s] ?? "muted";
  const working = s === "tailoring" || s === "filling" || s === "submitting";
  return (
    <span
      className={cx(
        "inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full pl-2 pr-2.5 text-[12px] font-medium",
        s === "offer" ? "bg-accent text-on-ink" : STYLE[mark],
        s === "skipped" && "bg-transparent ring-1 ring-inset ring-control [border-style:dashed]",
        className,
      )}
    >
      <Icon icon={STATUS_ICON[s] ?? Clock} size={14} className={cx(working && "animate-pulse")} />
      {STATUS_LABEL[s] ?? status}
    </span>
  );
}
