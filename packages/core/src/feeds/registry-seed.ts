import type { Db } from "../db/client.js";
import { companies } from "../db/schema.js";
import { isBlockedCompany, purgeBlockedSources } from "./blocklist.js";
import { BOARD_REGISTRY } from "./board-registry.js";

/**
 * Put the verified boards into the companies table so the poller and the "Companies" page know them.
 * Safe to run on every start: existing rows (and their display names, research and poll times) are left alone, new
 * registry entries are inserted, and boards of blocked aggregators (see blocklist.ts) are never added. First it runs
 * the blocklist cleanup, which closes the open jobs of blocked sources and removes their company rows; that is
 * idempotent too, so it simply does nothing once the data is clean.
 * Returns how many rows were new.
 */
export async function seedBoardRegistry(db: Db, opts: { log?: (msg: string) => void } = {}): Promise<number> {
  const purged = await purgeBlockedSources(db);
  if ((purged.closedJobs || purged.removedCompanies) && opts.log) {
    opts.log(`blocklist: closed ${purged.closedJobs} open job(s) and removed ${purged.removedCompanies} company row(s) from reposting aggregators`);
  }
  const entries = BOARD_REGISTRY.filter((b) => !isBlockedCompany({ name: b.name, token: b.token }));
  let added = 0;
  for (let i = 0; i < entries.length; i += 100) {
    const rows = await db.insert(companies)
      .values(entries.slice(i, i + 100).map((b) => ({ name: b.name, atsType: b.atsType, atsToken: b.token })))
      .onConflictDoNothing().returning();
    added += rows.length;
  }
  return added;
}
