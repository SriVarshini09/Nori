import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import type { NormalizedJob } from "../contracts.js";
import type { Db } from "../db/client.js";
import { companies, jobs, type AtsType } from "../db/schema.js";
import { FEEDS } from "./registry.js";

const CHUNK = 100;

/** Resolve (or create) the companies row for a tenant; returns its id. */
async function ensureCompany(db: Db, atsType: AtsType, token: string, name: string): Promise<string> {
  const find = async () => (await db.select({ id: companies.id }).from(companies)
    .where(and(eq(companies.atsType, atsType), eq(companies.atsToken, token))).limit(1))[0]?.id;
  const existing = await find();
  if (existing) return existing;
  await db.insert(companies).values({ name, atsType, atsToken: token }).onConflictDoNothing();
  return (await find())!;
}

/**
 * Insert new jobs and refresh existing ones, keyed on (atsType, externalId).
 * Updates lastSeenAt, clears closedAt, and resets cached requirements when the description changed.
 */
export async function upsertJobs(db: Db, input: NormalizedJob[]): Promise<{ added: number; updated: number; ids: string[] }> {
  // Dedupe within the batch; the last occurrence wins.
  const byKey = new Map<string, NormalizedJob>();
  for (const j of input) byKey.set(`${j.atsType}\u0000${j.externalId}`, j);
  const list = [...byKey.values()];
  if (!list.length) return { added: 0, updated: 0, ids: [] };

  const companyIds = new Map<string, string>();
  const now = new Date();
  let added = 0, updated = 0;
  const ids: string[] = [];

  for (let i = 0; i < list.length; i += CHUNK) {
    const chunk = list.slice(i, i + CHUNK);
    const existing = await db.select({ atsType: jobs.atsType, externalId: jobs.externalId }).from(jobs)
      .where(inArray(jobs.externalId, chunk.map((j) => j.externalId)));
    const have = new Set(existing.map((e) => `${e.atsType}\u0000${e.externalId}`));

    for (const j of chunk) {
      let companyId: string | null = null;
      if (j.companyToken) {
        const ck = `${j.atsType}\u0000${j.companyToken}`;
        companyId = companyIds.get(ck) ?? null;
        if (!companyId) {
          companyId = await ensureCompany(db, j.atsType, j.companyToken, j.companyName);
          companyIds.set(ck, companyId);
        }
      }
      const values = {
        companyId,
        companyName: j.companyName,
        atsType: j.atsType,
        externalId: j.externalId,
        title: j.title,
        location: j.location ?? null,
        remote: j.remote,
        descriptionText: j.descriptionText,
        descriptionHtml: j.descriptionHtml ?? null,
        applyUrl: j.applyUrl,
        postedAt: j.postedAt ?? null,
        discoveredVia: j.discoveredVia,
        raw: j.raw ?? null,
        firstSeenAt: now,
        lastSeenAt: now,
        closedAt: null,
      };
      const [row] = await db.insert(jobs).values(values).onConflictDoUpdate({
        target: [jobs.atsType, jobs.externalId],
        set: {
          companyId: sql`coalesce(excluded.company_id, ${jobs.companyId})`,
          companyName: values.companyName,
          title: values.title,
          location: values.location,
          remote: values.remote,
          // Re-derive requirements only when the posting text changed.
          requirements: sql`CASE WHEN ${jobs.descriptionText} IS DISTINCT FROM excluded.description_text THEN NULL ELSE ${jobs.requirements} END`,
          descriptionText: values.descriptionText,
          descriptionHtml: values.descriptionHtml,
          applyUrl: values.applyUrl,
          postedAt: sql`coalesce(excluded.posted_at, ${jobs.postedAt})`,
          raw: values.raw,
          lastSeenAt: now,
          closedAt: null,
        },
      }).returning();
      ids.push(row.id);
      if (have.has(`${j.atsType}\u0000${j.externalId}`)) updated++; else added++;
    }
  }
  return { added, updated, ids };
}

/**
 * Fetch one tenant's feed and upsert it. Jobs previously seen for the tenant but missing from
 * this poll are marked closed.
 */
export async function pollTenant(db: Db, atsType: AtsType, token: string): Promise<{ added: number; updated: number; closed: number; total: number; ids: string[] }> {
  const feed = FEEDS[atsType];
  if (!feed) throw new Error(`No feed source for ats type "${atsType}"`);
  const fetched = await feed.fetchJobs(token);
  const result = await upsertJobs(db, fetched);

  const [company] = await db.select({ id: companies.id }).from(companies)
    .where(and(eq(companies.atsType, atsType), eq(companies.atsToken, token))).limit(1);
  let closed = 0;
  if (company) {
    const stillOpen = and(eq(jobs.companyId, company.id), isNull(jobs.closedAt));
    const gone = result.ids.length ? and(stillOpen, notInArray(jobs.id, result.ids)) : stillOpen;
    const rows = await db.update(jobs).set({ closedAt: new Date() }).where(gone).returning();
    closed = rows.length;
    await db.update(companies).set({ lastPolledAt: new Date() }).where(eq(companies.id, company.id));
  }
  return { ...result, closed, total: fetched.length };
}
