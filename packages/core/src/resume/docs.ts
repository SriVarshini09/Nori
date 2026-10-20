import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { resumeDocs, resumeDocVersions, type ResumeContent } from "../db/schema.js";
import { getProfile } from "../users.js";
import { buildBaselineResume } from "../graph/query.js";
import { isTemplateId, themeFor, type TemplateId } from "./templates.js";

export type ResumeDoc = typeof resumeDocs.$inferSelect;
export type ResumeDocVersion = typeof resumeDocVersions.$inferSelect;

export class ResumeDocError extends Error {
  constructor(message: string, public status: 400 | 404 | 409 = 400) { super(message); this.name = "ResumeDocError"; }
}

/** Versions kept per document; older snapshots are pruned. */
export const MAX_VERSIONS = 40;
/** Documents a user can keep. */
export const MAX_DOCS = 25;

/** JSON with sorted keys: Postgres returns jsonb keys in its own order, so plain stringify cannot compare two documents. */
export function stableJson(v: unknown): string {
  return JSON.stringify(v, (_k, val) => (val && typeof val === "object" && !Array.isArray(val) ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) : val));
}

/** A theme stored on a document: only the user's overrides, validated. */
const cleanTheme = (templateId: TemplateId, theme: unknown) => {
  const full = themeFor(templateId, theme);
  return full as unknown as Record<string, unknown>;
};

export async function listResumeDocs(db: Db, userId: string): Promise<ResumeDoc[]> {
  return db.select().from(resumeDocs).where(eq(resumeDocs.userId, userId)).orderBy(desc(resumeDocs.isDefault), desc(resumeDocs.updatedAt));
}

export async function getResumeDoc(db: Db, userId: string, id: string): Promise<ResumeDoc> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ResumeDocError("Resume not found", 404);
  const [row] = await db.select().from(resumeDocs).where(and(eq(resumeDocs.id, id), eq(resumeDocs.userId, userId))).limit(1);
  if (!row) throw new ResumeDocError("Resume not found", 404);
  return row;
}

/** The document the agent tailors from and styles tailored resumes after; null when the user has none. */
export async function getDefaultResumeDoc(db: Db, userId: string): Promise<ResumeDoc | null> {
  const [row] = await db.select().from(resumeDocs).where(and(eq(resumeDocs.userId, userId), eq(resumeDocs.isDefault, true))).limit(1);
  return row ?? null;
}

export type NewResumeDoc = {
  name: string;
  source?: ResumeDoc["source"];
  content: ResumeContent;
  templateId?: string;
  theme?: unknown;
  makeDefault?: boolean;
};

export async function createResumeDoc(db: Db, userId: string, input: NewResumeDoc): Promise<ResumeDoc> {
  const existing = await db.select({ id: resumeDocs.id }).from(resumeDocs).where(eq(resumeDocs.userId, userId));
  if (existing.length >= MAX_DOCS) throw new ResumeDocError(`You can keep up to ${MAX_DOCS} resumes. Delete one first.`, 409);
  const name = input.name.trim().slice(0, 120) || "Untitled resume";
  const templateId: TemplateId = isTemplateId(input.templateId) ? input.templateId : "classic";
  const makeDefault = input.makeDefault || existing.length === 0;
  if (makeDefault && existing.length) await db.update(resumeDocs).set({ isDefault: false }).where(and(eq(resumeDocs.userId, userId), eq(resumeDocs.isDefault, true)));
  const [row] = await db.insert(resumeDocs).values({
    userId, name, source: input.source ?? "manual", content: input.content, templateId, theme: cleanTheme(templateId, input.theme), isDefault: makeDefault,
  }).returning();
  return row;
}

/** A new document built from the user's career graph, in their name. */
export async function createResumeDocFromGraph(db: Db, userId: string, opts: { name?: string; templateId?: string; theme?: unknown; makeDefault?: boolean } = {}): Promise<ResumeDoc> {
  const profile = await getProfile(db, userId);
  const content = await buildBaselineResume(db, userId, profile);
  if (profile.github && !content.contact.github) content.contact.github = String(profile.github);
  return createResumeDoc(db, userId, { name: opts.name ?? "My resume", source: "graph", content, templateId: opts.templateId, theme: opts.theme, makeDefault: opts.makeDefault });
}

/** A blank starting point with the user's own contact details filled in. */
export async function createBlankResumeDoc(db: Db, userId: string, name = "New resume"): Promise<ResumeDoc> {
  const profile = await getProfile(db, userId);
  const content: ResumeContent = {
    name: profile.fullName ?? "",
    contact: { ...(profile.email ? { email: profile.email } : {}), ...(profile.phone ? { phone: profile.phone } : {}), ...(profile.location ? { location: profile.location } : {}) },
    experience: [{ title: "", company: "", bullets: [] }], education: [], skills: [],
  };
  return createResumeDoc(db, userId, { name, source: "manual", content });
}

/** After a resume is read into the graph: make sure the user has a first document to edit. No-op when they already have one. */
export async function ensureResumeDoc(db: Db, userId: string): Promise<ResumeDoc | null> {
  const [any] = await db.select({ id: resumeDocs.id }).from(resumeDocs).where(eq(resumeDocs.userId, userId)).limit(1);
  if (any) return null;
  return createResumeDocFromGraph(db, userId, { name: "My resume", makeDefault: true });
}

async function snapshot(db: Db, doc: ResumeDoc, label: string | null) {
  await db.insert(resumeDocVersions).values({ docId: doc.id, version: doc.version, name: doc.name, content: doc.content, templateId: doc.templateId, theme: doc.theme, label });
  const old = await db.select({ id: resumeDocVersions.id }).from(resumeDocVersions).where(eq(resumeDocVersions.docId, doc.id)).orderBy(desc(resumeDocVersions.version), desc(resumeDocVersions.createdAt)).offset(MAX_VERSIONS);
  if (old.length) await db.delete(resumeDocVersions).where(inArray(resumeDocVersions.id, old.map((o) => o.id)));
}

export type ResumeDocPatch = { name?: string; content?: ResumeContent; templateId?: string; theme?: unknown };

/**
 * Change a document. The previous state is snapshotted first, so nothing is ever lost.
 * `expectedVersion` guards against two tabs overwriting each other: a stale save gets a 409 with the current version.
 */
export async function updateResumeDoc(db: Db, userId: string, id: string, patch: ResumeDocPatch, opts: { expectedVersion?: number; label?: string } = {}): Promise<ResumeDoc> {
  const doc = await getResumeDoc(db, userId, id);
  if (opts.expectedVersion !== undefined && opts.expectedVersion !== doc.version) {
    throw new ResumeDocError(`This resume changed in another tab or device (now version ${doc.version}). Reload to continue.`, 409);
  }
  const templateId: TemplateId = patch.templateId === undefined ? (doc.templateId as TemplateId) : isTemplateId(patch.templateId) ? patch.templateId : (() => { throw new ResumeDocError("Unknown template"); })();
  const templateChanged = templateId !== doc.templateId;
  const theme = patch.theme === undefined && !templateChanged
    ? doc.theme
    : cleanTheme(templateId, patch.theme === undefined ? undefined : { ...(templateChanged ? {} : doc.theme), ...(patch.theme as object) });
  const next = {
    name: patch.name === undefined ? doc.name : patch.name.trim().slice(0, 120) || doc.name,
    content: patch.content ?? doc.content,
    templateId, theme,
  };
  const changed = next.name !== doc.name || next.templateId !== doc.templateId || stableJson(next.content) !== stableJson(doc.content) || stableJson(next.theme) !== stableJson(doc.theme);
  if (!changed) return doc;
  await snapshot(db, doc, opts.label ?? null);
  const [row] = await db.update(resumeDocs).set({ ...next, version: doc.version + 1, updatedAt: new Date() }).where(eq(resumeDocs.id, doc.id)).returning();
  return row;
}

export async function setDefaultResumeDoc(db: Db, userId: string, id: string): Promise<ResumeDoc> {
  const doc = await getResumeDoc(db, userId, id);
  if (doc.isDefault) return doc;
  await db.update(resumeDocs).set({ isDefault: false }).where(and(eq(resumeDocs.userId, userId), eq(resumeDocs.isDefault, true)));
  const [row] = await db.update(resumeDocs).set({ isDefault: true, updatedAt: new Date() }).where(eq(resumeDocs.id, id)).returning();
  return row;
}

export async function duplicateResumeDoc(db: Db, userId: string, id: string, name?: string): Promise<ResumeDoc> {
  const doc = await getResumeDoc(db, userId, id);
  return createResumeDoc(db, userId, { name: name?.trim() || `Copy of ${doc.name}`.slice(0, 120), source: "copy", content: structuredClone(doc.content), templateId: doc.templateId, theme: doc.theme });
}

export async function deleteResumeDoc(db: Db, userId: string, id: string): Promise<void> {
  const doc = await getResumeDoc(db, userId, id);
  await db.delete(resumeDocs).where(eq(resumeDocs.id, id));
  if (doc.isDefault) {
    const [next] = await db.select().from(resumeDocs).where(eq(resumeDocs.userId, userId)).orderBy(desc(resumeDocs.updatedAt)).limit(1);
    if (next) await db.update(resumeDocs).set({ isDefault: true }).where(eq(resumeDocs.id, next.id));
  }
}

export async function listResumeDocVersions(db: Db, userId: string, id: string): Promise<ResumeDocVersion[]> {
  await getResumeDoc(db, userId, id);
  return db.select().from(resumeDocVersions).where(eq(resumeDocVersions.docId, id)).orderBy(desc(resumeDocVersions.version));
}

/** Put an earlier version back as the current one (the current state is snapshotted first, so restoring can be undone). */
export async function restoreResumeDocVersion(db: Db, userId: string, id: string, version: number): Promise<ResumeDoc> {
  const doc = await getResumeDoc(db, userId, id);
  const [v] = await db.select().from(resumeDocVersions).where(and(eq(resumeDocVersions.docId, id), eq(resumeDocVersions.version, version))).orderBy(desc(resumeDocVersions.createdAt)).limit(1);
  if (!v) throw new ResumeDocError("That version no longer exists", 404);
  await snapshot(db, doc, `Before restoring version ${version}`);
  const [row] = await db.update(resumeDocs).set({ name: v.name, content: v.content, templateId: v.templateId, theme: v.theme, version: doc.version + 1, updatedAt: new Date() }).where(eq(resumeDocs.id, id)).returning();
  return row;
}

/** Replace a document's content with what the career graph says now. The old content stays in the version history. */
export async function rebuildResumeDocFromGraph(db: Db, userId: string, id: string): Promise<ResumeDoc> {
  const doc = await getResumeDoc(db, userId, id);
  const profile = await getProfile(db, userId);
  const content = await buildBaselineResume(db, userId, profile);
  if (profile.github && !content.contact.github) content.contact.github = String(profile.github);
  // keep what the graph does not know: the summary and any layout the user chose
  if (doc.content.summary) content.summary = doc.content.summary;
  if (doc.content.layout) content.layout = doc.content.layout;
  if (doc.content.extras) content.extras = doc.content.extras;
  return updateResumeDoc(db, userId, id, { content }, { label: "Before refreshing from your graph" });
}

