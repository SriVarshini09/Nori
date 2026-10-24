import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ensureDefaultUser, openTestDb, type Db } from "@jobgraph/core";
import { createApp } from "./app.js";

let db: Db;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  db = await openTestDb();
  app = createApp(db, { mcp: false, defaultUserEmail: "me@example.com", notify: async () => undefined });
  await ensureDefaultUser(db, "me@example.com");
});
afterEach(() => vi.unstubAllEnvs());

const post = async () => {
  const res = await app.request("/api/settings/error-reporting/test", { method: "POST" });
  return { status: res.status, json: await res.json() as { error?: string } };
};

describe("error reporting wiring check", () => {
  it("is refused for anyone but the operator account", async () => {
    vi.stubEnv("MCP_USER_EMAIL", "");
    expect((await post()).status).toBe(403);
    vi.stubEnv("MCP_USER_EMAIL", "someone-else@example.com");
    expect((await post()).status).toBe(403);
  });

  it("tells the operator plainly when Sentry is not set up", async () => {
    vi.stubEnv("MCP_USER_EMAIL", "Me@Example.com"); // case-insensitive
    const r = await post();
    expect(r.status).toBe(503);
    expect(r.json.error).toMatch(/SENTRY_DSN_API/);
  });
});
