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
 * Status -> marker. Accent = waiting on you; ink = sent / positive; hollow = agent working;
 * ink outline = closed negative; muted = parked. Used by square markers (tracker columns).
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
  rejected: "outline",
  skipped: "muted",
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
};

/** Stone pill with the status icon. Live states pulse; states waiting on you get a hairline ink ring. */
export function StatusPill({ status }: { status: ApplicationStatus | string }) {
  const s = status as ApplicationStatus;
  const live = s === "tailoring" || s === "filling" || s === "submitting";
  const needsYou = STATUS_MARK[s] === "accent";
  return (
    <span className={cx("inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full bg-stone pl-2 pr-2.5 text-[12px] font-medium text-ink", needsYou && "ring-1 ring-inset ring-accent")}>
      <Icon icon={STATUS_ICON[s] ?? Clock} className={cx(live && "animate-pulse")} />
      {STATUS_LABEL[s] ?? status}
    </span>
  );
}
