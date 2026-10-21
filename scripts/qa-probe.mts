/**
 * API probe against a RUNNING instance (`npm run serve`): finds server errors, auth holes and cross-user leaks.
 *   E2E_API_PORT=4300 npx tsx scripts/qa-probe.mts
 * Checks: (A) every route signed out, (B) every GET with good, missing and hostile ids, (C) every write with garbage bodies,
 * (D) a second account reading the first account's data, (E) response headers. Any 5xx is a bug; any leak is a bug.
 */
import { readFile } from "node:fs/promises";

const API = `http://localhost:${process.env.E2E_API_PORT ?? 4300}`;
const found: string[] = [];
const bug = (m: string) => { found.push(m); console.log("BUG  ", m); };

type R = { status: number; text: string; json: any; headers: Headers };
async function call(method: string, path: string, opts: { cookie?: string; body?: unknown; raw?: string; ctype?: string } = {}): Promise<R> {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = opts.cookie;
  let body: string | undefined;
  if (opts.raw !== undefined) { body = opts.raw; headers["content-type"] = opts.ctype ?? "application/json"; }
  else if (opts.body !== undefined) { body = JSON.stringify(opts.body); headers["content-type"] = "application/json"; }
  const res = await fetch(API + path, { method, headers, body, redirect: "manual" }).catch((e) => ({ status: 0, text: async () => String(e), headers: new Headers() }) as any);
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, text, json, headers: res.headers };
}
const cookieOf = (r: R) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");

// ---- accounts
const A = await call("POST", "/api/auth/login", { body: { email: "maya.chen@example.com", password: "demo-pass-2026" } });
const ca = cookieOf(A);
if (!ca) throw new Error("demo user cannot sign in; is `npm run serve` running with E2E_API_PORT?");
const bEmail = `probe.${Date.now()}@example.com`;
const B = await call("POST", "/api/auth/signup", { body: { email: bEmail, password: "probe-pass-2026", name: "Probe B" } });
const cb = cookieOf(B);

// ---- ids of user A's things
const apps = (await call("GET", "/api/applications", { cookie: ca })).json as any[];
const jobs = (await call("GET", "/api/jobs?limit=20", { cookie: ca })).json as any[];
const docs = (await call("GET", "/api/resume-docs", { cookie: ca })).json as any[];
const sessions = (await call("GET", "/api/auth/sessions", { cookie: ca })).json as any[];
const appId = apps[0].application.id as string;
const resumeId = (await call("GET", `/api/applications/${appId}`, { cookie: ca })).json?.resume?.id as string;
const jobId = jobs[0].job.id as string;
const docId = docs[0].id as string;
const UUID0 = "00000000-0000-0000-0000-000000000000";
const REAL: Record<string, string> = { id: appId, toolkit: "gmail", file: "x.woff2", version: "1" };

// ---- the route table, straight from the source
const src = (await readFile("apps/api/src/app.ts", "utf8")) + (await readFile("apps/api/src/resume-routes.ts", "utf8"));
const routes = [...src.matchAll(/app\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g)].map((m) => ({ method: m[1].toUpperCase(), path: m[2] }));
const PUBLIC = /^\/api\/(auth\/(signup|login|logout|forgot-password|reset-password|verify-email)|health|webhooks\/|auth\/session$)/;
// never replay these against the demo account while probing: they end the session or remove the account
const SKIP_WRITE = /^(DELETE \/api\/auth\/account|POST \/api\/auth\/logout|POST \/api\/auth\/sessions\/revoke-others|DELETE \/api\/settings\/model|POST \/api\/auth\/change-password)$/;
const fill = (p: string, id: string) => p.replace(/:(\w+)/g, (_, k) => (k === "id" ? id : REAL[k] ?? id)).replace("/*", "/x");

console.log(`${routes.length} routes found`);

// ---- A. signed out: everything private must say 401 and never 5xx
for (const r of routes) {
  if (PUBLIC.test(r.path) || r.path.startsWith("/mcp")) continue;
  const res = await call(r.method, fill(r.path, UUID0), { body: r.method === "GET" || r.method === "DELETE" ? undefined : {} });
  if (res.status >= 500) bug(`A signed out ${r.method} ${r.path} -> ${res.status} ${res.text.slice(0, 80)}`);
  else if (res.status !== 401) bug(`A signed out ${r.method} ${r.path} -> ${res.status} (expected 401)`);
}

// ---- B. signed in GETs with good, missing and hostile ids
const HOSTILE = ["not-a-uuid", UUID0, "../../etc/passwd", "%00", "a".repeat(600), "' OR 1=1 --", "<script>alert(1)</script>", "%2e%2e%2f"];
for (const r of routes.filter((x) => x.method === "GET" && !x.path.startsWith("/mcp"))) {
  const tries = r.path.includes(":") || r.path.includes("*") ? [fill(r.path, appId), ...HOSTILE.map((h) => fill(r.path, encodeURIComponent(h)))] : [r.path];
  for (const t of tries) {
    if (t.endsWith("/events")) continue; // server-sent stream, would hang
    const res = await call("GET", t, { cookie: ca });
    if (res.status >= 500) bug(`B GET ${t.slice(0, 90)} -> ${res.status} ${res.text.slice(0, 100)}`);
  }
}
for (const q of ["/api/jobs?limit=-1", "/api/jobs?limit=abc", "/api/jobs?limit=99999999", "/api/jobs?minScore=zzz", "/api/jobs?status=%00", "/api/jobs?q=" + "x".repeat(5000), "/api/applications?status=bogus", "/api/agent/activity?limit=-5", "/api/agent/activity?limit=NaN", "/api/companies?q=%27%22%3C", "/api/inbox?limit=-1"]) {
  const res = await call("GET", q, { cookie: ca });
  if (res.status >= 500) bug(`B GET ${q.slice(0, 80)} -> ${res.status} ${res.text.slice(0, 100)}`);
}

// ---- C. signed in writes with garbage bodies
const GARBAGE: [string, { body?: unknown; raw?: string; ctype?: string }][] = [
  ["empty object", { body: {} }], ["null", { raw: "null" }], ["array", { body: [] }], ["string", { raw: '"hello"' }], ["number", { raw: "42" }],
  ["bad json", { raw: "{not json" }], ["wrong content-type", { raw: "x=1", ctype: "text/plain" }], ["huge text", { body: { text: "x".repeat(3_000_000) } }],
  ["emoji + rtl", { body: { text: "\u{1F600}‮hello\u0000world", name: "\u{1F9D1}‍\u{1F4BB}", title: "\u0000" } }],
  ["xss", { body: { text: "<img src=x onerror=alert(1)>", name: "<script>alert(1)</script>", label: "\"><svg onload=alert(1)>" } }],
  ["sql", { body: { text: "'; DROP TABLE users; --", status: "x' OR '1'='1" } }],
  ["wrong types", { body: { cap: "abc", autoApplyDailyCap: -5, minScore: {}, titles: "notarray", lanes: 7, jobId: 12, url: 5 } }],
  ["prototype", { raw: '{"__proto__":{"admin":true},"constructor":{"prototype":{"x":1}}}' }],
];
for (const r of routes) {
  const key = `${r.method} ${r.path}`;
  if (r.method === "GET" || PUBLIC.test(r.path) || SKIP_WRITE.test(key) || r.path.startsWith("/mcp") || r.path.includes("download") || r.path.includes("events")) continue;
  const targets = r.path.includes(":") ? [fill(r.path, appId), fill(r.path, docId), fill(r.path, "not-a-uuid"), fill(r.path, UUID0)] : [r.path];
  for (const t of [...new Set(targets)]) {
    for (const [label, g] of GARBAGE) {
      if (label === "huge text" && t !== targets[0]) continue;
      const res = await call(r.method, t, { cookie: ca, ...g });
      if (res.status >= 500) bug(`C ${r.method} ${t.slice(0, 70)} with ${label} -> ${res.status} ${res.text.slice(0, 90)}`);
    }
  }
}

// ---- D. second account must not see or change the first account's data
const owned: [string, string][] = [
  ["GET", `/api/applications/${appId}`], ["POST", `/api/applications/${appId}/skip`], ["POST", `/api/applications/${appId}/approve-resume`], ["POST", `/api/applications/${appId}/retry`],
  ["GET", `/api/resumes/${resumeId}`], ["GET", `/api/resumes/${resumeId}/download?format=pdf`], ["GET", `/api/resumes/${resumeId}.pdf`], ["GET", `/api/resumes/${resumeId}.html`],
  ["GET", `/api/resume-docs/${docId}`], ["PUT", `/api/resume-docs/${docId}`], ["DELETE", `/api/resume-docs/${docId}`], ["POST", `/api/resume-docs/${docId}/duplicate`],
  ["GET", `/api/resume-docs/${docId}/versions`], ["GET", `/api/resume-docs/${docId}/download?format=pdf`], ["PUT", `/api/applications/${appId}/resume`],
  ["DELETE", `/api/auth/sessions/${sessions[0].id}`], ["GET", `/api/artifacts/${appId}/filled.png`],
];
for (const [m, p] of owned) {
  const res = await call(m, p, { cookie: cb, body: m === "GET" || m === "DELETE" ? undefined : {} });
  if (res.status < 400) bug(`D second account got ${res.status} on ${m} ${p.slice(0, 80)}`);
}
const bApps = (await call("GET", "/api/applications", { cookie: cb })).json;
const bGraph = (await call("GET", "/api/graph", { cookie: cb })).json;
const bInbox = (await call("GET", "/api/inbox", { cookie: cb })).json;
if (Array.isArray(bApps) && bApps.length) bug(`D second account lists ${bApps.length} application(s) it does not own`);
if (bGraph?.nodes?.length) bug(`D second account sees ${bGraph.nodes.length} graph node(s) it does not own`);
if (Array.isArray(bInbox) && bInbox.length) bug(`D second account sees ${bInbox.length} inbox message(s)`);
const aStill = (await call("GET", `/api/applications/${appId}`, { cookie: ca }));
if (aStill.status !== 200) bug(`D the owner lost access to their application after the second account's attempts (${aStill.status})`);

// ---- E. headers
const web = process.env.E2E_WEB_PORT ? `http://localhost:${process.env.E2E_WEB_PORT}` : "";
for (const [label, url] of [["api", `${API}/api/health`], ...(web ? [["web", `${web}/`], ["web login", `${web}/login`]] : [])] as [string, string][]) {
  const h = (await fetch(url, { redirect: "manual" })).headers;
  for (const need of ["x-content-type-options", "referrer-policy"]) if (!h.get(need)) bug(`E ${label} missing header ${need}`);
  if (label !== "api" && !h.get("content-security-policy") && !h.get("content-security-policy-report-only")) bug(`E ${label} has no Content-Security-Policy`);
  if (!h.get("x-frame-options") && !/frame-ancestors/.test(h.get("content-security-policy") ?? "")) bug(`E ${label} can be framed (no X-Frame-Options or frame-ancestors)`);
}
const sc = (A.headers.getSetCookie?.() ?? []).join(" | ");
if (!/HttpOnly/i.test(sc)) bug("E session cookie is not HttpOnly");
if (!/SameSite/i.test(sc)) bug("E session cookie has no SameSite");

console.log(found.length ? `\n${found.length} problem(s) found` : "\nno problems found");
process.exit(found.length ? 1 : 0);
