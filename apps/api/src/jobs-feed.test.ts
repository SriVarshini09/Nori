import { beforeAll, describe, expect, it } from "vitest";
import { jobs, openTestDb, type Db } from "@jobgraph/core";
import { createApp } from "./app.js";

let db: Db;
let app: ReturnType<typeof createApp>;

async function call(method: string, url: string, body?: unknown) {
  const res = await app.request(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}
const list = async (qs = "") => (await call("GET", `/api/jobs${qs ? `?${qs}` : ""}`)).json as any[];
const names = (rows: any[]) => rows.map((r) => r.job.companyName);

const HOUR = 3_600_000;
const ago = (hours: number) => new Date(Date.now() - hours * HOUR);
let n = 0;
async function add(companyName: string, title: string, o: { location?: string; remote?: boolean; postedHoursAgo?: number | null; seenHoursAgo?: number; closed?: boolean; description?: string } = {}) {
  await db.insert(jobs).values({
    companyName, title, atsType: "web", externalId: `feed-${++n}`, applyUrl: `https://example.com/${n}`,
    location: o.location ?? null, remote: o.remote ?? false,
    descriptionText: o.description ?? "Build great things with TypeScript.",
    postedAt: o.postedHoursAgo === null ? null : ago(o.postedHoursAgo ?? 48),
    firstSeenAt: ago(o.seenHoursAgo ?? o.postedHoursAgo ?? 48),
    closedAt: o.closed ? ago(1) : null,
  });
}

beforeAll(async () => {
  db = await openTestDb();
  app = createApp(db, { mcp: false, rateLimit: false, defaultUserEmail: "me@example.com" });
  await add("Acme", "Frontend Engineer", { location: "San Francisco, CA", postedHoursAgo: 48 });
  await add("Acme", "Frontend  Engineer", { location: "London, UK", postedHoursAgo: 72 }); // same posting, spacing differs
  await add("acme", "frontend engineer", { location: "Remote", remote: true, postedHoursAgo: 120 });
  await add("Beta", "Backend Engineer", { location: "New York, NY", postedHoursAgo: 240 });
  await add("Gamma", "Staff Frontend Engineer", { location: "San Francisco, CA", postedHoursAgo: 24, closed: true });
  await add("Delta", "Frontend Engineer", { location: "San Francisco, CA", postedHoursAgo: 24 * 90 });
  await add("Orbital", "Frontend Engineer, Flight Software", { location: "San Francisco, CA", postedHoursAgo: 30, description: "Build the ground UI.\nApplicants must be a U.S. citizen and able to obtain a Secret clearance." });
  await add("Pastry Co", "Pastry Chef", { location: "San Francisco, CA", postedHoursAgo: 2 });
  await add("Epsilon", "Frontend Engineer", { location: "San Francisco, CA", postedHoursAgo: null, seenHoursAgo: 0.5 }); // posted date unknown: first seen counts
  for (let i = 0; i < 10; i++) await add("Mega", "Platform Engineer", { location: `City ${i}`, postedHoursAgo: 200 + i });
});

describe("GET /api/jobs defaults", () => {
  it("returns open jobs from the last 60 days, one row per company and title", async () => {
    const rows = await list();
    expect(names(rows).sort()).toEqual(["Acme", "Beta", "Epsilon", "Mega", "Orbital", "Pastry Co"]);
    expect(names(rows)).not.toContain("Gamma"); // closed
    expect(names(rows)).not.toContain("Delta"); // posted 90 days ago
  });

  it("keeps the explicit filters working: status closed, applied, all, and maxAgeDays=0", async () => {
    expect(names(await list("status=closed"))).toEqual(["Gamma"]);
    expect(await list("status=applied")).toEqual([]);
    expect(names(await list("maxAgeDays=0"))).toContain("Delta");
    const all = names(await list("status=all&maxAgeDays=0"));
    expect(all).toEqual(expect.arrayContaining(["Gamma", "Delta"]));
    expect((await call("GET", "/api/jobs?status=bogus")).status).toBe(400);
    expect((await call("GET", "/api/jobs?sort=bogus")).status).toBe(400);
    expect((await call("GET", "/api/jobs?clearance=bogus")).status).toBe(400);
  });

  it("uses first_seen_at when posted_at is missing", async () => {
    const rows = await list("sort=new&maxAgeDays=1");
    expect(names(rows)).toContain("Epsilon");
  });
});

describe("sort=new", () => {
  it("orders the newest open jobs first by posted_at, falling back to first_seen_at", async () => {
    const rows = await list("sort=new&limit=6");
    expect(names(rows)).toEqual(["Epsilon", "Pastry Co", "Orbital", "Acme", "Mega", "Beta"]);
    expect(names(rows)).not.toContain("Gamma");
  });

  it("reaches new postings the best-first page would not", async () => {
    const newest = await list("sort=new&limit=1");
    expect(newest[0].job.companyName).toBe("Epsilon");
  });

  it("New today (maxAgeDays=1) keeps only the last 24 hours", async () => {
    expect(names(await list("sort=new&maxAgeDays=1"))).toEqual(["Epsilon", "Pastry Co"]);
  });
});

describe("grouping", () => {
  it("collapses the same company and title (case and spacing ignored) into one row with its places", async () => {
    const acme = (await list("sort=new")).filter((r) => r.job.companyName.toLowerCase() === "acme");
    expect(acme).toHaveLength(1);
    expect(acme[0].job.location).toBe("San Francisco, CA"); // the newest of the three
    expect(acme[0].locations).toBe(3);
    expect(acme[0].locationNames[0]).toBe("San Francisco, CA");
    expect([...acme[0].locationNames].sort()).toEqual(["London, UK", "Remote", "San Francisco, CA"]);
  });

  it("caps the place names at 8 but still counts them all", async () => {
    const mega = (await list()).find((r) => r.job.companyName === "Mega");
    expect(mega.locations).toBe(10);
    expect(mega.locationNames).toHaveLength(8);
  });

  it("group=0 returns every row", async () => {
    const rows = await list("group=0&limit=100");
    expect(rows.filter((r) => r.job.companyName.toLowerCase() === "acme")).toHaveLength(3);
    expect(rows.every((r) => r.locations === undefined)).toBe(true);
  });
});

describe("clearance", () => {
  it("shows flagged jobs by default and drops them with clearance=hide", async () => {
    expect(names(await list())).toContain("Orbital");
    expect(names(await list("clearance=show"))).toContain("Orbital");
    const hidden = await list("clearance=hide");
    expect(names(hidden)).not.toContain("Orbital");
    expect(names(hidden)).toContain("Acme");
    expect(hidden[0].job.descriptionText).toEqual(expect.any(String)); // the description is still returned
  });

  it("returns the description with every row either way", async () => {
    const rows = await list();
    expect(rows.every((r) => typeof r.job.descriptionText === "string" && r.job.descriptionText.length > 0)).toBe(true);
  });
});

describe("lanes", () => {
  it("does not filter by lane when the user has none", async () => {
    expect(names(await list("sort=best"))).toContain("Pastry Co");
  });

  it("best match keeps only jobs that fit the enabled lanes; lanes=0 turns that off", async () => {
    const put = await call("PUT", "/api/lanes", [{ name: "Frontend SF", titles: ["Frontend Engineer"], locations: ["San Francisco"], remote: "ok", minScore: 0.5 }]);
    expect(put.status).toBe(200);
    const best = await list("sort=best");
    expect(names(best).sort()).toEqual(["Acme", "Epsilon", "Orbital"]);
    expect(names(best)).not.toContain("Pastry Co");
    expect(names(best)).not.toContain("Beta");
    expect(names(await list("sort=best&lanes=0"))).toContain("Pastry Co");
    // Newest is a firehose by default: lanes only apply when asked for.
    expect(names(await list("sort=new"))).toContain("Pastry Co");
    expect(names(await list("sort=new&lanes=1"))).not.toContain("Pastry Co");
    // A typed search is never narrowed by lane unless asked.
    expect(names(await list("q=pastry"))).toEqual(["Pastry Co"]);
  });

  it("a disabled lane is ignored", async () => {
    await call("PUT", "/api/lanes", [{ name: "Frontend SF", titles: ["Frontend Engineer"], locations: ["San Francisco"], enabled: false }]);
    expect(names(await list("sort=best"))).toContain("Pastry Co");
    await call("PUT", "/api/lanes", [{ name: "Frontend SF", titles: ["Frontend Engineer"], locations: ["San Francisco"], remote: "ok", minScore: 0.5 }]);
  });
});

describe("GET /api/jobs/summary", () => {
  it("counts open jobs in the window, new today, new this week and the ones that fit the lanes", async () => {
    const s = await call("GET", "/api/jobs/summary");
    expect(s.status).toBe(200);
    // open within 60 days: 3 Acme + Beta + Orbital + Pastry + Epsilon + 10 Mega
    expect(s.json).toMatchObject({ open: 17, newToday: 2, newThisWeek: 6, hasLanes: true });
    // Acme SF + Acme Remote + Orbital + Epsilon fit "Frontend Engineer" in San Francisco or remote
    expect(s.json.fitsLanes).toBe(4);
    expect((await call("GET", "/api/jobs/summary?maxAgeDays=0")).json.open).toBe(18); // + Delta (Gamma is closed)
  });
});
