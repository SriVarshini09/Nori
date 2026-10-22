import { mkdir, mkdtemp, readdir, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openTestDb } from "../db/client.js";
import { applications, jobs } from "../db/schema.js";
import { ensureDefaultUser } from "../users.js";
import { pruneArtifacts } from "./artifacts.js";

describe("pruneArtifacts", () => {
  it("removes old screenshots of settled applications and folders of deleted ones, and keeps everything else", async () => {
    const db = await openTestDb();
    const root = await mkdtemp(path.join(os.tmpdir(), "nori-artifacts-"));
    const user = await ensureDefaultUser(db);
    const [job] = await db.insert(jobs).values({ companyName: "Acme", atsType: "web", externalId: "a1", title: "Engineer", descriptionText: "x", applyUrl: "https://x" }).returning();
    const [job2] = await db.insert(jobs).values({ companyName: "Beta", atsType: "web", externalId: "b1", title: "Engineer", descriptionText: "x", applyUrl: "https://y" }).returning();
    const old = new Date(Date.now() - 60 * 86_400_000);
    const [done] = await db.insert(applications).values({ userId: user.id, jobId: job.id, status: "submitted" }).returning();
    const [waiting] = await db.insert(applications).values({ userId: user.id, jobId: job2.id, status: "form_review" }).returning();
    await db.update(applications).set({ updatedAt: old }).where(eq(applications.id, done.id));
    await db.update(applications).set({ updatedAt: old }).where(eq(applications.id, waiting.id));
    const orphan = "00000000-0000-4000-8000-000000000000";
    for (const id of [done.id, waiting.id, orphan]) {
      await mkdir(path.join(root, id), { recursive: true });
      for (const f of ["web-filled-1.png", "resume-v1.pdf"]) {
        const p = path.join(root, id, f);
        await writeFile(p, "x");
        await utimes(p, old, old);
      }
    }
    expect(await pruneArtifacts(db, { root, days: 30 })).toEqual({ files: 1, dirs: 1 });
    expect(await readdir(path.join(root, done.id))).toEqual(["resume-v1.pdf"]);
    expect((await readdir(path.join(root, waiting.id))).sort()).toEqual(["resume-v1.pdf", "web-filled-1.png"]);
    expect((await readdir(root)).includes(orphan)).toBe(false);
  });
});
