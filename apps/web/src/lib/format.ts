import type { ApplicationStatus, InboxKind } from "./types";

export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "-";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "-";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Accepts 0..1 or 0..100 and returns a whole percentage. */
export function pct(score: number | null | undefined): number {
  if (score == null) return 0;
  return Math.round(score <= 1 ? score * 100 : score);
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour12: false });
}

export const STATUS_LABEL: Record<ApplicationStatus, string> = {
  queued: "Queued",
  tailoring: "Tailoring",
  resume_review: "Resume review",
  filling: "Filling",
  form_review: "Form review",
  submitting: "Submitting",
  awaiting_code: "Awaiting code",
  submitted: "Submitted",
  needs_user: "Needs you",
  failed: "Failed",
  skipped: "Skipped",
  viewed: "Viewed",
  replied: "Replied",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  ghosted: "Ghosted",
};

export type Tone = "slate" | "blue" | "amber" | "green" | "red" | "teal" | "orange";

export const STATUS_TONE: Record<ApplicationStatus, Tone> = {
  queued: "slate",
  tailoring: "blue",
  resume_review: "amber",
  filling: "blue",
  form_review: "amber",
  submitting: "blue",
  awaiting_code: "amber",
  submitted: "green",
  needs_user: "orange",
  failed: "red",
  skipped: "slate",
  viewed: "teal",
  replied: "teal",
  interview: "green",
  offer: "green",
  rejected: "red",
  ghosted: "slate",
};

/** Dashboard / list tabs. */
export const IN_FLIGHT: ApplicationStatus[] = ["queued", "tailoring", "filling", "submitting"];
export const NEEDS_YOU: ApplicationStatus[] = ["needs_user", "resume_review", "form_review", "awaiting_code"];
export const SUBMITTED: ApplicationStatus[] = ["submitted", "viewed", "replied", "interview", "offer", "rejected", "ghosted"];
export const FAILED: ApplicationStatus[] = ["failed"];

export const INBOX_LABEL: Record<InboxKind, string> = {
  verification_code: "Verification code",
  recruiter_reply: "Recruiter reply",
  interview: "Interview",
  rejection: "Rejection",
  offer: "Offer",
  confirmation: "Confirmation",
  other: "Other",
};

export const INBOX_TONE: Record<InboxKind, Tone> = {
  verification_code: "blue",
  recruiter_reply: "teal",
  interview: "green",
  rejection: "red",
  offer: "green",
  confirmation: "slate",
  other: "slate",
};

export const NODE_GROUPS: { type: string; label: string }[] = [
  { type: "role", label: "Roles" },
  { type: "company", label: "Companies" },
  { type: "project", label: "Projects" },
  { type: "skill", label: "Skills" },
  { type: "tool", label: "Tools" },
  { type: "metric", label: "Metrics" },
  { type: "education", label: "Education" },
  { type: "certification", label: "Certifications" },
  { type: "award", label: "Awards" },
  { type: "publication", label: "Publications" },
  { type: "language", label: "Languages" },
  { type: "person", label: "People" },
];
