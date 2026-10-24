/**
 * Shared contracts every package codes against. Owned by the coordinator; do not edit from
 * package work without saying so in your report. DB row types live in ./db/schema.ts.
 */
import type { AtsType, JobRequirements, ResumeContent, ResumeChange, AtsCheck, Receipt, PendingQuestion, InboxKind, CompanyResearch } from "./db/schema.js";

// ---------- discovery ----------
export type NormalizedJob = {
  atsType: AtsType;
  externalId: string;        // stable id within the ATS (greenhouse job id, lever posting id, ashby id, or a URL hash for web)
  companyName: string;
  companyToken?: string;     // tenant slug used by the feed (board token etc.)
  title: string;
  location?: string;
  remote: boolean;
  descriptionText: string;   // plain text, html stripped
  descriptionHtml?: string;
  applyUrl: string;
  postedAt?: Date;
  discoveredVia: "feed" | "parallel_search" | "exa_search" | "exa_social" | "pasted" | "extension";
  raw?: unknown;
};

export interface FeedSource {
  atsType: AtsType;
  /** Fetch every open job for one tenant. Must not throw on 404; return []. */
  fetchJobs(token: string): Promise<NormalizedJob[]>;
  /** Parse a job URL for this ATS into { token, externalId } or null. */
  parseUrl(url: string): { token: string; externalId?: string } | null;
}

export type DiscoverQuery = {
  objective: string;          // natural language: "senior frontend roles at Series B startups, remote or SF"
  titles?: string[];
  locations?: string[];
  remote?: boolean;
  maxResults?: number;
  /**
   * Wall-clock budget in ms for the whole find-and-rank call (a tool caller that gives up after 30 s sets about 22 000).
   * Searches and page reads that have not finished are dropped, and jobs not yet scored come back unscored.
   */
  budgetMs?: number;
};

// ---------- career graph ----------
export type GraphNodeRef = { id: string; type: string; label: string; props: Record<string, unknown>; startDate?: string | null; endDate?: string | null };
export type GraphEdgeRef = { id: string; src: string; dst: string; type: string };
export type Graph = { nodes: GraphNodeRef[]; edges: GraphEdgeRef[] };

/** One piece of evidence pulled from the graph for a requirement. */
export type Evidence = {
  requirement: string;
  nodeId: string;
  nodeType: string;
  label: string;
  /** Human-readable sentence the tailor can rewrite from, e.g. the metric statement or bullet text. */
  text: string;
  /** Context nodes: the role and company this evidence belongs to. */
  roleId?: string;
  roleLabel?: string;
  companyLabel?: string;
  score: number;
  /**
   * Not evidence of anything: a placeholder for a soft skill ("strong communication") the graph says nothing about, so it
   * is not listed as a gap. Scoring treats the requirement as neutral, and tailoring and answers never use it as support.
   */
  inferred?: boolean;
};

export type IngestResult = { nodesCreated: number; edgesCreated: number; usedLLM: boolean; profilePatch: Partial<{ fullName: string; email: string; phone: string; linkedin: string; location: string; website: string }> };

// ---------- matching ----------
export type MatchResult = {
  score: number; // 0..1
  matched: { requirement: string; nodeId: string; label: string; required: boolean }[];
  missing: { requirement: string; required: boolean }[];
  reasons: string[];
};

// ---------- tailoring ----------
export type TailorInput = {
  baseline: ResumeContent;       // resume built from the graph (untailored)
  requirements: JobRequirements;
  evidence: Evidence[];
  jobTitle: string;
  companyName: string;
};
export type TailorResult = {
  content: ResumeContent;
  changes: ResumeChange[];
  provenance: Record<string, string[]>;
  keywordCoverage: number; // 0..1 of requirements.keywords present
  usedLLM: boolean;
};
export type RenderResult = { html: string; pdfPath: string; pages: number; atsScore: number; atsChecks: AtsCheck[] };

// ---------- apply drivers ----------
export type ApplicantProfile = {
  fullName: string; firstName: string; lastName: string; email: string; phone?: string;
  linkedin?: string; website?: string; github?: string; location?: string;
  /** ISO country of residence when known, e.g. "US". */
  country?: string;
  workAuth: { authorizedUS?: boolean; needsSponsorship?: boolean; notes?: string };
};
export type FormField = {
  label: string; kind: "text" | "email" | "tel" | "textarea" | "select" | "radio" | "checkbox" | "file" | "unknown";
  required: boolean; options?: string[]; selector: string;
};
export type DriverContext = {
  applyUrl: string;
  profile: ApplicantProfile;
  resumePdfPath: string;
  /** Pre-decided answers keyed by field label (from the user's review or the answer generator). */
  answers: Record<string, string>;
  /** Called when the form asks something not in answers. Return null to leave it pending. */
  answerQuestion: (field: FormField, jobContext: string) => Promise<string | null>;
  /** Called when the site emails a verification code. Resolves with the code or null on timeout. */
  waitForCode: (hint: string) => Promise<string | null>;
  /** When true the driver fills everything, screenshots, and never clicks submit. */
  dryRun: boolean;
  onEvent: (step: string, message: string, data?: Record<string, unknown>) => void;
  artifactsDir: string;
  headless?: boolean;
};
export type DriverResult =
  | { outcome: "submitted"; receipt: Receipt }
  | { outcome: "filled"; receipt: Receipt; fields: FormField[] }     // dryRun or review gate: form filled, not submitted
  | { outcome: "needs_user"; pending: PendingQuestion[]; receipt: Receipt }
  | { outcome: "failed"; error: string; screenshotPath?: string; /** Submit was clicked before it failed: the employer may have it. */ submitClicked?: boolean };

export interface ApplyDriver {
  atsType: AtsType;
  /** True if this driver can handle the URL. */
  supports(url: string): boolean;
  /** Open the page, discover fields, fill, and either stop (dryRun / review) or submit. */
  run(ctx: DriverContext): Promise<DriverResult>;
}

// ---------- messaging channels ----------
/** "console" is the worker stdin/stdout channel (CHANNEL_CONSOLE=1); "web" is the dashboard chat (address = userId). Neither can push. */
export type ChannelKind = "slack" | "telegram" | "whatsapp" | "email" | "console" | "web";
export type InboundMessage = { channel: ChannelKind; address: string; text: string; externalId?: string; meta?: Record<string, unknown> };
export type OutboundMessage = { text: string; attachments?: { path: string; filename: string }[] };
export interface ChannelAdapter {
  kind: ChannelKind;
  available: boolean;
  send(address: string, msg: OutboundMessage): Promise<void>;
  /** Start receiving. Long-poll, webhook or socket; implementation decides. */
  listen(handler: (msg: InboundMessage) => Promise<void>): Promise<() => void>;
}

// ---------- inbox ----------
export type RawEmail = { externalId: string; from: string; subject: string; text: string; receivedAt: Date };
export type ClassifiedEmail = { kind: InboxKind; code?: string; companyGuess?: string; jobTitleGuess?: string; interviewAt?: string; draftReply?: string };

// ---------- research ----------
export type { CompanyResearch };

// ---------- runner events ----------
export type RunEvent = { applicationId: string; step: string; message: string; level?: "info" | "warn" | "error"; data?: Record<string, unknown> };
