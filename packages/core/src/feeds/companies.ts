import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { companies, profiles, type AtsType, type Preferences } from "../db/schema.js";
import { getProfile } from "../users.js";
import { FEEDS } from "./registry.js";

export type CompanyRow = { id: string; name: string; atsType: AtsType; token: string; openJobs: number; followed: boolean };

const keyOf = (atsType: string, token: string) => `${atsType.toLowerCase()}:${token}`;

/** A contains-match pattern with LIKE's own wildcards escaped, so a search for "50%" finds "50%". */
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** The set of "ats:token" keys a user follows (plain company names in followCompanies are matched through the companies table). */
async function followedKeys(db: Db, prefs: Preferences): Promise<Set<string>> {
  const out = new Set<string>();
  for (const entry of prefs.followCompanies ?? []) {
    const m = /^(greenhouse|lever|ashby|smartrecruiters):(.+)$/i.exec(entry.trim());
    if (m) { out.add(keyOf(m[1], m[2])); continue; }
    const rows = await db.select({ atsType: companies.atsType, token: companies.atsToken }).from(companies)
      .where(sql`lower(${companies.name}) = ${entry.trim().toLowerCase()}`).limit(3);
    for (const r of rows) out.add(keyOf(r.atsType, r.token));
  }
  return out;
}

/** Watched companies with their open-job counts, searchable by name, and whether this user follows each. */
export async function listCompanies(db: Db, userId: string, opts: { q?: string; followedOnly?: boolean; limit?: number; offset?: number } = {}): Promise<{ companies: CompanyRow[]; total: number }> {
  const prefs = ((await getProfile(db, userId)).preferences ?? {}) as Preferences;
  const followed = await followedKeys(db, prefs);
  const q = opts.q?.trim();
  const rows = await db.select({
    id: companies.id, name: companies.name, atsType: companies.atsType, token: companies.atsToken,
    // Written out with an aliased table: drizzle drops the table prefix in a single-table select, which would compare jobs to itself.
    openJobs: sql<number>`(select count(*)::int from jobs oj where oj.company_id = "companies"."id" and oj.closed_at is null)`,
  }).from(companies)
    .where(q ? or(ilike(companies.name, likePattern(q)), ilike(companies.atsToken, likePattern(q))) : undefined)
    .orderBy(asc(companies.name));
  const all = rows.filter((r) => FEEDS[r.atsType]).map((r) => ({ ...r, followed: followed.has(keyOf(r.atsType, r.token)) }));
  const filtered = opts.followedOnly ? all.filter((r) => r.followed) : all;
  const offset = opts.offset ?? 0;
  return { companies: filtered.slice(offset, offset + (opts.limit ?? 60)), total: filtered.length };
}

async function writeFollow(db: Db, userId: string, mutate: (list: string[]) => string[]) {
  const profile = await getProfile(db, userId);
  const prefs = (profile.preferences ?? {}) as Preferences;
  const next = mutate([...(prefs.followCompanies ?? [])]);
  await db.update(profiles).set({ preferences: { ...prefs, followCompanies: next } }).where(eq(profiles.userId, userId));
  return next;
}

/** Follow a company the poller already knows. Returns false when it is not in the companies table. */
export async function followCompany(db: Db, userId: string, atsType: AtsType, token: string): Promise<boolean> {
  const [row] = await db.select({ id: companies.id }).from(companies).where(and(eq(companies.atsType, atsType), eq(companies.atsToken, token))).limit(1);
  if (!row) return false;
  const key = keyOf(atsType, token);
  await writeFollow(db, userId, (l) => (l.some((e) => e.toLowerCase() === key.toLowerCase()) ? l : [...l, key]));
  return true;
}

export async function unfollowCompany(db: Db, userId: string, atsType: AtsType, token: string): Promise<void> {
  const [row] = await db.select({ name: companies.name }).from(companies).where(and(eq(companies.atsType, atsType), eq(companies.atsToken, token))).limit(1);
  const key = keyOf(atsType, token).toLowerCase();
  await writeFollow(db, userId, (l) => l.filter((e) => e.toLowerCase() !== key && e.trim().toLowerCase() !== row?.name.toLowerCase()));
}

