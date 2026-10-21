import {
  pgTable, uuid, text, timestamp, jsonb, integer, boolean, real, uniqueIndex, index,
} from "drizzle-orm/pg-core";

/** Node types in the career graph. Everything the agent knows about a person is a node. */
export const NODE_TYPES = [
  "role", "company", "project", "skill", "tool", "metric", "education",
  "certification", "person", "publication", "award", "language",
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

/** Edge types. Direction reads src -> type -> dst. */
export const EDGE_TYPES = [
  "worked_at",   // role -> company
  "part_of",     // project -> role
  "used",        // role|project -> skill|tool
  "achieved",    // role|project -> metric
  "reported_to", // role -> person
  "studied_at",  // education -> company (institution)
  "earned",      // role|education -> certification|award
  "related_to",  // skill -> skill
] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  /** scrypt$N$r$p$salt$hash (base64); null for users created by DEFAULT_USER_EMAIL or channels. */
  passwordHash: text("password_hash"),
  /** Set when the user proves they own the address (verification link). Null = not verified yet. */
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** One-time links for password reset and email verification. Only the sha256 of the token is stored. */
export const authTokens = pgTable("auth_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"reset" | "verify">().notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("auth_tokens_user_idx").on(t.userId, t.kind)]);

/** Login sessions. The cookie carries a random token; only its sha256 is stored. */
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("sessions_user_idx").on(t.userId)]);

export const profiles = pgTable("profiles", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  fullName: text("full_name"),
  email: text("email"),
  phone: text("phone"),
  linkedin: text("linkedin"),
  website: text("website"),
  location: text("location"),
  city: text("city"),
  state: text("state"),
  /** ISO code ("US") or a country name. */
  country: text("country"),
  github: text("github"),
  pronouns: text("pronouns"),
  /** WorkAuth: { authorizedUS, needsSponsorship, status: citizen|permanent_resident|visa|other, visaType, notes }. Kept loose for older rows. */
  workAuth: jsonb("work_auth").$type<Record<string, unknown>>().default({}).notNull(),
  willingToRelocate: boolean("willing_to_relocate"),
  /** "remote" | "hybrid" | "onsite" | "flexible" */
  remotePreference: text("remote_preference"),
  heardAbout: text("heard_about"),
  salaryExpectation: jsonb("salary_expectation").$type<SalaryExpectation | null>(),
  earliestStartDate: text("earliest_start_date"),
  noticePeriodWeeks: integer("notice_period_weeks"),
  eeo: jsonb("eeo").$type<Eeo>().default({ gender: "decline", race: "decline", veteran: "decline", disability: "decline" }).notNull(),
  securityClearance: text("security_clearance"),
  over18: boolean("over18"),
  onboarding: jsonb("onboarding").$type<OnboardingState>().default({ step: "resume" }).notNull(),
  /** Target titles, locations, salary floor, remote preference, company stage. */
  preferences: jsonb("preferences").$type<Preferences>().default({}).notNull(),
  rawResumeText: text("raw_resume_text"),
  resumeAutoApprove: boolean("resume_auto_approve").default(false).notNull(),
  reviewBeforeSubmit: boolean("review_before_submit").default(true).notNull(),
  /** off: every form waits for the person. safe: Nori approves a filled form itself only when every Autopilot check passes. written: the same, and short free-text answers Nori wrote are allowed. */
  autopilot: text("autopilot").$type<"off" | "safe" | "written">().default("off").notNull(),
  /** Daily cap for auto-apply mode. 0 disables auto apply. */
  autoApplyDailyCap: integer("auto_apply_daily_cap").default(0).notNull(),
  autoApplyMinScore: real("auto_apply_min_score").default(0.7).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const ONBOARDING_STEPS = ["resume", "contact", "authorization", "screening", "preferences", "integrations", "done"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
export type OnboardingState = { step: OnboardingStep; completedAt?: string | null };

export const WORK_AUTH_STATUSES = ["citizen", "permanent_resident", "visa", "other"] as const;
export type WorkAuth = {
  authorizedUS?: boolean;
  needsSponsorship?: boolean;
  status?: (typeof WORK_AUTH_STATUSES)[number];
  visaType?: string;
  notes?: string;
};

export type SalaryExpectation = { amount: number; currency?: string; period?: "year" | "month" | "hour" };
/** Each value is free text from the wizard ("decline" means prefer not to say). */
export type Eeo = { gender: string; race: string; veteran: string; disability: string };

export type Preferences = {
  titles?: string[];
  locations?: string[];
  remote?: "only" | "ok" | "no";
  salaryMin?: number;
  stages?: string[];
  excludeCompanies?: string[];
  /** Companies the agent polls every tick: "greenhouse:vercel" (ats:token) or a company name already in the companies table. */
  followCompanies?: string[];
  /** Autonomous agent bookkeeping: ISO timestamps (lastTickAt, lastDiscoverAt) and local dates (lastBriefOn, lastWeeklyOn). */
  agent?: { lastTickAt?: string; lastDiscoverAt?: string; lastBriefOn?: string; lastWeeklyOn?: string };
  /** Auto-apply lanes. When absent or empty, titles/locations/remote above act as one implicit lane. */
  lanes?: Lane[];
};

/** One search lane: the agent queues jobs whose title and place fit, at or above minScore. */
export type Lane = {
  id: string;
  name: string;
  titles: string[];
  locations: string[];
  remote: "only" | "ok" | "no";
  /** 0..1 */
  minScore: number;
  enabled: boolean;
};

export const graphNodes = pgTable("graph_nodes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").$type<NodeType>().notNull(),
  label: text("label").notNull(),
  /** Type-specific fields. role: {title, employmentType}; metric: {value, unit, statement}; skill: {level, years} */
  props: jsonb("props").$type<Record<string, unknown>>().default({}).notNull(),
  startDate: text("start_date"),
  endDate: text("end_date"),
  /** Provenance: resume, chat, linkedin, manual. */
  source: text("source"),
  sourceQuote: text("source_quote"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("graph_nodes_user_type_idx").on(t.userId, t.type),
  index("graph_nodes_label_idx").on(t.userId, t.label),
]);

export const graphEdges = pgTable("graph_edges", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  src: uuid("src").notNull().references(() => graphNodes.id, { onDelete: "cascade" }),
  dst: uuid("dst").notNull().references(() => graphNodes.id, { onDelete: "cascade" }),
  type: text("type").$type<EdgeType>().notNull(),
  props: jsonb("props").$type<Record<string, unknown>>().default({}).notNull(),
}, (t) => [
  uniqueIndex("graph_edges_unique").on(t.src, t.dst, t.type),
  index("graph_edges_dst_idx").on(t.dst),
]);

export const ATS_TYPES = ["greenhouse", "lever", "ashby", "smartrecruiters", "workday", "web", "manual"] as const;
export type AtsType = (typeof ATS_TYPES)[number];

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  domain: text("domain"),
  atsType: text("ats_type").$type<AtsType>().notNull(),
  /** Tenant identifier for the poller: greenhouse board token, lever slug, ashby name. */
  atsToken: text("ats_token").notNull(),
  /** Parallel Task API research output with citations. */
  research: jsonb("research").$type<CompanyResearch | null>(),
  researchedAt: timestamp("researched_at", { withTimezone: true }),
  lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("companies_ats_unique").on(t.atsType, t.atsToken)]);

export type CompanyResearch = {
  summary: string;
  stage?: string;
  funding?: string;
  headcount?: string;
  recentNews?: string[];
  interviewProcess?: string;
  sponsorshipSignals?: string;
  citations: { field: string; url: string; title?: string | null }[];
};

export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
  companyName: text("company_name").notNull(),
  atsType: text("ats_type").$type<AtsType>().notNull(),
  externalId: text("external_id").notNull(),
  title: text("title").notNull(),
  location: text("location"),
  remote: boolean("remote").default(false).notNull(),
  descriptionText: text("description_text").notNull(),
  descriptionHtml: text("description_html"),
  applyUrl: text("apply_url").notNull(),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  requirements: jsonb("requirements").$type<JobRequirements | null>(),
  /** How we found it: feed, parallel_search, pasted, extension. */
  discoveredVia: text("discovered_via").default("feed").notNull(),
  raw: jsonb("raw").$type<unknown>(),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("jobs_ats_external_unique").on(t.atsType, t.externalId),
  index("jobs_posted_idx").on(t.postedAt),
]);

export type JobRequirements = {
  skills: { name: string; required: boolean }[];
  seniority: "intern" | "junior" | "mid" | "senior" | "staff" | "lead" | "executive" | "unknown";
  roleFamily: string;
  yearsMin: number | null;
  mustHaves: string[];
  niceToHaves: string[];
  disqualifiers: string[];
  keywords: string[];
  summary: string;
  /**
   * How these were extracted. "heuristic" = instant rule-based pass used to score many jobs cheaply; the model
   * re-extracts the ones that matter (see ensureRequirements `upgrade`). "fallback" = the model failed, rules were kept.
   * Absent on rows written before this field existed (treated as final).
   */
  via?: "llm" | "heuristic" | "fallback";
};

export const matches = pgTable("matches", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  score: real("score").notNull(),
  explanation: jsonb("explanation").$type<MatchExplanation>().notNull(),
  computedAt: timestamp("computed_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("matches_user_job_unique").on(t.userId, t.jobId)]);

export type MatchExplanation = {
  matched: { requirement: string; nodeId: string; label: string; required: boolean }[];
  missing: { requirement: string; required: boolean }[];
  reasons: string[];
};

export const APPLICATION_STATUSES = [
  "queued", "tailoring", "resume_review", "filling", "form_review",
  "submitting", "awaiting_code", "submitted", "needs_user", "failed", "skipped",
  // post-submission tracker stages, moved by inbox classification
  "viewed", "replied", "interview", "offer", "rejected",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const applications = pgTable("applications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  status: text("status").$type<ApplicationStatus>().default("queued").notNull(),
  resumeId: uuid("resume_id"),
  /** Answers the driver will type, keyed by field label. Editable during form_review. */
  answers: jsonb("answers").$type<Record<string, string>>().default({}).notNull(),
  /** Questions the driver could not answer. */
  pendingQuestions: jsonb("pending_questions").$type<PendingQuestion[]>().default([]).notNull(),
  /** What was actually submitted: fields, files, screenshot path, confirmation text. */
  receipt: jsonb("receipt").$type<Receipt | null>(),
  error: text("error"),
  attempts: integer("attempts").default(0).notNull(),
  /** Set by the user (or auto-approve settings) to let the runner pass a review gate. */
  resumeApprovedAt: timestamp("resume_approved_at", { withTimezone: true }),
  formApprovedAt: timestamp("form_approved_at", { withTimezone: true }),
  /** True when Autopilot (not the person) approved the filled form. */
  autopilot: boolean("autopilot").default(false).notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  /** Row number in the user's Google Sheet tracker, if synced through Composio. */
  sheetRow: integer("sheet_row"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("applications_user_job_unique").on(t.userId, t.jobId),
  index("applications_status_idx").on(t.status),
]);

export type PendingQuestion = { label: string; type: string; options?: string[]; required: boolean };
export type Receipt = {
  fields: { label: string; value: string; kind: string }[];
  files: string[];
  screenshotPath?: string;
  confirmationText?: string;
  /** Answers the agent generated for custom questions this run; recomputed on retry. */
  autoAnswers?: Record<string, string>;
  submittedVia: string;
  dryRun: boolean;
  durationMs: number;
};

export const resumes = pgTable("resumes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  applicationId: uuid("application_id").references(() => applications.id, { onDelete: "cascade" }),
  version: integer("version").default(1).notNull(),
  content: jsonb("content").$type<ResumeContent>().notNull(),
  /** bulletId -> graph node ids the bullet was derived from. */
  provenance: jsonb("provenance").$type<Record<string, string[]>>().default({}).notNull(),
  /** Diff against the baseline resume: bulletId -> original text. */
  changes: jsonb("changes").$type<ResumeChange[]>().default([]).notNull(),
  html: text("html"),
  pdfPath: text("pdf_path"),
  pages: integer("pages"),
  atsScore: integer("ats_score"),
  atsChecks: jsonb("ats_checks").$type<AtsCheck[]>().default([]).notNull(),
  keywordCoverage: real("keyword_coverage"),
  /** Template and theme the PDF was rendered with. */
  templateId: text("template_id").default("classic").notNull(),
  theme: jsonb("theme").$type<Record<string, unknown>>().default({}).notNull(),
  /** True when the user changed this version by hand after tailoring. */
  edited: boolean("edited").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** The user's own resumes: a library of documents they edit, style and export. Tailored resumes (above) are generated from these. */
export const resumeDocs = pgTable("resume_docs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  source: text("source").$type<"graph" | "upload" | "manual" | "copy" | "text">().default("manual").notNull(),
  content: jsonb("content").$type<ResumeContent>().notNull(),
  templateId: text("template_id").default("classic").notNull(),
  theme: jsonb("theme").$type<Record<string, unknown>>().default({}).notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
  version: integer("version").default(1).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("resume_docs_user_idx").on(t.userId, t.updatedAt)]);

/** Snapshot of a resume document before each change, so any earlier state can be restored. */
export const resumeDocVersions = pgTable("resume_doc_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  docId: uuid("doc_id").notNull().references(() => resumeDocs.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  name: text("name").notNull(),
  content: jsonb("content").$type<ResumeContent>().notNull(),
  templateId: text("template_id").default("classic").notNull(),
  theme: jsonb("theme").$type<Record<string, unknown>>().default({}).notNull(),
  label: text("label"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("resume_doc_versions_doc_idx").on(t.docId, t.version)]);

export type ResumeBullet = { id: string; text: string; nodeIds: string[]; /** Written or changed by the user rather than derived from the graph. */ edited?: boolean };
export type ResumeChange = { bulletId: string; before: string; after: string; reason: string; nodeIds: string[] };
export type ResumeContent = {
  name: string;
  contact: { email?: string; phone?: string; location?: string; linkedin?: string; website?: string; github?: string };
  summary?: string;
  experience: {
    title: string; company: string; location?: string; start?: string; end?: string;
    bullets: ResumeBullet[];
  }[];
  education: { school: string; degree?: string; field?: string; start?: string; end?: string }[];
  skills: { group: string; items: string[] }[];
  projects?: { name: string; bullets: ResumeBullet[] }[];
  certifications?: string[];
  /** Extra sections such as Awards or Languages. Titles come from a fixed safe list so ATS parsers recognise them. */
  extras?: { title: string; items: string[] }[];
  /** Section order and visibility. Unset means the default order with every non-empty section shown. */
  layout?: { sections?: string[]; hidden?: string[] };
};
export type AtsCheck = { id: string; label: string; pass: boolean; detail?: string; weight: number };

export const runEvents = pgTable("run_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  applicationId: uuid("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  ts: timestamp("ts", { withTimezone: true }).defaultNow().notNull(),
  level: text("level").$type<"info" | "warn" | "error">().default("info").notNull(),
  step: text("step").notNull(),
  message: text("message").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().default({}).notNull(),
}, (t) => [index("run_events_app_idx").on(t.applicationId, t.ts)]);

/** Inbound mail routed to the user's job search: recruiter replies, verification codes, rejections. */
export const inboxMessages = pgTable("inbox_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  applicationId: uuid("application_id").references(() => applications.id, { onDelete: "set null" }),
  externalId: text("external_id"),
  fromAddress: text("from_address").notNull(),
  subject: text("subject").notNull(),
  bodyText: text("body_text").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  /** verification_code | recruiter_reply | interview | rejection | offer | confirmation | other */
  kind: text("kind").$type<InboxKind>().default("other").notNull(),
  /** Extracted OTP, if kind is verification_code. */
  code: text("code"),
  draftReply: text("draft_reply"),
  read: boolean("read").default(false).notNull(),
  source: text("source").default("composio_gmail").notNull(),
}, (t) => [uniqueIndex("inbox_external_unique").on(t.userId, t.externalId), index("inbox_user_idx").on(t.userId, t.receivedAt)]);

export type InboxKind = "verification_code" | "recruiter_reply" | "interview" | "rejection" | "offer" | "confirmation" | "other";

/** Messaging channels a user has linked: slack, telegram, whatsapp, email. */
export const channels = pgTable("channels", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"slack" | "telegram" | "whatsapp" | "email" | "console" | "web">().notNull(),
  /** Channel-specific address: slack channel id, telegram chat id, phone number, email. */
  address: text("address").notNull(),
  meta: jsonb("meta").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("channels_kind_address_unique").on(t.kind, t.address)]);

/** Conversation memory per channel so the agent can hold context ("apply to #2"). */
export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  role: text("role").$type<"user" | "assistant" | "system">().notNull(),
  content: text("content").notNull(),
  /** Structured state the assistant set, e.g. { lastShortlist: [jobId...] } */
  state: jsonb("state").$type<Record<string, unknown>>().default({}).notNull(),
  ts: timestamp("ts", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("conversations_channel_idx").on(t.channelId, t.ts)]);

export const AGENT_EVENT_KINDS = [
  "discovered", "scored", "queued", "skipped", "review_requested", "approved", "submitted", "needs_user", "reply", "interview", "brief",
] as const;
export type AgentEventKind = (typeof AGENT_EVENT_KINDS)[number];

/** What the autonomous agent did, newest first on the dashboard timeline. */
export const agentEvents = pgTable("agent_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  ts: timestamp("ts", { withTimezone: true }).defaultNow().notNull(),
  kind: text("kind").$type<AgentEventKind>().notNull(),
  applicationId: uuid("application_id").references(() => applications.id, { onDelete: "cascade" }),
  jobId: uuid("job_id").references(() => jobs.id, { onDelete: "cascade" }),
  message: text("message").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().default({}).notNull(),
}, (t) => [index("agent_events_user_idx").on(t.userId, t.ts), index("agent_events_job_idx").on(t.userId, t.jobId)]);

export const LLM_PROVIDERS = ["cline", "openai-compatible", "anthropic", "ollama"] as const;
export type LlmProviderId = (typeof LLM_PROVIDERS)[number];

/** Per-user model credentials ("Sign in with Cline", own key). The key is AES-256-GCM encrypted at rest. */
export const userCredentials = pgTable("user_credentials", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").$type<LlmProviderId>().notNull(),
  /** v1:iv:tag:ciphertext (base64). Null for keyless endpoints such as a local Ollama. */
  encryptedKey: text("encrypted_key"),
  baseUrl: text("base_url"),
  qualityModel: text("quality_model"),
  bulkModel: text("bulk_model"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const schema = {
  users, sessions, profiles, graphNodes, graphEdges, companies, jobs, matches, applications,
  resumes, resumeDocs, resumeDocVersions, runEvents, inboxMessages, channels, conversations, agentEvents, userCredentials,
};
