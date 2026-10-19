import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { openTestDb } from "../db/client.js";
import { jobs, matches, users } from "../db/schema.js";
import { ingestResume } from "../graph/ingest.js";
import { computeMatchesForUser, usersWithGraph } from "./jobs.js";

const RESUME = `Jordan Rivera
San Francisco, CA | jordan@example.com

EXPERIENCE
Senior Software Engineer at Northwind Labs
Jan 2022 - Present
- Led migration of the checkout flow to React and TypeScript, cutting page load time by 45%
- Built a Node.js and PostgreSQL billing service

SKILLS
TypeScript, React, Node.js, PostgreSQL, Python
`;

const job = (n: number, extra: Partial<typeof jobs.$inferInsert> = {}) => ({
  companyName: "Acme", atsType: "web" as const, externalId: `acme-${n}`, title: `Frontend Engineer ${n}`,
  descriptionText: "Requirements:\n- React and TypeScript\n- Node.js and PostgreSQL\nNice to have:\n- GraphQL",
  applyUrl: `https://example.com/jobs/${n}`, postedAt: new Date(Date.UTC(2026, 0, n)), ...extra,
});

describe("computeMatchesForUser", () => {
  it("scores the newest open jobs lacking a match, then only stale ones", async () => {
    const db = await openTestDb();
    const [u] = await db.insert(users).values({ email: "m@example.com" }).returning();
    expect(await usersWithGraph(db)).toEqual([]);
    await ingestResume(db, u.id, RESUME);
    expect(await usersWithGraph(db)).toEqual([u.id]);
    const rows = await db.insert(jobs).values([job(1), job(2), job(3), job(4, { closedAt: new Date() })]).returning();
    const [j1, j2, j3, closed] = rows;

    const first = await computeMatchesForUser(db, u.id, { limit: 2 });
    expect(first).toMatchObject({ computed: 2, failed: 0 });
    expect(first.jobIds).toEqual([j3.id, j2.id]); // newest first, closed skipped

    const second = await computeMatchesForUser(db, u.id);
    expect(second.jobIds).toEqual([j1.id]);
    expect((await computeMatchesForUser(db, u.id)).computed).toBe(0);

    const ms = await db.select().from(matches).where(eq(matches.userId, u.id));
    expect(ms).toHaveLength(3);
    expect(ms.every((m) => m.score > 0)).toBe(true);
    expect(ms.some((m) => m.jobId === closed.id)).toBe(false);

    const refreshed = await computeMatchesForUser(db, u.id, { staleBefore: new Date(Date.now() + 1000), concurrency: 2 });
    expect(refreshed.computed).toBe(3);
    expect((await computeMatchesForUser(db, u.id, { staleBefore: new Date(Date.now() + 1000), jobIds: [j2.id] })).jobIds).toEqual([j2.id]);
    expect((await computeMatchesForUser(db, u.id, { jobIds: [] })).computed).toBe(0);
    const [m1] = await db.select().from(matches).where(and(eq(matches.userId, u.id), eq(matches.jobId, j1.id)));
    expect(m1.explanation.matched.length).toBeGreaterThan(0);
  });
});
