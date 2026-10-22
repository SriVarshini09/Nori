import { z } from "zod";
import { WORK_AUTH_STATUSES, type OnboardingStep, type profiles } from "@jobgraph/core";

type ProfileRow = typeof profiles.$inferSelect;
type ProfilePatch = Partial<typeof profiles.$inferInsert>;

const str = (max = 500) => z.string().trim().max(max).nullable().optional();

const contact = {
  fullName: str(200), email: str(320), phone: str(50), location: str(200),
  city: str(100), state: str(100), country: str(100),
  linkedin: str(), github: str(), website: str(), pronouns: str(50),
};

const workAuth = z.object({
  authorizedUS: z.boolean().nullable(), needsSponsorship: z.boolean().nullable(),
  status: z.enum(WORK_AUTH_STATUSES).nullable(), visaType: z.string().trim().max(100).nullable(), notes: z.string().max(1000).nullable(),
}).partial();

const authorization = {
  workAuth: workAuth.optional(),
  willingToRelocate: z.boolean().nullable().optional(),
  /** Suggested values: remote | hybrid | onsite | flexible. */
  remotePreference: str(50),
};

const screening = {
  heardAbout: str(200),
  // An object with no amount means "no preference" (older clients send { amount: null }); store it as null.
  salaryExpectation: z.preprocess(
    (v) => (v && typeof v === "object" && (v as { amount?: unknown }).amount == null ? null : v),
    z.object({ amount: z.number().nonnegative(), currency: z.string().trim().max(10).optional(), period: z.enum(["year", "month", "hour"]).optional() }).nullable().optional(),
  ),
  earliestStartDate: str(100),
  noticePeriodWeeks: z.number().int().min(0).max(104).nullable().optional(),
  eeo: z.object({ gender: z.string().max(100), race: z.string().max(100), veteran: z.string().max(100), disability: z.string().max(100) }).partial().optional(),
  securityClearance: str(100),
  over18: z.boolean().nullable().optional(),
};

const settings = {
  resumeAutoApprove: z.boolean().optional(),
  reviewBeforeSubmit: z.boolean().optional(),
  autopilot: z.enum(["off", "safe", "written"]).optional(),
  autoApplyDailyCap: z.number().int().min(0).max(100).optional(),
  autoApplyMinScore: z.number().min(0).max(1).optional(),
};

const shortList = z.array(z.string().max(200)).max(100);
const preferenceKeys = {
  titles: shortList.optional(), locations: shortList.optional(), remote: z.enum(["only", "ok", "no"]).optional(),
  salaryMin: z.number().optional(), stages: shortList.optional(), excludeCompanies: z.array(z.string().max(200)).max(1000).optional(),
};
// Known keys are typed; extra keys are kept, never stripped.
// agent (bookkeeping) and lanes are kept by the server; a client echoing them back, as the wizard does, must not be refused.
const preferences = z.object({ ...preferenceKeys, country: z.string().optional(), github: z.string().optional(), agent: z.unknown().optional(), lanes: z.unknown().optional() })
  .catchall(z.union([z.string().max(2000), z.number(), z.boolean(), shortList, z.null()]));

/** PUT /api/profile: every profile column plus nested preferences and settings. */
export const ProfileBody = z.object({
  name: z.string().max(200).optional(),
  ...contact, ...authorization, ...screening, ...settings,
  preferences: preferences.optional(),
  settings: z.object(settings).optional(),
});

/** PUT /api/onboarding data, validated per step. */
export const STEP_SCHEMAS: Record<OnboardingStep, z.ZodType<Record<string, unknown>>> = {
  resume: z.object({ text: z.string().min(20, "Paste the full resume text").optional() }),
  contact: z.object(contact),
  authorization: z.object(authorization),
  screening: z.object(screening),
  preferences: z.object({ ...preferenceKeys, ...settings, preferences: preferences.optional() }),
  integrations: z.object({}),
  done: z.object({}),
};

const COLUMNS = [
  "fullName", "email", "phone", "location", "city", "state", "country", "linkedin", "github", "website", "pronouns",
  "willingToRelocate", "remotePreference", "heardAbout", "salaryExpectation", "earliestStartDate", "noticePeriodWeeks",
  "securityClearance", "over18", "resumeAutoApprove", "reviewBeforeSubmit", "autopilot", "autoApplyDailyCap", "autoApplyMinScore",
] as const;

const compact = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));

/** Merge validated data into a profile update: columns copied, workAuth/eeo/preferences merged, location derived. */
export function buildProfilePatch(current: ProfileRow, data: Record<string, unknown>): ProfilePatch {
  const d = { ...data, ...((data.settings as Record<string, unknown> | undefined) ?? {}) };
  const set: Record<string, unknown> = {};
  for (const k of COLUMNS) if (d[k] !== undefined) set[k] = d[k];
  // Autopilot stands in for "ask every time", so it needs that review step to exist: turning it on turns review back on.
  if (set.autopilot && set.autopilot !== "off") set.reviewBeforeSubmit = true;
  if (d.workAuth) set.workAuth = compact({ ...current.workAuth, ...(d.workAuth as Record<string, unknown>) });
  if (d.eeo) set.eeo = { ...current.eeo, ...compact(d.eeo as Record<string, unknown>) };
  const flatPrefs = Object.fromEntries(Object.keys(preferenceKeys).filter((k) => d[k] !== undefined).map((k) => [k, d[k]]));
  if (d.preferences || Object.keys(flatPrefs).length) {
    const { agent: _agent, lanes: _lanes, ...incoming } = (d.preferences as Record<string, unknown> | undefined) ?? {}; // server-owned: never taken from the client
    set.preferences = { ...current.preferences, ...incoming, ...flatPrefs };
  }
  // City/state/country from the wizard keep the free-text location (used by older heuristics) in sync.
  if (d.location === undefined && (d.city !== undefined || d.state !== undefined || d.country !== undefined)) {
    const pickV = (k: "city" | "state" | "country") => (d[k] !== undefined ? d[k] : current[k]) as string | null;
    const loc = [pickV("city"), pickV("state"), pickV("country")].filter((v) => v && v.trim()).join(", ");
    set.location = loc || null;
  }
  return { ...set, updatedAt: new Date() } as ProfilePatch;
}
