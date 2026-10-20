/**
 * Wire types for the jobgraph HTTP API (see ARCHITECTURE.md). They mirror
 * packages/core/src/db/schema.ts row shapes with timestamps serialised as ISO strings.
 */

export const APPLICATION_STATUSES = [
  "queued", "tailoring", "resume_review", "filling", "form_review",
  "submitting", "awaiting_code", "submitted", "needs_user", "failed", "skipped",
  "viewed", "replied", "interview", "offer", "rejected",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export type InboxKind =
  | "verification_code" | "recruiter_reply" | "interview" | "rejection" | "offer" | "confirmation" | "other";

export type User = { id: string; email: string; name: string | null; emailVerifiedAt?: string | null; createdAt: string };

export type SessionInfo = { id: string; current: boolean; device: string; createdAt: string; expiresAt: string };

export type Preferences = {
  titles?: string[];
  locations?: string[];
  remote?: "only" | "ok" | "no";
  salaryMin?: number;
  stages?: string[];
  excludeCompanies?: string[];
};

export type WorkStatus = "citizen" | "permanent_resident" | "visa" | "other";
export type WorkAuth = {
  authorizedUS?: boolean;
  needsSponsorship?: boolean;
  status?: WorkStatus;
  visaType?: string;
  notes?: string;
} & Record<string, unknown>;

export type SalaryExpectation = { amount?: number | null; currency?: string; period?: "year" | "month" | "hour" };
/** "decline" = Prefer not to say (the default for every EEO answer). */
export type Eeo = { gender?: string; race?: string; veteran?: string; disability?: string };

export const ONBOARDING_STEPS = ["resume", "contact", "authorization", "screening", "preferences", "integrations"] as const;
export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number];
export type OnboardingStep = OnboardingStepId | "done";

export type Profile = {
  userId: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  linkedin: string | null;
  website: string | null;
  location: string | null;
  workAuth: WorkAuth;
  preferences: Preferences;
  rawResumeText?: string | null;
  resumeAutoApprove: boolean;
  reviewBeforeSubmit: boolean;
  autoApplyDailyCap: number;
  autoApplyMinScore: number;
  updatedAt: string;
  // ---- onboarding fields (migration 0002); optional so older API builds still type-check
  city?: string | null;
  state?: string | null;
  country?: string | null;
  github?: string | null;
  pronouns?: string | null;
  willingToRelocate?: boolean | null;
  remotePreference?: string | null;
  heardAbout?: string | null;
  salaryExpectation?: SalaryExpectation | null;
  earliestStartDate?: string | null;
  noticePeriodWeeks?: number | null;
  eeo?: Eeo | null;
  securityClearance?: string | null;
  over18?: boolean | null;
  onboarding?: { step: OnboardingStep; completedAt?: string | null } | null;
};

/** GET /api/onboarding */
export type OnboardingState = { step: OnboardingStep; profile: Profile };

export type Me = { user: User; profile: Profile };

// ---------- graph ----------
export type GraphNode = {
  id: string;
  type: string;
  label: string;
  props: Record<string, unknown>;
  startDate?: string | null;
  endDate?: string | null;
  source?: string | null;
  sourceQuote?: string | null;
};
export type GraphEdge = { id: string; src: string; dst: string; type: string };
export type Graph = { nodes: GraphNode[]; edges: GraphEdge[] };

export type IngestResult = {
  nodesCreated: number;
  edgesCreated: number;
  usedLLM: boolean;
  profilePatch: Partial<{ fullName: string; email: string; phone: string; linkedin: string; github: string; location: string; website: string }>;
  /** Not in the contract yet; when absent the wizard ranks GET /api/graph by degree instead. */
  nodes?: GraphNode[];
};

// ---------- jobs ----------
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

export type Company = {
  id: string;
  name: string;
  domain: string | null;
  atsType: string;
  atsToken: string;
  research: CompanyResearch | null;
  researchedAt: string | null;
};

export type JobRequirements = {
  skills: { name: string; required: boolean }[];
  seniority: string;
  roleFamily: string;
  yearsMin: number | null;
  mustHaves: string[];
  niceToHaves: string[];
  disqualifiers: string[];
  keywords: string[];
  summary: string;
};

export type Job = {
  id: string;
  companyId: string | null;
  companyName: string;
  atsType: string;
  externalId: string;
  title: string;
  location: string | null;
  remote: boolean;
  descriptionText: string;
  descriptionHtml?: string | null;
  applyUrl: string;
  postedAt: string | null;
  requirements: JobRequirements | null;
  discoveredVia: string;
  firstSeenAt: string;
  lastSeenAt: string;
  closedAt: string | null;
};

export type MatchExplanation = {
  matched: { requirement: string; nodeId: string; label: string; required: boolean }[];
  missing: { requirement: string; required: boolean }[];
  reasons: string[];
};

/** score is 0..1 */
export type Match = { jobId: string; score: number; explanation: MatchExplanation; computedAt: string };

export type JobWithMatch = {
  job: Job;
  match: Match | null;
  /** Present when the API annotates the job with the user's application state. */
  applicationStatus?: ApplicationStatus | null;
};

export type DiscoverQuery = {
  objective: string;
  titles?: string[];
  locations?: string[];
  remote?: boolean;
  maxResults?: number;
};

export type JobDetail = { job: Job; match: Match | null; company: Company | null };

// ---------- applications ----------
export type PendingQuestion = { label: string; type: string; options?: string[]; required: boolean };

export type Receipt = {
  fields: { label: string; value: string; kind: string }[];
  files: string[];
  screenshotPath?: string;
  confirmationText?: string;
  submittedVia: string;
  dryRun: boolean;
  durationMs: number;
};

export type Application = {
  id: string;
  userId?: string;
  jobId: string;
  status: ApplicationStatus;
  resumeId: string | null;
  answers: Record<string, string>;
  pendingQuestions: PendingQuestion[];
  receipt: Receipt | null;
  error: string | null;
  attempts: number;
  resumeApprovedAt: string | null;
  formApprovedAt: string | null;
  submittedAt: string | null;
  sheetRow?: number | null;
  createdAt: string;
  updatedAt: string;
};

export type ResumeBullet = { id: string; text: string; nodeIds: string[]; /** Written or changed by the user. */ edited?: boolean };
export type ResumeChange = { bulletId: string; before: string; after: string; reason: string; nodeIds: string[] };
export type AtsCheck = { id: string; label: string; pass: boolean; detail?: string; weight: number };
export type ResumeContent = {
  name: string;
  contact: { email?: string; phone?: string; location?: string; linkedin?: string; website?: string; github?: string };
  summary?: string;
  experience: { title: string; company: string; location?: string; start?: string; end?: string; bullets: ResumeBullet[] }[];
  education: { school: string; degree?: string; field?: string; start?: string; end?: string }[];
  skills: { group: string; items: string[] }[];
  projects?: { name: string; bullets: ResumeBullet[] }[];
  certifications?: string[];
  extras?: { title: string; items: string[] }[];
  layout?: { sections?: string[]; hidden?: string[] };
};

export type ResumeTheme = {
  font: string; headingFont?: string; accent: string; fontSize: number; lineHeight: number; margin: number;
  pageSize: "letter" | "a4"; headerAlign: "left" | "center"; pages: number;
};
export type ResumeTemplateInfo = { id: string; name: string; description: string; bestFor: string; atsSafe: boolean; columns: 1 | 2; theme: ResumeTheme };
export type ResumeTemplates = { templates: ResumeTemplateInfo[]; fonts: { id: string; label: string; kind: "sans" | "serif" | "mono" }[]; pageSizes: { id: string; label: string }[] };
export type ResumeDocSummary = {
  id: string; name: string; source: "graph" | "upload" | "manual" | "copy" | "text"; templateId: string; theme: ResumeTheme; isDefault: boolean;
  version: number; createdAt: string; updatedAt: string; headline: string; stats: { roles: number; bullets: number; words: number };
};
export type ResumeDoc = Omit<ResumeDocSummary, "stats" | "headline"> & { content: ResumeContent };
export type ResumeVersion = { id: string; version: number; name: string; templateId: string; label: string | null; createdAt: string; headline: string; stats: { roles: number; bullets: number; words: number } };
export type ResumePreview = {
  html: string; pages: number; targetPages: number; atsScore: number; atsChecks: AtsCheck[]; density: string; steps: string[]; theme: ResumeTheme; templateId: string;
};
export type ResumeFormat = "pdf" | "docx" | "txt" | "json" | "html";

export type Resume = {
  id: string;
  applicationId: string | null;
  version: number;
  content: ResumeContent;
  provenance: Record<string, string[]>;
  changes: ResumeChange[];
  html?: string | null;
  pages: number | null;
  atsScore: number | null;
  atsChecks: AtsCheck[];
  keywordCoverage: number | null;
  templateId?: string;
  theme?: Partial<ResumeTheme>;
  edited?: boolean;
  createdAt: string;
};

export type RunEventRow = {
  id?: string;
  applicationId?: string;
  ts: string;
  level: "info" | "warn" | "error";
  step: string;
  message: string;
  data?: Record<string, unknown>;
};

/** What the SSE endpoint emits (one JSON RunEvent per message). */
export type RunEvent = {
  applicationId: string;
  step: string;
  message: string;
  level?: "info" | "warn" | "error";
  data?: Record<string, unknown>;
  ts?: string;
};

export type ApplicationListItem = { application: Application; job: Job; resume?: Resume | null };

export type ApplicationDetail = {
  application: Application;
  job: Job;
  resume: Resume | null;
  events: RunEventRow[];
  company: Company | null;
};

// ---------- inbox / tracker / channels / integrations ----------
export type InboxMessage = {
  id: string;
  applicationId: string | null;
  externalId?: string | null;
  fromAddress: string;
  subject: string;
  bodyText: string;
  receivedAt: string;
  kind: InboxKind;
  code: string | null;
  draftReply: string | null;
  read: boolean;
  source: string;
};

export type TrackerStats = {
  byStatus: Record<string, number>;
  thisWeek: { applied?: number; replied?: number; interview?: number; hoursSaved?: number } & Record<string, number | undefined>;
};

export type Channel = {
  id: string;
  kind: "slack" | "telegram" | "whatsapp" | "email";
  address: string;
  meta?: Record<string, unknown>;
  createdAt: string;
};

export type Integration = { toolkit: string; connected: boolean; error?: string };

// ---- agent (GET /api/agent/activity, /api/agent/status, POST /api/agent/tick, /api/agent/chat)
export type AgentActivityKind =
  | "discovered" | "scored" | "queued" | "skipped" | "review_requested" | "approved"
  | "submitted" | "needs_user" | "reply" | "interview" | "brief";

export type AgentActivity = {
  id: string;
  ts: string;
  kind: AgentActivityKind;
  applicationId?: string | null;
  jobId?: string | null;
  message: string;
  data: { job?: { title: string; companyName: string }; reasons?: string[]; count?: number; dryRun?: boolean };
};

export type AgentAwaitingReview = {
  applicationId: string;
  title: string;
  companyName: string;
  atsScore: number | null;
  changes: number;
};

export type AgentStatus = {
  lastTickAt: string | null;
  nextTickAt: string | null;
  dailyCap: number;
  usedToday: number;
  minScore: number;
  autoApprove: boolean;
  reviewBeforeSubmit: boolean;
  /** False: the server runs in dry-run mode, forms are filled but never sent. Absent on older APIs. */
  liveSubmit?: boolean;
  channels: { kind: string; address: string }[];
  awaitingReview: AgentAwaitingReview[];
  /** Hackathon contract: how the model is resolved right now, and per-lane queue counts. Optional for older APIs. */
  mode?: ModelMode;
  lanes?: { id: string; name: string; enabled: boolean; queuedToday: number }[];
};

// ---- hackathon: model settings and lanes
export type ModelProvider = "cline" | "ollama" | "openai-compatible" | "anthropic";
export type ModelMode = "cline" | "openai-compatible" | "anthropic" | "ollama" | "heuristic";

export type ModelSettings = {
  provider: ModelProvider;
  baseUrl: string | null;
  qualityModel: string | null;
  bulkModel: string | null;
  hasKey: boolean;
  mode: ModelMode;
};

export type ModelSettingsInput = {
  provider: ModelProvider;
  apiKey?: string;
  baseUrl?: string;
  qualityModel?: string;
  bulkModel?: string;
};

export type ModelTestResult = { ok: boolean; model: string; latencyMs: number; sample: string; error?: string };

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

export type AgentTickSummary = {
  discovered: number;
  scored: number;
  queued: number;
  skipped: unknown[];
  awaitingReview: number;
  submitted: number;
  needsUser: number;
  /** Open jobs that fit an enabled lane, and one sentence on why nothing was queued. Absent on older APIs. */
  laneJobs?: number;
  note?: string;
};

export type BoardAts = "greenhouse" | "lever" | "ashby" | "smartrecruiters";
export type WatchedCompany = { id: string; name: string; atsType: BoardAts; token: string; openJobs: number; followed: boolean };
export type CompanyList = { companies: WatchedCompany[]; total: number };
export type DetectedCompany = { atsType: BoardAts; token: string; name: string; openJobs: number; added: number };
