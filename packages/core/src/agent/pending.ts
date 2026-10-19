import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { applications, channels, conversations, type ApplicationStatus } from "../db/schema.js";
import type { InboundMessage } from "../contracts.js";

/**
 * Short numbered references ("approve 2") for items waiting on the user. Stored per channel as a
 * system row in conversations (state.pending); numbering is shared across a user's channels so a
 * message sent everywhere reads the same. Numbers are reused once an item is no longer waiting.
 */
export type PendingRef = {
  n: number;
  applicationId: string;
  jobId: string;
  company: string;
  title: string;
  status: ApplicationStatus;
};

export const PENDING_STATUSES: ApplicationStatus[] = ["resume_review", "form_review", "needs_user"];

/** Fallback when the user has no linked channel (tests, a fresh install). */
const memory = new Map<string, PendingRef[]>();

const isRefList = (v: unknown): v is PendingRef[] => Array.isArray(v) && v.every((x) => x && typeof x === "object" && "n" in x && "applicationId" in x);

async function latestFor(db: Db, where: ReturnType<typeof and>): Promise<PendingRef[] | null> {
  const [row] = await db.select({ state: conversations.state }).from(conversations)
    .innerJoin(channels, eq(channels.id, conversations.channelId))
    .where(and(where, eq(conversations.role, "system"), isNotNull(sql`${conversations.state}->'pending'`)))
    .orderBy(desc(conversations.ts)).limit(1);
  const list = row?.state?.pending;
  return isRefList(list) ? list : null;
}

/** Drop entries that are no longer waiting and refresh their status. */
async function prune(db: Db, list: PendingRef[]): Promise<PendingRef[]> {
  if (!list.length) return [];
  const rows = await db.select({ id: applications.id, status: applications.status }).from(applications)
    .where(inArray(applications.id, list.map((r) => r.applicationId)));
  const status = new Map(rows.map((r) => [r.id, r.status]));
  return list
    .filter((r) => PENDING_STATUSES.includes(status.get(r.applicationId) as ApplicationStatus))
    .map((r) => ({ ...r, status: status.get(r.applicationId)! }));
}

async function userList(db: Db, userId: string): Promise<PendingRef[]> {
  return (await latestFor(db, and(eq(channels.userId, userId)))) ?? memory.get(userId) ?? [];
}

async function channelIdFor(db: Db, msg: Pick<InboundMessage, "channel" | "address">): Promise<string | null> {
  const [row] = await db.select({ id: channels.id }).from(channels)
    .where(and(eq(channels.kind, msg.channel), eq(channels.address, msg.address))).limit(1);
  return row?.id ?? null;
}

/** The live pending list for a conversation (the channel's own list, else the user's latest). */
export async function loadPending(db: Db, userId: string, msg?: Pick<InboundMessage, "channel" | "address">): Promise<PendingRef[]> {
  let list: PendingRef[] | null = null;
  if (msg) {
    const ch = await channelIdFor(db, msg);
    if (ch) list = await latestFor(db, and(eq(conversations.channelId, ch), eq(channels.userId, userId)));
  }
  return (await prune(db, list ?? (await userList(db, userId)))).sort((a, b) => a.n - b.n);
}

async function save(db: Db, userId: string, list: PendingRef[]) {
  memory.set(userId, list);
  const rows = await db.select({ id: channels.id }).from(channels).where(eq(channels.userId, userId));
  if (rows.length) {
    await db.insert(conversations).values(rows.map((r) => ({ channelId: r.id, role: "system" as const, content: "pending", state: { pending: list } })));
  }
}

/**
 * Give each item a reference number (keeping numbers already assigned) and store the list on every
 * channel the user has. Returns applicationId -> number.
 */
export async function assignRefs(db: Db, userId: string, items: Omit<PendingRef, "n">[]): Promise<Map<string, number>> {
  const raw = await userList(db, userId);
  const list = await prune(db, raw);
  const byApp = new Map(list.map((r) => [r.applicationId, r]));
  let changed = list.length !== raw.length;
  for (const it of items) {
    const cur = byApp.get(it.applicationId);
    if (cur) {
      if (cur.status !== it.status) { cur.status = it.status; changed = true; }
      continue;
    }
    const used = new Set(list.map((r) => r.n));
    let n = 1;
    while (used.has(n)) n++;
    const ref = { ...it, n };
    list.push(ref);
    byApp.set(it.applicationId, ref);
    changed = true;
  }
  list.sort((a, b) => a.n - b.n);
  if (changed) await save(db, userId, list);
  return new Map(list.map((r) => [r.applicationId, r.n]));
}

/** Resolve "2", "#2", "stripe", "the Stripe one" against the list. */
export function resolveRef(list: PendingRef[], ref: string): PendingRef[] {
  const t = ref.trim().toLowerCase().replace(/^#/, "").replace(/^the\s+/, "").replace(/\s+(?:one|job|role|application)s?$/, "").trim();
  if (!t) return [];
  if (/^\d+$/.test(t)) return list.filter((r) => r.n === Number(t));
  const exact = list.filter((r) => r.company.toLowerCase() === t);
  if (exact.length) return exact;
  return list.filter((r) => r.company.toLowerCase().includes(t) || (t.length > 3 && r.title.toLowerCase().includes(t)));
}

/** Test helper: forget the in-memory fallback. */
export function clearPendingMemory() { memory.clear(); }
