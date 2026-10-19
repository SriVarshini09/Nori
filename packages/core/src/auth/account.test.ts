import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { openTestDb } from "../db/client.js";
import {
  agentEvents, applications, channels, conversations, graphEdges, graphNodes, jobs, matches, profiles, resumes, runEvents, users,
} from "../db/schema.js";
import { createSession, deleteUserAccount } from "./index.js";
import { ensureDefaultUser } from "../users.js";

describe("deleteUserAccount", () => {
  it("removes every row and artifact directory of one user and leaves others alone", async () => {
    const db = await openTestDb();
    const root = await mkdtemp(path.join(os.tmpdir(), "jg-del-"));
    const a = await ensureDefaultUser(db, "a@example.com");
    const b = await ensureDefaultUser(db, "b@example.com");
    const [job] = await db.insert(jobs).values({ companyName: "Acme", atsType: "manual", externalId: "x1", title: "Eng", descriptionText: "d", applyUrl: "https://x" }).returning();
    const seed = async (userId: string) => {
      await createSession(db, userId, "t");
      const [n1] = await db.insert(graphNodes).values({ userId, type: "skill", label: "TS" }).returning();
      const [n2] = await db.insert(graphNodes).values({ userId, type: "tool", label: "Node" }).returning();
      await db.insert(graphEdges).values({ userId, src: n1.id, dst: n2.id, type: "related_to" });
      await db.insert(matches).values({ userId, jobId: job.id, score: 0.5, explanation: { matched: [], missing: [], reasons: [] } });
      const [app] = await db.insert(applications).values({ userId, jobId: job.id }).returning();
      await db.insert(resumes).values({ userId, applicationId: app.id, content: { name: "x", contact: {}, experience: [], education: [], skills: [] } });
      await db.insert(runEvents).values({ applicationId: app.id, step: "s", message: "m" });
      await db.insert(agentEvents).values({ userId, kind: "queued", applicationId: app.id, message: "m" });
      const [ch] = await db.insert(channels).values({ userId, kind: "telegram", address: `tg-${userId}` }).returning();
      await db.insert(conversations).values({ channelId: ch.id, role: "user", content: "hi" });
      await mkdir(path.join(root, app.id), { recursive: true });
      await writeFile(path.join(root, app.id, "resume-v1.pdf"), "pdf");
      return app.id;
    };
    const appA = await seed(a.id);
    const appB = await seed(b.id);

    const counts = await deleteUserAccount(db, a.id, { artifactsRoot: root });
    expect(counts).toMatchObject({
      sessions: 1, channels: 1, conversations: 1, agentEvents: 1, runEvents: 1, resumes: 1, applications: 1, matches: 1,
      graphEdges: 1, graphNodes: 2, profiles: 1, users: 1, artifactDirs: 1,
    });
    expect(existsSync(path.join(root, appA))).toBe(false);
    expect(await db.select().from(users).where(eq(users.id, a.id))).toHaveLength(0);
    expect(await db.select().from(profiles).where(eq(profiles.userId, a.id))).toHaveLength(0);

    // User B is untouched.
    expect(existsSync(path.join(root, appB, "resume-v1.pdf"))).toBe(true);
    expect(await db.select().from(graphNodes).where(eq(graphNodes.userId, b.id))).toHaveLength(2);
    expect(await db.select().from(conversations)).toHaveLength(1);
    expect(await db.select().from(users).where(eq(users.id, b.id))).toHaveLength(1);
  });
});
