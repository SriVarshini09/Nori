import type { Db } from "../db/client.js";
import { companies } from "../db/schema.js";
import { BOARD_REGISTRY } from "./board-registry.js";

/**
 * Put the verified boards into the companies table so the poller and the "Companies" page know them.
 * Safe to run on every start: existing rows (and their display names, research and poll times) are left alone.
 * Returns how many rows were new.
 */
export async function seedBoardRegistry(db: Db): Promise<number> {
  let added = 0;
  for (let i = 0; i < BOARD_REGISTRY.length; i += 100) {
    const rows = await db.insert(companies)
      .values(BOARD_REGISTRY.slice(i, i + 100).map((b) => ({ name: b.name, atsType: b.atsType, atsToken: b.token })))
      .onConflictDoNothing().returning();
    added += rows.length;
  }
  return added;
}
