import { basename } from "node:path";
import { eq } from "drizzle-orm";
import { applications, companies, getProfile, jobs, matches, profiles, resumes, type Db, type Preferences } from "@jobgraph/core";
import { executeTool, findDeepString, searchToolSlugs } from "./composio.js";

export const SHEET_TITLE = "Job Applications (jobgraph)";
export const SHEET_HEADER = ["Company", "Title", "Match %", "Status", "Applied", "Apply URL", "Resume PDF", "Missing skills", "Research summary"];

/**
 * Slugs confirmed against docs.composio.dev/toolkits (2026-10):
 *  GOOGLESHEETS_SEARCH_SPREADSHEETS { query, search_type, max_results }
 *  GOOGLESHEETS_CREATE_GOOGLE_SHEET1 { title }
 *  GOOGLESHEETS_CLEAR_VALUES { spreadsheet_id, range }
 *  GOOGLESHEETS_VALUES_UPDATE { spreadsheet_id, range, values, value_input_option }
 *  GOOGLESHEETS_BATCH_UPDATE (deprecated) { spreadsheet_id, sheet_name, values, first_cell_location }
 *  GOOGLECALENDAR_CREATE_EVENT { summary, start_datetime, event_duration_hour, event_duration_minutes, description, timezone }
 */
const NOT_FOUND = /not.?found|unknown tool|no such tool|does not exist|unsupported tool/i;

/** Run a tool; if the slug is gone, discover a replacement via Composio search and retry once with the same args. */
async function execWithDiscovery(userId: string, slug: string, args: Record<string, unknown>, useCase: string, toolkit: string): Promise<Record<string, unknown>> {
  try {
    return await executeTool(userId, slug, args);
  } catch (err) {
    if (!NOT_FOUND.test((err as Error).message)) throw err;
    const found = (await searchToolSlugs(userId, useCase, [toolkit])).filter((s) => s !== slug);
    if (!found.length) throw err;
    console.warn(`[sheets] ${slug} unavailable, trying ${found[0]}`);
    return executeTool(userId, found[0], args);
  }
}

const sheetUrl = (id: string) => `https://docs.google.com/spreadsheets/d/${id}/edit`;

function listSpreadsheets(data: unknown): { id: string; name: string }[] {
  const out: { id: string; name: string }[] = [];
  const walk = (v: unknown, depth = 0) => {
    if (!v || depth > 5) return;
    if (Array.isArray(v)) { v.forEach((x) => walk(x, depth + 1)); return; }
    if (typeof v === "object") {
      const r = v as Record<string, unknown>;
      const id = (r.id ?? r.spreadsheetId ?? r.spreadsheet_id) as unknown;
      const name = (r.name ?? r.title) as unknown;
      if (typeof id === "string" && typeof name === "string") out.push({ id, name });
      for (const x of Object.values(r)) walk(x, depth + 1);
    }
  };
  walk(data);
  return out;
}

async function findOrCreateSpreadsheet(userId: string): Promise<{ id: string; url: string }> {
  try {
    const found = await execWithDiscovery(userId, "GOOGLESHEETS_SEARCH_SPREADSHEETS", { query: SHEET_TITLE, search_type: "name", max_results: 10 }, "search google spreadsheets by name", "googlesheets");
    const hit = listSpreadsheets(found).find((s) => s.name === SHEET_TITLE);
    if (hit) return { id: hit.id, url: sheetUrl(hit.id) };
  } catch (err) {
    console.warn("[sheets] spreadsheet search failed, creating a new one:", (err as Error).message.slice(0, 200));
  }
  const created = await execWithDiscovery(userId, "GOOGLESHEETS_CREATE_GOOGLE_SHEET1", { title: SHEET_TITLE }, "create a new google spreadsheet", "googlesheets");
  const id = findDeepString(created, ["spreadsheetId", "spreadsheet_id", "id"]);
  if (!id) throw new Error("Google Sheets did not return a spreadsheet id");
  const url = findDeepString(created, ["spreadsheetUrl", "spreadsheet_url", "url"]) ?? sheetUrl(id);
  return { id, url };
}

type TrackerRow = { applicationId: string; cells: (string | number)[] };

async function buildRows(db: Db, userId: string): Promise<TrackerRow[]> {
  const rows = await db
    .select({
      app: applications, job: jobs, score: matches.score, explanation: matches.explanation,
      pdfPath: resumes.pdfPath, research: companies.research,
    })
    .from(applications)
    .innerJoin(jobs, eq(applications.jobId, jobs.id))
    .leftJoin(matches, eq(matches.jobId, jobs.id))
    .leftJoin(resumes, eq(resumes.id, applications.resumeId))
    .leftJoin(companies, eq(companies.id, jobs.companyId))
    .where(eq(applications.userId, userId));
  return rows
    .filter((r) => r.app.status !== "skipped")
    .sort((a, b) => a.app.createdAt.getTime() - b.app.createdAt.getTime())
    .map((r) => ({
      applicationId: r.app.id,
      cells: [
        r.job.companyName, r.job.title,
        r.score == null ? "" : `${Math.round(r.score * 100)}%`,
        r.app.status,
        r.app.submittedAt ? r.app.submittedAt.toISOString().slice(0, 10) : "",
        r.job.applyUrl,
        r.pdfPath ? basename(r.pdfPath) : "",
        (r.explanation?.missing ?? []).map((m) => m.requirement).slice(0, 8).join("; "),
        (r.research?.summary ?? "").slice(0, 400),
      ],
    }));
}

/** Write the tracker. Header and every application go in one RAW write (no formula evaluation of untrusted text). */
export async function syncTrackerSheet(db: Db, userId: string): Promise<{ spreadsheetUrl: string }> {
  const profile = await getProfile(db, userId);
  const prefs = (profile.preferences ?? {}) as Preferences & { sheetId?: string };
  let sheet: { id: string; url: string };
  if (prefs.sheetId) sheet = { id: prefs.sheetId, url: sheetUrl(prefs.sheetId) };
  else {
    sheet = await findOrCreateSpreadsheet(userId);
    await db.update(profiles).set({ preferences: { ...prefs, sheetId: sheet.id } as Preferences, updatedAt: new Date() }).where(eq(profiles.userId, userId));
  }

  const tracker = await buildRows(db, userId);
  const values = [SHEET_HEADER, ...tracker.map((t) => t.cells)];

  try {
    await executeTool(userId, "GOOGLESHEETS_CLEAR_VALUES", { spreadsheet_id: sheet.id, range: "A:Z" });
  } catch (err) {
    console.warn("[sheets] clear failed, overwriting in place:", (err as Error).message.slice(0, 200));
  }
  try {
    await execWithDiscovery(userId, "GOOGLESHEETS_VALUES_UPDATE", { spreadsheet_id: sheet.id, range: "A1", values, value_input_option: "RAW" }, "update a range of values in a google sheet", "googlesheets");
  } catch (err) {
    console.warn("[sheets] VALUES_UPDATE failed, trying BATCH_UPDATE:", (err as Error).message.slice(0, 200));
    await executeTool(userId, "GOOGLESHEETS_BATCH_UPDATE", { spreadsheet_id: sheet.id, sheet_name: "Sheet1", values, first_cell_location: "A1", value_input_option: "RAW" });
  }

  for (let i = 0; i < tracker.length; i++) {
    await db.update(applications).set({ sheetRow: i + 2 }).where(eq(applications.id, tracker[i].applicationId));
  }
  return { spreadsheetUrl: sheet.url };
}

/** Put a hold on the user's calendar (Google Calendar via Composio). Times are sent as UTC. */
export async function addCalendarHold(
  userId: string,
  hold: { title: string; startIso: string; durationMin: number; description?: string },
): Promise<{ eventId?: string; link?: string }> {
  const start = new Date(hold.startIso);
  if (isNaN(start.getTime())) throw new Error(`Invalid startIso: ${hold.startIso}`);
  const total = Math.max(1, Math.round(hold.durationMin));
  const data = await execWithDiscovery(userId, "GOOGLECALENDAR_CREATE_EVENT", {
    summary: hold.title,
    start_datetime: start.toISOString().slice(0, 19),
    timezone: "UTC",
    event_duration_hour: Math.floor(total / 60),
    event_duration_minutes: total % 60,
    description: hold.description ?? "",
    calendar_id: "primary",
  }, "create a google calendar event", "googlecalendar");
  return { eventId: findDeepString(data, ["id", "eventId", "event_id"]), link: findDeepString(data, ["htmlLink", "html_link"]) };
}
