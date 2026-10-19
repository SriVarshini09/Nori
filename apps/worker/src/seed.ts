/**
 * Seed a demo account in one command:
 *
 *   npm run seed -- --resume path.pdf --email you@x.com --titles "Senior Frontend Engineer,Staff Engineer" \
 *     --locations "San Francisco" --remote ok --boards greenhouse:vercel,greenhouse:anthropic --cap 3 --min 0.3
 *
 * Creates or updates the user, ingests the resume file (pdf, docx, txt), writes preferences and one lane per title,
 * polls the boards, scores the jobs and prints a summary.
 *
 * When the API is reachable (API_URL, default http://localhost:${API_PORT:-4000}) everything goes over HTTP, because
 * the API process owns the embedded PGlite database (so this works alongside `npm run demo`). Over HTTP the seed acts
 * as the API's DEFAULT_USER_EMAIL user, or signs in / signs up as --email when --password is given. Only when the API
 * is down does it open the database directly. --direct forces the database path.
 */
import "./env.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  advanceOnboarding, computeMatchesForUser, ensureDefaultUser, extractResume, getDb, getProfile, ingestResume, jobs, laneFor, matches,
  normalizeEmail, normalizeLanes, pollTenant, profiles, withUserLLM, FEEDS,
  type AtsType, type Lane, type Preferences,
} from "@jobgraph/core";

const { values: args } = parseArgs({
  options: {
    resume: { type: "string" }, email: { type: "string" }, password: { type: "string" }, name: { type: "string" },
    titles: { type: "string" }, locations: { type: "string" }, remote: { type: "string" },
    boards: { type: "string" }, cap: { type: "string" }, min: { type: "string" },
    api: { type: "string" }, direct: { type: "boolean" }, help: { type: "boolean", short: "h" },
  },
  strict: true,
});

const USAGE = `npm run seed -- --resume path.pdf [--email you@x.com] [--password pw] --titles "A,B" [--locations "San Francisco"]
  [--remote only|ok|no] [--boards greenhouse:vercel,lever:foo] [--cap 3] [--min 0.3] [--api http://localhost:4000] [--direct]`;
if (args.help) { console.log(USAGE); process.exit(0); }

const list = (s?: string) => (s ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const titles = list(args.titles);
const locations = list(args.locations);
const remote = (args.remote ?? "ok") as "only" | "ok" | "no";
if (!["only", "ok", "no"].includes(remote)) fail(`--remote must be only, ok or no (got ${args.remote})`);
const boards = list(args.boards).map((b) => {
  const m = /^(greenhouse|lever|ashby|smartrecruiters):(.+)$/i.exec(b);
  if (!m) fail(`--boards entries look like greenhouse:vercel (got ${b})`);
  return { atsType: m![1].toLowerCase() as AtsType, token: m![2] };
});
const cap = args.cap !== undefined ? Number(args.cap) : undefined;
if (cap !== undefined && (!Number.isInteger(cap) || cap < 0 || cap > 100)) fail("--cap must be a whole number 0..100");
let minScore = args.min !== undefined ? Number(args.min) : undefined;
if (minScore !== undefined) {
  if (Number.isNaN(minScore) || minScore < 0 || minScore > 100) fail("--min must be 0..1 (or a percentage)");
  if (minScore > 1) minScore /= 100;
}
const lanes: Lane[] = normalizeLanes(titles.map((t) => ({ name: t, titles: [t], locations, remote, minScore: minScore ?? 0.6, enabled: true })));
const apiUrl = (args.api ?? process.env.API_URL ?? `http://localhost:${process.env.API_PORT ?? 4000}`).replace(/\/$/, "");

function fail(msg: string): never {
  console.error(`[seed] ${msg}\n${USAGE}`);
  process.exit(1);
}

type Summary = {
  via: "api" | "database";
  user: string;
  resume?: { nodesCreated: number; edgesCreated: number; usedLLM: boolean; chars?: number };
  preferences: { titles: string[]; locations: string[]; remote: string; dailyCap?: number; minScore?: number; boards: string[] };
  lanes: { id: string; name: string; minScore: number }[];
  boards: { board: string; added: number; total: number; error?: string }[];
  scored: number;
  top: { title: string; company: string; location: string | null; score: number; lane: string | null }[];
};

// ---------- over HTTP ----------

async function reachable(): Promise<boolean> {
  try { return (await fetch(`${apiUrl}/api/health`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; }
}

let cookie = "";
async function api<T = any>(method: string, p: string, body?: unknown, raw?: BodyInit): Promise<{ status: number; json: T }> {
  const headers: Record<string, string> = cookie ? { cookie } : {};
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${apiUrl}${p}`, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { error: text.slice(0, 300) }; }
  return { status: res.status, json };
}
const must = <T>(r: { status: number; json: T }, what: string): T => {
  if (r.status >= 400) throw new Error(`${what}: HTTP ${r.status} ${(r.json as { error?: string })?.error ?? ""}`);
  return r.json;
};

async function viaApi(): Promise<Summary> {
  let email: string;
  if (args.password) {
    if (!args.email) fail("--password needs --email");
    const login = await api("POST", "/api/auth/login", { email: args.email, password: args.password });
    if (login.status === 401) {
      const signup = await api("POST", "/api/auth/signup", { email: args.email, password: args.password, name: args.name });
      if (signup.status === 409) throw new Error(`${args.email} exists without that password; sign in on the web or drop --password and set DEFAULT_USER_EMAIL=${args.email}`);
      must(signup, "sign up");
    } else must(login, "sign in");
    email = args.email!;
  } else {
    const s = await api<{ user: { email: string } }>("GET", "/api/auth/session");
    if (s.status === 401) throw new Error(`The API at ${apiUrl} wants a session; start it with DEFAULT_USER_EMAIL set (npm run demo does), or pass --email and --password`);
    email = must(s, "session").user.email;
    if (args.email && normalizeEmail(args.email) !== normalizeEmail(email)) {
      throw new Error(`The API acts as ${email} (DEFAULT_USER_EMAIL). Restart it with DEFAULT_USER_EMAIL=${args.email}, or pass --password to sign in as ${args.email}.`);
    }
  }
  console.error(`[seed] using the API at ${apiUrl} as ${email}`);

  let resume: Summary["resume"];
  if (args.resume) {
    const bytes = await readFile(args.resume);
    const form = new FormData();
    form.append("file", new Blob([bytes]), path.basename(args.resume));
    const r = must(await api<any>("POST", "/api/profile/resume-file?wait=1", undefined, form), "resume upload");
    resume = { nodesCreated: r.nodesCreated, edgesCreated: r.edgesCreated, usedLLM: r.usedLLM, chars: r.extractedChars };
    console.error(`[seed] resume: ${r.nodesCreated} graph nodes, ${r.edgesCreated} edges${r.usedLLM ? " (LLM)" : " (heuristic parser)"}`);
  }

  const me = must(await api<{ profile: { preferences: Preferences } }>("GET", "/api/me"), "profile");
  const prefs = me.profile.preferences ?? {};
  const follow = [...new Set([...(prefs.followCompanies ?? []), ...boards.map((b) => `${b.atsType}:${b.token}`)])];
  must(await api("PUT", "/api/profile", {
    ...(cap !== undefined ? { autoApplyDailyCap: cap } : {}), ...(minScore !== undefined ? { autoApplyMinScore: minScore } : {}),
    ...(args.name ? { name: args.name } : {}),
    preferences: { ...(titles.length ? { titles } : {}), ...(locations.length ? { locations } : {}), remote, followCompanies: follow },
  }), "preferences");
  must(await api("PUT", "/api/onboarding", { step: "integrations", data: {} }), "onboarding");
  if (lanes.length) must(await api("PUT", "/api/lanes", lanes), "lanes");

  const boardOut: Summary["boards"] = [];
  const boardJobIds = new Set<string>();
  for (const b of boards) {
    console.error(`[seed] polling ${b.atsType}:${b.token} and scoring...`);
    const r = await api<{ added: number; total: number; ids: string[]; error?: string }>("POST", "/api/jobs/poll", b);
    if (r.status >= 400) { boardOut.push({ board: `${b.atsType}:${b.token}`, added: 0, total: 0, error: r.json?.error }); continue; }
    r.json.ids.forEach((id) => boardJobIds.add(id));
    boardOut.push({ board: `${b.atsType}:${b.token}`, added: r.json.added, total: r.json.total });
  }

  const rows = must(await api<{ job: any; match: { score: number } | null }[]>("GET", "/api/jobs?status=open&limit=500"), "jobs");
  const inScope = boardJobIds.size ? rows.filter((r) => boardJobIds.has(r.job.id)) : rows;
  const storedLanes = must(await api<Lane[]>("GET", "/api/lanes"), "lanes");
  return {
    via: "api", user: email, resume,
    preferences: { titles, locations, remote, dailyCap: cap, minScore, boards: follow },
    lanes: storedLanes.map((l) => ({ id: l.id, name: l.name, minScore: l.minScore })),
    boards: boardOut,
    scored: inScope.filter((r) => r.match).length,
    top: topOf(inScope.filter((r) => r.match).map((r) => ({ job: r.job, score: r.match!.score })), storedLanes),
  };
}

function topOf(rows: { job: { title: string; companyName: string; location: string | null; remote?: boolean }; score: number }[], lanes: Lane[]): Summary["top"] {
  return rows.sort((a, b) => b.score - a.score).slice(0, 8).map((r) => ({
    title: r.job.title, company: r.job.companyName, location: r.job.location, score: Math.round(r.score * 100) / 100,
    lane: lanes.length ? laneFor(r.job, lanes, r.score)?.name ?? null : null,
  }));
}

// ---------- directly against the database ----------

async function direct(): Promise<Summary> {
  const db = await getDb();
  const user = await ensureDefaultUser(db, normalizeEmail(args.email ?? process.env.DEFAULT_USER_EMAIL ?? "me@example.com"));
  console.error(`[seed] API not reachable at ${apiUrl}; writing to the database directly as ${user.email}`);
  return withUserLLM(db, user.id, async () => {
    let resume: Summary["resume"];
    if (args.resume) {
      const bytes = new Uint8Array(await readFile(args.resume));
      const doc = await extractResume(bytes, path.extname(args.resume));
      if (doc.text.length < 20) throw new Error(doc.error ?? "No text found in the resume file");
      const r = await ingestResume(db, user.id, doc.text, { links: doc.links });
      await db.update(profiles).set({ rawResumeText: doc.text, updatedAt: new Date() }).where(eq(profiles.userId, user.id));
      resume = { nodesCreated: r.nodesCreated, edgesCreated: r.edgesCreated, usedLLM: r.usedLLM, chars: doc.text.length };
    }
    const p = await getProfile(db, user.id);
    const prefs = (p.preferences ?? {}) as Preferences;
    const follow = [...new Set([...(prefs.followCompanies ?? []), ...boards.map((b) => `${b.atsType}:${b.token}`)])];
    await db.update(profiles).set({
      ...(cap !== undefined ? { autoApplyDailyCap: cap } : {}), ...(minScore !== undefined ? { autoApplyMinScore: minScore } : {}),
      ...(args.name ? { fullName: p.fullName ?? args.name } : {}),
      preferences: {
        ...prefs, ...(titles.length ? { titles } : {}), ...(locations.length ? { locations } : {}), remote, followCompanies: follow,
        ...(lanes.length ? { lanes } : {}),
      },
      onboarding: advanceOnboarding(p.onboarding, "integrations"),
      updatedAt: new Date(),
    }).where(eq(profiles.userId, user.id));

    const boardOut: Summary["boards"] = [];
    const ids: string[] = [];
    for (const b of boards) {
      if (!FEEDS[b.atsType]) { boardOut.push({ board: `${b.atsType}:${b.token}`, added: 0, total: 0, error: "no feed for this ATS" }); continue; }
      try {
        console.error(`[seed] polling ${b.atsType}:${b.token}...`);
        const r = await pollTenant(db, b.atsType, b.token);
        ids.push(...r.ids);
        boardOut.push({ board: `${b.atsType}:${b.token}`, added: r.added, total: r.total });
      } catch (e) { boardOut.push({ board: `${b.atsType}:${b.token}`, added: 0, total: 0, error: (e as Error).message }); }
    }
    console.error(`[seed] scoring ${ids.length || "all open"} job(s)...`);
    await computeMatchesForUser(db, user.id, ids.length ? { jobIds: ids, limit: ids.length } : {});
    const rows = await db.select({ job: jobs, score: matches.score }).from(matches).innerJoin(jobs, eq(jobs.id, matches.jobId))
      .where(and(eq(matches.userId, user.id), isNull(jobs.closedAt))).orderBy(desc(matches.score)).limit(1000);
    const scope = ids.length ? rows.filter((r) => ids.includes(r.job.id)) : rows;
    const stored = ((await getProfile(db, user.id)).preferences as Preferences).lanes ?? [];
    return {
      via: "database", user: user.email, resume,
      preferences: { titles, locations, remote, dailyCap: cap, minScore, boards: follow },
      lanes: stored.map((l) => ({ id: l.id, name: l.name, minScore: l.minScore })),
      boards: boardOut, scored: scope.length, top: topOf(scope, stored),
    };
  });
}

function print(s: Summary) {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const lines = [
    "",
    `Seeded ${s.user} (via ${s.via})`,
    s.resume ? `  resume: ${s.resume.nodesCreated} nodes, ${s.resume.edgesCreated} edges${s.resume.usedLLM ? " (LLM parse)" : " (heuristic parse)"}` : "  resume: not changed",
    `  titles: ${s.preferences.titles.join(", ") || "(unchanged)"}; locations: ${s.preferences.locations.join(", ") || "any"}; remote: ${s.preferences.remote}`,
    `  daily cap: ${s.preferences.dailyCap ?? "(unchanged)"}; min score: ${s.preferences.minScore !== undefined ? pct(s.preferences.minScore) : "(unchanged)"}`,
    `  lanes: ${s.lanes.map((l) => `${l.name} [${l.id}] >= ${pct(l.minScore)}`).join("; ") || "none (preferences.titles act as one lane)"}`,
    `  boards: ${s.boards.map((b) => `${b.board} ${b.error ? `failed: ${b.error}` : `${b.total} open, ${b.added} new`}`).join("; ") || "none"}`,
    `  scored: ${s.scored} job(s)`,
    ...(s.top.length ? ["  best matches:", ...s.top.map((t, i) => `   ${i + 1}. ${pct(t.score)}  ${t.title} at ${t.company}${t.location ? ` (${t.location})` : ""}${t.lane ? `  -> lane ${t.lane}` : ""}`)] : []),
    "",
  ];
  console.log(lines.join("\n"));
}

async function main() {
  const useApi = !args.direct && (await reachable());
  const s = useApi ? await viaApi() : await direct();
  print(s);
  process.exit(0);
}

main().catch((e) => {
  console.error(`[seed] failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
