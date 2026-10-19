import { and, eq, gte } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { agentEvents, type Lane, type Preferences } from "../db/schema.js";
import { canonicalSkill, findSkills } from "../graph/skills.js";

export type { Lane } from "../db/schema.js";

/**
 * Lanes: named slices of the search ("Senior Frontend, SF or remote, 60%+"). The agent tick queues jobs that fit
 * any enabled lane, best match first, from one shared daily cap. Pure helpers here; the tick lives in loop.ts.
 */
export const DEFAULT_LANE_ID = "default";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "lane";

const Score = z.number().min(0).max(100).transform((n) => (n > 1 ? n / 100 : n));
export const LaneInput = z.object({
  id: z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/, "id: letters, digits, - and _ only").optional(),
  name: z.string().trim().min(1, "name is required").max(80),
  titles: z.array(z.string().trim().min(1).max(120)).max(25).default([]),
  locations: z.array(z.string().trim().min(1).max(120)).max(25).default([]),
  remote: z.enum(["only", "ok", "no"]).default("ok"),
  /** 0..1, or a percentage (60 -> 0.6). */
  minScore: Score.default(0.6),
  enabled: z.boolean().default(true),
});
export const LanesInput = z.array(LaneInput).max(20);

/** Validate and fill ids (slug of the name, made unique). */
export function normalizeLanes(input: z.input<typeof LanesInput>): Lane[] {
  const parsed = LanesInput.parse(input);
  const used = new Set<string>();
  return parsed.map((l) => {
    let id = l.id ?? slug(l.name);
    for (let i = 2; used.has(id); i++) id = `${l.id ?? slug(l.name)}-${i}`;
    used.add(id);
    const dedupe = (xs: string[]) => [...new Map(xs.map((x) => [x.toLowerCase(), x])).values()];
    return { id, name: l.name, titles: dedupe(l.titles), locations: dedupe(l.locations), remote: l.remote, minScore: l.minScore, enabled: l.enabled };
  });
}

type LaneProfile = { preferences?: Preferences | null; autoApplyMinScore?: number | null };

/** Without stored lanes, preferences.titles act as one lane (location left to the disqualifier gate, as before lanes). */
export function implicitLane(profile: LaneProfile): Lane {
  const prefs = profile.preferences ?? {};
  return {
    id: DEFAULT_LANE_ID, name: (prefs.titles ?? []).filter(Boolean).join(", ") || "All matches",
    titles: (prefs.titles ?? []).filter(Boolean), locations: [], remote: "ok",
    minScore: profile.autoApplyMinScore ?? 0.7, enabled: true,
  };
}

export const storedLanes = (profile: LaneProfile): Lane[] => (Array.isArray(profile.preferences?.lanes) ? profile.preferences!.lanes! : []);

/** Stored lanes, or the implicit one when there are none. */
export function effectiveLanes(profile: LaneProfile): (Lane & { implicit?: boolean })[] {
  const lanes = storedLanes(profile);
  return lanes.length ? lanes : [{ ...implicitLane(profile), implicit: true }];
}

// ---------- matching ----------

const ABBREV: [RegExp, string][] = [
  [/\bsr\.?(?=\s|$)/g, "senior"], [/\bjr\.?(?=\s|$)/g, "junior"], [/\bsnr\b/g, "senior"],
  [/\b(?:eng|engr)\b\.?/g, "engineer"], [/\bswe\b/g, "software engineer"], [/\bsde\b/g, "software engineer"],
  [/\bdev\b/g, "developer"], [/\bmgr\b/g, "manager"], [/\bml\b/g, "machine learning"], [/\bai\b/g, "ai"],
  [/\bfront[\s-]+end\b/g, "frontend"], [/\bback[\s-]+end\b/g, "backend"], [/\bfull[\s-]+stack\b/g, "fullstack"],
  [/\bengineering\b/g, "engineer"], [/\bengineers\b/g, "engineer"], [/\bdevelopers\b/g, "developer"],
  [/\bsite reliability\b/g, "sre"], [/\bpm\b/g, "product manager"],
];
const STOP = new Set(["and", "or", "of", "the", "a", "an", "for", "in", "at", "to", "with", "&", "-", "/", "i", "ii", "iii", "iv"]);

export function normTitle(s: string): string {
  let t = ` ${s.toLowerCase().replace(/[(),|:;]+/g, " ").replace(/\s+/g, " ").trim()} `;
  for (const [re, rep] of ABBREV) t = t.replace(re, rep);
  return t.replace(/[^a-z0-9+#.\s]/g, " ").replace(/\s+/g, " ").trim();
}
const tokens = (s: string) => normTitle(s).split(" ").map((w) => w.replace(/\.$/, "")).filter((w) => w && !STOP.has(w));

/** Job title fits a lane title: substring (case-insensitive, abbreviations expanded), every word present, or the same canonical skills. */
export function titleMatches(jobTitle: string, laneTitle: string): boolean {
  const j = normTitle(jobTitle), l = normTitle(laneTitle);
  if (!l) return true;
  if (j.includes(l)) return true;
  const jt = new Set(tokens(jobTitle));
  const jobSkills = new Set(findSkills(jobTitle));
  const lt = tokens(laneTitle);
  if (!lt.length) return true;
  return lt.every((w) => {
    if (jt.has(w)) return true;
    const sk = canonicalSkill(w);
    return Boolean(sk && jobSkills.has(sk));
  });
}

const PLACE_ALIASES: Record<string, string[]> = {
  "san francisco": ["sf", "bay area", "san francisco bay area"], "new york": ["nyc", "new york city", "ny"],
  "los angeles": ["la"], "washington": ["dc", "washington dc", "d.c."], "united states": ["us", "usa", "u.s."],
  "united kingdom": ["uk", "u.k."],
};
function placeVariants(p: string): string[] {
  const k = p.trim().toLowerCase();
  const out = new Set([k]);
  for (const [canon, alts] of Object.entries(PLACE_ALIASES)) {
    if (k === canon || alts.includes(k) || k.startsWith(`${canon},`)) { out.add(canon); alts.filter((a) => a.length > 2).forEach((a) => out.add(a)); }
  }
  return [...out];
}

export const isRemoteJob = (job: { remote?: boolean | null; location?: string | null }) => Boolean(job.remote) || /\bremote\b/i.test(job.location ?? "");

/** Job location fits any lane location (case-insensitive substring either way, common aliases). */
export function locationMatches(jobLocation: string | null | undefined, laneLocations: string[]): boolean {
  if (!laneLocations.length) return true;
  const loc = (jobLocation ?? "").toLowerCase();
  if (!loc) return false;
  return laneLocations.some((l) => placeVariants(l).some((v) => {
    if (v.length <= 3) return new RegExp(`(^|[^a-z])${v.replace(/\./g, "\\.")}([^a-z]|$)`).test(loc);
    return loc.includes(v) || (loc.length > 3 && v.includes(loc));
  }));
}

export type LaneJob = { title: string; location?: string | null; remote?: boolean | null };

/** Does the job fit this lane's titles and place (ignores minScore and enabled)? */
export function jobFitsLane(job: LaneJob, lane: Pick<Lane, "titles" | "locations" | "remote">): boolean {
  const titles = lane.titles.filter((t) => t.trim());
  if (titles.length && !titles.some((t) => titleMatches(job.title, t))) return false;
  const remote = isRemoteJob(job);
  switch (lane.remote) {
    case "only": return remote;
    // Not remote: an on-site/hybrid job in one of the lane's places (a remote job only when its location names one).
    case "no": return (!remote || lane.locations.length > 0) && locationMatches(job.location, lane.locations);
    default: return remote || locationMatches(job.location, lane.locations);
  }
}

/** Every enabled lane the job fits, in lane order. */
export function lanesFor<L extends Lane>(job: LaneJob, lanes: L[]): L[] {
  return lanes.filter((l) => l.enabled !== false && jobFitsLane(job, l));
}

/** The first enabled lane the job fits, or null. With `score`, only lanes whose minScore it reaches. */
export function laneFor<L extends Lane>(job: LaneJob, lanes: L[], score?: number): L | null {
  return lanesFor(job, lanes).find((l) => score === undefined || score >= l.minScore) ?? null;
}

/** Applications the agent queued today per lane id (from agent_events.data.laneId). */
export async function queuedTodayByLane(db: Db, userId: string, since: Date): Promise<Map<string, number>> {
  const rows = await db.select({ data: agentEvents.data }).from(agentEvents)
    .where(and(eq(agentEvents.userId, userId), eq(agentEvents.kind, "queued"), gte(agentEvents.ts, since)));
  const out = new Map<string, number>();
  for (const r of rows) {
    const id = (r.data as { laneId?: string }).laneId;
    if (id) out.set(id, (out.get(id) ?? 0) + 1);
  }
  return out;
}
