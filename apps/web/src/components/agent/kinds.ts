import {
  Calendar, Ban, Check, FileCheck, Gauge, HelpCircle, ListPlus, Reply, Search, Send, Sun, type LucideIcon,
} from "lucide-react";
import type { AgentActivity, AgentActivityKind } from "@/lib/types";

export const KIND_ICON: Record<AgentActivityKind, LucideIcon> = {
  discovered: Search,
  scored: Gauge,
  queued: ListPlus,
  skipped: Ban,
  review_requested: FileCheck,
  approved: Check,
  submitted: Send,
  needs_user: HelpCircle,
  reply: Reply,
  interview: Calendar,
  brief: Sun,
};

export const KIND_LABEL: Record<AgentActivityKind, string> = {
  discovered: "Discovered",
  scored: "Scored",
  queued: "Queued",
  skipped: "Skipped",
  review_requested: "Review",
  approved: "Approved",
  submitted: "Submitted",
  needs_user: "Needs you",
  reply: "Reply",
  interview: "Interview",
  brief: "Brief",
};

/** "20 min ago" style, one unit, for the agent feed. */
export function ago(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "never";
  const m = Math.round(Math.max(0, now - t) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function inMin(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "-";
  const m = Math.round((new Date(iso).getTime() - now) / 60_000);
  if (m <= 0) return "now";
  if (m < 60) return `${m} min`;
  return `${Math.round(m / 60)} h`;
}

/** One line per entry: chat messages carry reply instructions and links the timeline does not need. */
export function headline(a: AgentActivity): string {
  if (a.kind === "needs_user") {
    const n = (a.message.match(/has (\d+) questions?/) ?? [])[1];
    const who = a.message.split(" has ")[0];
    return n ? `${who}: ${n} question${n === "1" ? "" : "s"} need you` : a.message.split(/[.\n]/)[0];
  }
  if (a.kind === "review_requested") return a.message.split(/\. Reply|\. Open|\n/)[0].replace(/\.$/, "");
  return a.message.split("\n")[0];
}
