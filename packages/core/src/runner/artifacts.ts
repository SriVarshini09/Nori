import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { inArray } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { applications, type ApplicationStatus } from "../db/schema.js";
import { artifactsRootOf } from "./runner.js";

/** Statuses after which nobody needs the screenshots of the filled form to decide anything. */
const SETTLED: ApplicationStatus[] = ["submitted", "viewed", "replied", "interview", "offer", "rejected", "failed", "skipped"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const artifactRetentionDays = () => {
  const n = Number(process.env.ARTIFACT_RETENTION_DAYS);
  return Number.isFinite(n) && n > 0 ? n : 30;
};

/**
 * Screenshots of filled forms hold a person's name, contact details and EEO answers, and every run adds more. Without
 * pruning they stayed forever, and on a small volume a full disk made every new tailoring fail. This removes:
 *  - folders of applications that no longer exist;
 *  - screenshots of applications that settled more than `days` ago (resume PDFs stay: the person can still download them).
 */
export async function pruneArtifacts(db: Db, opts: { root?: string; days?: number; now?: Date } = {}): Promise<{ files: number; dirs: number }> {
  const root = opts.root ?? artifactsRootOf();
  const cutoff = (opts.now ?? new Date()).getTime() - (opts.days ?? artifactRetentionDays()) * 86_400_000;
  let names: string[];
  try { names = (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory() && UUID.test(d.name)).map((d) => d.name); }
  catch { return { files: 0, dirs: 0 }; }
  if (!names.length) return { files: 0, dirs: 0 };
  const rows = await db.select({ id: applications.id, status: applications.status, updatedAt: applications.updatedAt })
    .from(applications).where(inArray(applications.id, names));
  const byId = new Map(rows.map((r) => [r.id, r]));
  let files = 0, dirs = 0;
  for (const name of names) {
    const dir = path.join(root, name);
    const app = byId.get(name);
    if (!app) { await rm(dir, { recursive: true, force: true }); dirs++; continue; }
    if (!SETTLED.includes(app.status) || app.updatedAt.getTime() > cutoff) continue;
    for (const f of await readdir(dir).catch(() => [] as string[])) {
      if (!f.toLowerCase().endsWith(".png")) continue;
      const p = path.join(dir, f);
      const s = await stat(p).catch(() => null);
      if (s && s.mtimeMs < cutoff) { await rm(p, { force: true }); files++; }
    }
  }
  return { files, dirs };
}
