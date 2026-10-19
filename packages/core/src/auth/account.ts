import { rm } from "node:fs/promises";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  agentEvents, applications, channels, conversations, graphEdges, graphNodes, inboxMessages, matches, profiles, resumes,
  runEvents, sessions, userCredentials, users,
} from "../db/schema.js";

export type DeleteAccountCounts = {
  sessions: number; credentials: number; channels: number; conversations: number; inboxMessages: number; agentEvents: number;
  runEvents: number; resumes: number; applications: number; matches: number; graphEdges: number; graphNodes: number;
  profiles: number; users: number; artifactDirs: number;
};

/**
 * Permanently delete a user and everything keyed on them. Most tables cascade from users; every delete is explicit anyway,
 * children before parents, the user row last. Also removes <artifactsRoot>/<applicationId> for each of the user's applications.
 */
export async function deleteUserAccount(db: Db, userId: string, opts: { artifactsRoot?: string } = {}): Promise<DeleteAccountCounts> {
  const n = (rows: unknown[]) => rows.length;
  const appIds = (await db.select({ id: applications.id }).from(applications).where(eq(applications.userId, userId))).map((r) => r.id);
  const channelIds = (await db.select({ id: channels.id }).from(channels).where(eq(channels.userId, userId))).map((r) => r.id);

  const sess = await db.delete(sessions).where(eq(sessions.userId, userId)).returning();
  const creds = await db.delete(userCredentials).where(eq(userCredentials.userId, userId)).returning();
  const convs = channelIds.length
    ? await db.delete(conversations).where(inArray(conversations.channelId, channelIds)).returning() : [];
  const chans = await db.delete(channels).where(eq(channels.userId, userId)).returning();
  const inbox = await db.delete(inboxMessages).where(eq(inboxMessages.userId, userId)).returning();
  const agentEv = await db.delete(agentEvents).where(eq(agentEvents.userId, userId)).returning();
  const runEv = appIds.length
    ? await db.delete(runEvents).where(inArray(runEvents.applicationId, appIds)).returning() : [];
  const res = await db.delete(resumes).where(eq(resumes.userId, userId)).returning();
  const apps = await db.delete(applications).where(eq(applications.userId, userId)).returning();
  const mats = await db.delete(matches).where(eq(matches.userId, userId)).returning();
  const edges = await db.delete(graphEdges).where(eq(graphEdges.userId, userId)).returning();
  const nodes = await db.delete(graphNodes).where(eq(graphNodes.userId, userId)).returning();
  const profs = await db.delete(profiles).where(eq(profiles.userId, userId)).returning();
  const usrs = await db.delete(users).where(eq(users.id, userId)).returning();

  const root = opts.artifactsRoot ? path.resolve(opts.artifactsRoot) : path.resolve(process.env.ARTIFACTS_DIR ?? "data/artifacts");
  let artifactDirs = 0;
  for (const id of appIds) {
    const dir = path.resolve(root, id);
    if (path.relative(root, dir).startsWith("..") || dir === root) continue; // never leave the artifacts root
    await rm(dir, { recursive: true, force: true }).then(() => { artifactDirs++; }).catch(() => undefined);
  }

  return {
    sessions: n(sess), credentials: n(creds), channels: n(chans), conversations: n(convs), inboxMessages: n(inbox), agentEvents: n(agentEv),
    runEvents: n(runEv), resumes: n(res), applications: n(apps), matches: n(mats), graphEdges: n(edges), graphNodes: n(nodes),
    profiles: n(profs), users: n(usrs), artifactDirs,
  };
}
