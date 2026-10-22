/**
 * Typed client for the jobgraph HTTP API (ARCHITECTURE.md "HTTP API" and "Auth and onboarding").
 * In the browser every call is same-origin (`/api/...`, proxied to apps/api by next.config rewrites) so the
 * httpOnly `jg_session` cookie rides along. On the server, calls go straight to the API with the incoming
 * request's cookie header forwarded. Only when NEXT_PUBLIC_USE_MOCK is exactly "1" is every call answered from
 * ./mock instead of the network. Live is the default, so a deploy that forgets the variable never ships the demo.
 */
import type {
  AgentActivity, AgentStatus, AgentTickSummary, Application, ApplicationDetail, ApplicationListItem, Channel, Company, DiscoverQuery, Graph,
  InboxMessage, Integration, IngestResult, Job, JobDetail, JobWithMatch, Lane, Me, ModelPresetsInfo, ModelProvider, ModelSettings, ModelSettingsInput, ModelTestResult, OnboardingState, OnboardingStepId,
  BoardAts, CompanyList, DetectedCompany, Preferences, Profile, Resume, ResumeContent, ResumeDoc, ResumeDocSummary, ResumeFormat, ResumePreview, ResumeTemplates, ResumeTheme, ResumeVersion, SessionInfo, TrackerStats, User,
} from "./types";

export const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === "1";
/** Server-side base URL of apps/api. The browser never uses it. */
const SERVER_API_URL = (process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/+$/, "");

/**
 * `message` is what a person should read ("Cannot reach the server. Try again in a moment."), so every component that shows
 * `error.message` is already safe. The technical text (method, path, status, internal address) lives in `technical`, for logs.
 */
export class ApiError extends Error {
  technical: string;
  constructor(public status: number, technical: string, public detail: string = technical) {
    super(detail);
    this.technical = technical;
    this.name = "ApiError";
  }
}

/** A server message that names an environment variable or a vendor is for the operator, not the person using Nori. */
export function friendly(msg: string): string {
  if (/COMPOSIO|through Composio/i.test(msg)) return "Connections (Gmail, Sheets, Slack, Calendar) are not switched on for this Nori yet. Everything else works without them.";
  if (/PARALLEL_API_KEY|Parallel search/i.test(msg)) return "Live company research is not switched on for this Nori yet.";
  if (/[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+.*(?:is not set|not configured|missing)|(?:is not set|not configured).*[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+/.test(msg)) return "This feature is not set up on this Nori yet.";
  return msg;
}

/** Base URL + headers for the current runtime: relative in the browser, absolute with forwarded cookies on the server. */
async function target(): Promise<{ base: string; headers: Record<string, string> }> {
  if (typeof window !== "undefined") return { base: "", headers: {} };
  const headers: Record<string, string> = {};
  try {
    const { headers: incoming } = await import("next/headers");
    const h = await incoming();
    const cookie = h.get("cookie");
    if (cookie) headers.cookie = cookie;
    const ua = h.get("user-agent");
    if (ua) headers["user-agent"] = ua;
  } catch { /* outside a request scope (build time) */ }
  return { base: SERVER_API_URL, headers };
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { base, headers } = await target();
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  if (body !== undefined && !isForm) headers["content-type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
      cache: "no-store",
      credentials: "include",
    });
  } catch (e) {
    const err = new ApiError(0, `Cannot reach the jobgraph API${base ? ` at ${base}` : ""}. Start apps/api or set NEXT_PUBLIC_USE_MOCK=1. (${(e as Error).message})`, "Cannot reach the server. Try again in a moment.");
    if (typeof window === "undefined") console.warn(`[web] ${err.technical}`);
    throw err;
  }
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = (await res.json()) as { error?: string; message?: string };
      msg = j.error ?? j.message ?? msg;
    } catch { /* not json */ }
    const err = new ApiError(res.status, `${method} ${path} failed (${res.status}): ${msg}`, friendly(msg));
    if (typeof window === "undefined" && res.status >= 500) console.warn(`[web] ${err.technical}`);
    throw err;
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("json")) return (await res.text()) as unknown as T;
  return (await res.json()) as T;
}

/** Mock mode has no API to set the httpOnly cookie, so a readable stand-in keeps the proxy gate working. */
function mockSession(on: boolean) {
  if (typeof document === "undefined") return;
  document.cookie = on ? "jg_session=mock; path=/; max-age=2592000; samesite=lax" : "jg_session=; path=/; max-age=0";
}

const mock = () => import("./mock");
const qs = (params: Record<string, string | number | boolean | undefined | null>) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : "";
};

/** Calls only the live API can answer (resume studio, account security). In mock mode they say so instead of faking it. */
async function live<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (USE_MOCK) throw new ApiError(0, "This needs the live API. Unset NEXT_PUBLIC_USE_MOCK and start apps/api.", "This is not available in demo mode: demo mode has no real account.");
  return request<T>(method, path, body);
}

/** Download or inline-view URLs (same-origin, cookie authenticated). */
export const resumeDocUrl = (id: string, format: ResumeFormat, inline = false) => `/api/resume-docs/${id}/download?format=${format}${inline ? "&inline=1" : ""}`;
export const resumeUrl = (id: string, format: ResumeFormat, inline = false) => `/api/resumes/${id}/download?format=${format}${inline ? "&inline=1" : ""}`;
export const templatePreviewUrl = (id: string) => `/api/resume-templates/${id}/preview`;

/** Demo mode has no server to ask, so it offers a short fixed list. */
const MOCK_PRESETS: ModelPresetsInfo = {
  strictUrls: false, localOnly: false,
  presets: [
    { id: "openai", label: "OpenAI", line: "GPT models with your OpenAI API key", provider: "openai-compatible", baseUrl: "https://api.openai.com/v1", editableUrl: false, needsKey: true, local: false, keyUrl: "https://platform.openai.com/api-keys" },
    { id: "anthropic", label: "Anthropic", line: "Claude models with your API key", provider: "anthropic", baseUrl: null, editableUrl: false, needsKey: true, local: false, keyUrl: "https://console.anthropic.com/settings/keys", defaults: { quality: "claude-opus-5-5", bulk: "claude-haiku-5-5" } },
    { id: "ollama", label: "Ollama (on this computer)", line: "Runs on your machine, no key, nothing leaves it", provider: "ollama", baseUrl: "http://localhost:11434", editableUrl: true, needsKey: false, local: true, defaults: { quality: "qwen3:14b", bulk: "qwen3:4b" } },
  ],
};

export const api = {
  // ---- auth
  session: async (): Promise<{ user: User }> => (USE_MOCK ? { user: (await mock()).me.user } : request("GET", "/api/auth/session")),
  login: async (email: string, password: string): Promise<{ user: User }> => {
    if (USE_MOCK) { mockSession(true); return { user: { ...(await mock()).me.user, email } }; }
    return request("POST", "/api/auth/login", { email, password });
  },
  signup: async (email: string, password: string, name: string): Promise<{ user: User }> => {
    if (USE_MOCK) { mockSession(true); return { user: { ...(await mock()).me.user, email, name } }; }
    return request("POST", "/api/auth/signup", { email, password, name });
  },
  logout: async (): Promise<void> => {
    if (USE_MOCK) { mockSession(false); return; }
    await request("POST", "/api/auth/logout");
  },
  /** Always resolves (the server answers the same for every address). */
  forgotPassword: async (email: string): Promise<void> => {
    if (USE_MOCK) return;
    await request("POST", "/api/auth/forgot-password", { email });
  },
  resetPassword: (token: string, password: string): Promise<{ ok: true }> => live("POST", "/api/auth/reset-password", { token, password }),
  changePassword: (current: string, next: string): Promise<{ ok: true }> => live("POST", "/api/auth/change-password", { current, next }),
  verifyEmail: (token: string): Promise<{ ok: true }> => live("POST", "/api/auth/verify-email", { token }),
  resendVerification: (): Promise<{ ok: true; verified: boolean }> => live("POST", "/api/auth/resend-verification", {}),
  sessions: (): Promise<SessionInfo[]> => live("GET", "/api/auth/sessions"),
  revokeSession: async (id: string): Promise<void> => { await live("DELETE", `/api/auth/sessions/${id}`); },
  revokeOtherSessions: (): Promise<{ revoked: number }> => live("POST", "/api/auth/sessions/revoke-others", {}),
  /** Permanently deletes the signed-in account and all its data. `confirm` must equal the account email. Mock mode is a no-op. */
  deleteAccount: async (confirm: string): Promise<void> => {
    if (USE_MOCK) return;
    await request("DELETE", "/api/auth/account", { confirm });
  },

  // ---- companies
  listCompanies: (p: { q?: string; followed?: boolean; limit?: number; offset?: number } = {}): Promise<CompanyList> =>
    live("GET", `/api/companies${qs({ q: p.q, followed: p.followed ? 1 : undefined, limit: p.limit, offset: p.offset })}`),
  followCompany: async (atsType: BoardAts, token: string): Promise<void> => { await live("POST", "/api/companies/follow", { atsType, token }); },
  unfollowCompany: async (atsType: BoardAts, token: string): Promise<void> => { await live("DELETE", "/api/companies/follow", { atsType, token }); },
  detectCompany: (url: string): Promise<DetectedCompany> => live("POST", "/api/companies/detect", { url }),

  // ---- onboarding
  onboarding: async (): Promise<OnboardingState> => (USE_MOCK ? (await mock()).onboarding : request("GET", "/api/onboarding")),
  /** Merges `data` into the profile and advances past `step`. */
  saveOnboarding: async (step: OnboardingStepId, data: Record<string, unknown>): Promise<{ profile: Profile }> =>
    USE_MOCK ? { profile: { ...(await mock()).me.profile, ...data } as Profile } : request("PUT", "/api/onboarding", { step, data }),
  uploadResumeFile: async (file: File): Promise<IngestResult> => {
    if (USE_MOCK) return (await mock()).ingest;
    const form = new FormData();
    form.append("file", file);
    return request("POST", "/api/profile/resume-file", form);
  },

  // ---- health / me / profile
  health: async (): Promise<{ ok: boolean }> => (USE_MOCK ? { ok: true } : request("GET", "/api/health")),
  me: async (): Promise<Me> => (USE_MOCK ? (await mock()).me : request("GET", "/api/me")),
  updateProfile: async (patch: Partial<Omit<Profile, "preferences">> & { preferences?: Preferences }): Promise<Profile> => {
    if (USE_MOCK) return { ...(await mock()).me.profile, ...patch, preferences: { ...(await mock()).me.profile.preferences, ...patch.preferences } } as Profile;
    return request("PUT", "/api/profile", patch);
  },
  uploadResume: async (text: string): Promise<IngestResult> =>
    USE_MOCK ? (await mock()).ingest : request("POST", "/api/profile/resume", { text }),

  // ---- graph
  graph: async (): Promise<Graph> => (USE_MOCK ? (await mock()).graph : request("GET", "/api/graph")),
  /** Downloads nodes + edges + profile (no credentials) as JSON. */
  exportGraph: async (): Promise<void> => {
    const save = (href: string) => {
      const a = document.createElement("a");
      a.href = href;
      a.download = "jobgraph-graph.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
    };
    if (!USE_MOCK) { save("/api/graph/export"); return; }
    const m = await mock();
    const url = URL.createObjectURL(new Blob([JSON.stringify({ profile: m.me.profile, ...m.graph }, null, 2)], { type: "application/json" }));
    save(url);
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },
  addFact: async (text: string): Promise<{ nodesCreated: number }> =>
    USE_MOCK ? { nodesCreated: 2 } : request("POST", "/api/graph/facts", { text }),

  // ---- jobs
  listJobs: async (p: { q?: string; limit?: number; minScore?: number; status?: string } = {}): Promise<JobWithMatch[]> =>
    USE_MOCK ? (await mock()).listJobs(p) : request("GET", `/api/jobs${qs(p)}`),
  discoverJobs: async (q: DiscoverQuery): Promise<{ added: number; jobs: JobWithMatch[] | Job[] }> =>
    USE_MOCK ? { added: 3, jobs: (await mock()).listJobs({ limit: 3 }) } : request("POST", "/api/jobs/discover", q),
  addJobByUrl: async (url: string): Promise<{ job: Job }> =>
    USE_MOCK ? { job: (await mock()).getJob("j7").job } : request("POST", "/api/jobs/url", { url }),
  pollFeed: async (atsType: string, token: string): Promise<{ added: number }> =>
    USE_MOCK ? { added: 0 } : request("POST", "/api/jobs/poll", { atsType, token }),
  getJob: async (id: string): Promise<JobDetail> => (USE_MOCK ? (await mock()).getJob(id) : request("GET", `/api/jobs/${id}`)),
  researchJob: async (id: string): Promise<{ research: NonNullable<Company["research"]> }> =>
    USE_MOCK ? { research: (await mock()).researchCompany(id)! } : request("POST", `/api/jobs/${id}/research`),

  // ---- applications
  createApplication: async (jobId: string): Promise<Application> =>
    USE_MOCK ? (await mock()).createApplication(jobId) : request("POST", "/api/applications", { jobId }),
  listApplications: async (status?: string): Promise<ApplicationListItem[]> =>
    USE_MOCK ? (await mock()).listApplications(status) : request("GET", `/api/applications${qs({ status })}`),
  getApplication: async (id: string): Promise<ApplicationDetail> =>
    USE_MOCK ? (await mock()).getApplication(id) : request("GET", `/api/applications/${id}`),
  approveResume: async (id: string): Promise<void> => {
    if (!USE_MOCK) await request("POST", `/api/applications/${id}/approve-resume`);
  },
  approveForm: async (id: string, answers?: Record<string, string>): Promise<void> => {
    if (!USE_MOCK) await request("POST", `/api/applications/${id}/approve-form`, answers ? { answers } : {});
  },
  answerQuestions: async (id: string, answers: Record<string, string>): Promise<void> => {
    if (!USE_MOCK) await request("POST", `/api/applications/${id}/answer`, { answers });
  },
  skipApplication: async (id: string): Promise<void> => {
    if (!USE_MOCK) await request("POST", `/api/applications/${id}/skip`);
  },
  retryApplication: async (id: string): Promise<void> => {
    if (!USE_MOCK) await request("POST", `/api/applications/${id}/retry`);
  },
  /** SSE endpoint (text/event-stream of RunEvent). Use with EventSource. */
  eventsUrl: (id: string) => `/api/applications/${id}/events`,

  // ---- resumes
  getResume: async (id: string): Promise<Resume> => request("GET", `/api/resumes/${id}`),
  resumePdfUrl: (id: string) => `/api/resumes/${id}.pdf`,
  resumeHtmlUrl: (id: string) => `/api/resumes/${id}.html`,

  // ---- inbox / tracker
  listInbox: async (): Promise<InboxMessage[]> => (USE_MOCK ? (await mock()).inbox : request("GET", "/api/inbox")),
  syncInbox: async (): Promise<{ imported: number }> => (USE_MOCK ? { imported: 2 } : request("POST", "/api/inbox/sync")),
  trackerStats: async (): Promise<TrackerStats> => (USE_MOCK ? (await mock()).trackerStats : request("GET", "/api/tracker/stats")),
  syncSheet: async (): Promise<{ spreadsheetUrl: string }> =>
    USE_MOCK ? { spreadsheetUrl: "https://docs.google.com/spreadsheets/d/mock-jobgraph-tracker" } : request("POST", "/api/tracker/sync-sheet"),

  // ---- agent
  agentActivity: async (limit = 50): Promise<AgentActivity[]> =>
    USE_MOCK ? (await mock()).agentActivity.slice(0, limit) : request("GET", `/api/agent/activity${qs({ limit })}`),
  agentStatus: async (): Promise<AgentStatus> => (USE_MOCK ? (await mock()).agentStatus() : request("GET", "/api/agent/status")),
  /** Runs one cycle. The server does it in the background (it can take minutes on a local model), so poll until it reports. */
  agentTick: async (): Promise<AgentTickSummary> => {
    if (USE_MOCK) return (await mock()).agentTick();
    const first = await request<AgentTickSummary | { running: true }>("POST", "/api/agent/tick?quick=1");
    if (!("running" in first)) return first;
    const deadline = Date.now() + 15 * 60_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      const st = await request<{ running: boolean; last?: AgentTickSummary; error?: string }>("GET", "/api/agent/tick");
      if (st.error) throw new ApiError(500, st.error);
      if (!st.running) {
        if (st.last) return st.last;
        throw new ApiError(500, "The run ended without a result. Check the activity feed for what it did.");
      }
    }
    throw new ApiError(0, "The run is taking longer than expected. It keeps going in the background; check the activity feed.");
  },
  agentChat: async (text: string): Promise<{ reply: string }> =>
    USE_MOCK ? (await mock()).agentReply(text) : request("POST", "/api/agent/chat", { text }),

  // ---- model settings and lanes (hackathon)
  modelSettings: async (): Promise<ModelSettings> => (USE_MOCK ? (await mock()).modelSettings() : request("GET", "/api/settings/model")),
  saveModelSettings: async (input: ModelSettingsInput): Promise<ModelSettings> =>
    USE_MOCK ? (await mock()).saveModelSettings(input) : request("PUT", "/api/settings/model", input),
  modelPresets: async (): Promise<ModelPresetsInfo> => (USE_MOCK ? MOCK_PRESETS : request("GET", "/api/settings/model/presets")),
  listModels: (input: { provider: ModelProvider; apiKey?: string; baseUrl?: string | null }): Promise<{ models: string[] }> =>
    live("POST", "/api/settings/model/models", input),
  testModel: async (): Promise<ModelTestResult> => (USE_MOCK ? (await mock()).testModel() : request("POST", "/api/settings/model/test")),
  lanes: async (): Promise<Lane[]> => (USE_MOCK ? (await mock()).lanes() : request("GET", "/api/lanes")),
  saveLanes: async (lanes: Lane[]): Promise<Lane[]> => (USE_MOCK ? (await mock()).saveLanes(lanes) : request("PUT", "/api/lanes", lanes)),

  // ---- resume studio (live API only)
  resumeTemplates: async (): Promise<ResumeTemplates> => live("GET", "/api/resume-templates"),
  resumeDocs: async (): Promise<ResumeDocSummary[]> => live("GET", "/api/resume-docs"),
  resumeDoc: async (id: string): Promise<ResumeDoc> => live("GET", `/api/resume-docs/${id}`),
  createResumeDoc: async (b: { from: "graph" | "blank" | "copy" | "content"; name?: string; copyOf?: string; content?: ResumeContent; templateId?: string; theme?: Partial<ResumeTheme>; makeDefault?: boolean }): Promise<ResumeDoc> =>
    live("POST", "/api/resume-docs", b),
  updateResumeDoc: async (id: string, b: { name?: string; content?: ResumeContent; templateId?: string; theme?: Partial<ResumeTheme>; expectedVersion?: number }): Promise<ResumeDoc> =>
    live("PUT", `/api/resume-docs/${id}`, b),
  deleteResumeDoc: async (id: string): Promise<void> => { await live("DELETE", `/api/resume-docs/${id}`); },
  setDefaultResumeDoc: async (id: string): Promise<ResumeDoc> => live("POST", `/api/resume-docs/${id}/default`),
  duplicateResumeDoc: async (id: string, name?: string): Promise<ResumeDoc> => live("POST", `/api/resume-docs/${id}/duplicate`, { name }),
  refreshResumeDoc: async (id: string): Promise<ResumeDoc> => live("POST", `/api/resume-docs/${id}/refresh-from-graph`),
  resumeDocVersions: async (id: string): Promise<ResumeVersion[]> => live("GET", `/api/resume-docs/${id}/versions`),
  restoreResumeDocVersion: async (id: string, version: number): Promise<ResumeDoc> => live("POST", `/api/resume-docs/${id}/versions/${version}/restore`),
  previewResume: async (content: ResumeContent, templateId: string, theme: Partial<ResumeTheme>): Promise<ResumePreview> =>
    live("POST", "/api/resume/preview", { content, templateId, theme }),
  editApplicationResume: async (applicationId: string, b: { content?: ResumeContent; templateId?: string; theme?: Partial<ResumeTheme> }): Promise<{ resume: Resume; application: Application }> =>
    live("PUT", `/api/applications/${applicationId}/resume`, b),

  // ---- channels / integrations
  listChannels: async (): Promise<Channel[]> => (USE_MOCK ? (await mock()).channels : request("GET", "/api/channels")),
  listIntegrations: async (): Promise<Integration[]> => (USE_MOCK ? (await mock()).integrations : request("GET", "/api/integrations")),
  connectIntegration: async (toolkit: string): Promise<{ redirectUrl: string }> =>
    USE_MOCK ? { redirectUrl: `https://connect.composio.dev/mock/${toolkit}` } : request("POST", `/api/integrations/${toolkit}/connect`),
};

/** Screenshot files are written under data/artifacts/<id>/; the API is assumed to expose them at /api/artifacts/<rest>. */
export function artifactUrl(path: string): string {
  if (/^(https?:|data:)/.test(path)) return path;
  const rest = path.replace(/\\/g, "/").replace(/^.*artifacts\//, "");
  return `/api/artifacts/${rest}`;
}
