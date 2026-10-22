import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { openTestDb, seedBoardRegistry, type Db } from "@jobgraph/core";
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

beforeAll(async () => {
  db = await openTestDb();
  await seedBoardRegistry(db);
  app = createApp(db, { mcp: false, rateLimit: false, defaultUserEmail: "me@example.com" });
});
afterEach(() => vi.unstubAllGlobals());

describe("companies API", () => {
  it("lists watched companies, searches, follows and unfollows", async () => {
    const list = await call("GET", "/api/companies?limit=5");
    expect(list.status).toBe(200);
    expect(list.json.companies).toHaveLength(5);
    expect(list.json.total).toBeGreaterThan(100);
    expect(Object.keys(list.json.companies[0]).sort()).toEqual(["atsType", "followed", "id", "name", "openJobs", "token"]);

    const found = (await call("GET", "/api/companies?q=stripe")).json.companies[0];
    expect(found.name).toBe("Stripe");
    expect((await call("POST", "/api/companies/follow", { atsType: found.atsType, token: found.token })).status).toBe(200);
    expect((await call("GET", "/api/companies?followed=1")).json.companies.map((c: any) => c.name)).toEqual(["Stripe"]);
    expect((await call("POST", "/api/companies/follow", { atsType: "greenhouse", token: "nobody-watches-this" })).status).toBe(404);
    expect((await call("POST", "/api/companies/follow", { atsType: "workday", token: "x" })).status).toBe(400);
    expect((await call("DELETE", "/api/companies/follow", { atsType: found.atsType, token: found.token })).status).toBe(204);
    expect((await call("GET", "/api/companies?followed=1")).json.total).toBe(0);
  });

  it("clamps paging parameters instead of failing", async () => {
    expect((await call("GET", "/api/companies?limit=99999&offset=-5")).status).toBe(200);
    expect((await call("GET", "/api/companies?limit=abc")).json.companies.length).toBe(60);
  });

  it("detects a board from a posting link, reads it, follows it and counts its jobs", async () => {
    const real = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: any, init?: any) => {
      const u = String(input);
      if (u.startsWith("https://boards-api.greenhouse.io/v1/boards/acmecorp/jobs")) {
        return new Response(JSON.stringify({ jobs: [
          { id: 1, title: "Backend Engineer", absolute_url: "https://boards.greenhouse.io/acmecorp/jobs/1", location: { name: "Remote" }, content: "<p>Go and PostgreSQL</p>", company_name: "Acme Corp" },
          { id: 2, title: "Designer", absolute_url: "https://boards.greenhouse.io/acmecorp/jobs/2", location: { name: "London" }, content: "<p>Figma</p>", company_name: "Acme Corp" },
        ] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return real(input, init);
    });
    const r = await call("POST", "/api/companies/detect", { url: "https://boards.greenhouse.io/acmecorp/jobs/1" });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ atsType: "greenhouse", token: "acmecorp", openJobs: 2, added: 2 });
    const mine = (await call("GET", "/api/companies?followed=1")).json.companies;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ token: "acmecorp", openJobs: 2, followed: true });
    expect((await call("GET", "/api/jobs?q=backend")).json.some((j: any) => j.job.companyName === "Acme Corp")).toBe(true);
  });

  it("explains what is wrong with a link instead of failing", async () => {
    expect((await call("POST", "/api/companies/detect", { url: "http://169.254.169.254/latest" })).json.error).toMatch(/not a public website/);
    expect((await call("POST", "/api/companies/detect", { url: "nope" })).status).toBe(400);
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ jobs: [] }), { status: 200 }));
    const empty = await call("POST", "/api/companies/detect", { url: "https://boards.greenhouse.io/emptyco/jobs/9" });
    expect(empty.status).toBe(422);
    expect(empty.json.error).toMatch(/no open jobs/);
  });
});
