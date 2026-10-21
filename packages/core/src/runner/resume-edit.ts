import path from "node:path";
import { and, count, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { applications, jobs, resumes, type ResumeChange, type ResumeContent } from "../db/schema.js";
import { ensureRequirements } from "../feeds/requirements.js";
import { ResumeDocError, mergeStyle, stableJson } from "../resume/docs.js";
import { renderPdf } from "../tailor/pdf.js";
import { LEFT_OUT } from "../tailor/rewrite.js";
import { emit } from "./events.js";
import { artifactsRootOf, type RunnerDeps } from "./runner.js";

export type ResumeEdit = { content?: ResumeContent; templateId?: string; theme?: unknown };

type Slot = { id: string; text: string; nodeIds: string[] };

/** Every editable text in a resume, keyed by a stable id: bullets by their id, the summary as "summary". */
function slots(c: ResumeContent): Map<string, Slot> {
  const m = new Map<string, Slot>();
  for (const r of c.experience) for (const b of r.bullets) m.set(b.id, { id: b.id, text: b.text, nodeIds: b.nodeIds });
  for (const p of c.projects ?? []) for (const b of p.bullets) m.set(b.id, { id: b.id, text: b.text, nodeIds: b.nodeIds });
  if (c.summary) m.set("summary", { id: "summary", text: c.summary, nodeIds: [] });
  return m;
}

/**
 * Keep the review diff honest after a hand edit. A bullet the user changed shows "before" (the original graph text) and
 * "after" (their words) with the reason "Edited by you". A bullet they typed from scratch shows an empty "before".
 * Putting a bullet back to its original text removes it from the diff.
 */
export function recomputeChanges(prev: { content: ResumeContent; changes: ResumeChange[] }, next: ResumeContent): { changes: ResumeChange[]; content: ResumeContent } {
  const before = slots(prev.content);
  const prevChange = new Map(prev.changes.map((c) => [c.bulletId, c]));
  const out: ResumeChange[] = [];
  const edited = new Set<string>();
  for (const [id, s] of slots(next)) {
    const old = before.get(id);
    const pc = prevChange.get(id);
    if (old && old.text === s.text) { if (pc) out.push(pc); continue; } // untouched: keep whatever tailoring recorded
    const original = pc ? pc.before : old ? old.text : "";
    if (old && original === s.text) continue; // restored to the original text
    edited.add(id);
    out.push({ bulletId: id, before: original, after: s.text, reason: old ? "Edited by you" : "Added by you", nodeIds: old ? s.nodeIds : [] });
  }
  // Bullets the tailoring left out are not in `next` at all, so their records are carried over as they were.
  for (const pc of prev.changes) if (pc.after === LEFT_OUT && !out.some((c) => c.bulletId === pc.bulletId)) out.push(pc);
  const mark = <T extends { id: string; text: string; nodeIds: string[]; edited?: boolean }>(b: T): T => (edited.has(b.id) ? { ...b, edited: true } : b);
  const content: ResumeContent = {
    ...next,
    experience: next.experience.map((r) => ({ ...r, bullets: r.bullets.map(mark) })),
    ...(next.projects ? { projects: next.projects.map((p) => ({ ...p, bullets: p.bullets.map(mark) })) } : {}),
  };
  return { changes: out, content };
}

/**
 * Edit the tailored resume of an application that is waiting for review: words, template, theme. Creates a new resume
 * version (the earlier ones stay), re-renders the PDF and ATS report, and keeps the application waiting for approval.
 */
export async function editApplicationResume(db: Db, userId: string, applicationId: string, edit: ResumeEdit, deps: Partial<RunnerDeps> = {}) {
  if (!/^[0-9a-f-]{36}$/i.test(applicationId)) throw new ResumeDocError("Application not found", 404);
  const [app] = await db.select().from(applications).where(and(eq(applications.id, applicationId), eq(applications.userId, userId))).limit(1);
  if (!app) throw new ResumeDocError("Application not found", 404);
  if (app.status !== "resume_review") throw new ResumeDocError("You can edit the resume while it waits for your review, before the form is filled.", 409);
  if (!app.resumeId) throw new ResumeDocError("This application has no resume yet", 409);
  const [cur] = await db.select().from(resumes).where(eq(resumes.id, app.resumeId)).limit(1);
  if (!cur) throw new ResumeDocError("This application has no resume yet", 409);

  const style = mergeStyle({ templateId: cur.templateId, theme: cur.theme }, edit);
  const contentChanged = edit.content !== undefined && stableJson(edit.content) !== stableJson(cur.content);
  const styleChanged = style.templateId !== cur.templateId || stableJson(style.theme) !== stableJson(cur.theme);
  if (!contentChanged && !styleChanged) return cur;

  const diff = contentChanged ? recomputeChanges({ content: cur.content, changes: cur.changes }, edit.content!) : { changes: cur.changes, content: cur.content };
  const [job] = await db.select().from(jobs).where(eq(jobs.id, app.jobId)).limit(1);
  const requirements = job ? await ensureRequirements(db, job.id) : null;
  const [{ n }] = await db.select({ n: count() }).from(resumes).where(eq(resumes.applicationId, app.id));
  const version = Number(n) + 1;
  const outPath = path.join(artifactsRootOf(deps), app.id, `resume-v${version}.pdf`);
  const render = await (deps.render ?? renderPdf)(diff.content, outPath, { requirements, templateId: style.templateId, theme: style.theme });
  const finalContent = render.content ?? diff.content;
  const provenance: Record<string, string[]> = {};
  for (const [id, s] of slots(finalContent)) provenance[id] = s.nodeIds;

  const [row] = await db.insert(resumes).values({
    userId, applicationId: app.id, version, content: finalContent, provenance, changes: diff.changes,
    html: render.html, pdfPath: render.pdfPath, pages: render.pages, atsScore: render.atsScore, atsChecks: render.atsChecks,
    keywordCoverage: cur.keywordCoverage, templateId: style.templateId, theme: style.theme, edited: cur.edited || contentChanged,
  }).returning();
  await db.update(applications).set({ resumeId: row.id, resumeApprovedAt: null, updatedAt: new Date() }).where(eq(applications.id, app.id));
  await emit(db, app.id, "resume_edit", contentChanged ? `You edited the resume (v${version}), ATS score ${render.atsScore}` : `Resume restyled: ${style.templateId} (v${version})`,
    { resumeId: row.id, version, pages: render.pages, atsScore: render.atsScore, template: style.templateId });
  return row;
}
