import { describe, expect, it } from "vitest";
import { checkEnv, integrationReport } from "./env-check.js";

const GOOD_PROD = {
  NODE_ENV: "production", DATABASE_URL: "postgres://u:p@host/db", WEB_URL: "https://app.example.com", CREDENTIALS_KEY: Buffer.alloc(32, 1).toString("base64"),
  MCP_TOKEN: "t", RESEND_API_KEY: "re_x", EMAIL_FROM: "Nori <hi@example.com>", ARTIFACTS_DIR: "/data/artifacts",
};

describe("checkEnv", () => {
  it("accepts a development environment with nothing set", () => {
    expect(checkEnv({})).toEqual({ errors: [], warnings: [] });
  });

  it("accepts a complete production environment without noise", () => {
    expect(checkEnv(GOOD_PROD)).toEqual({ errors: [], warnings: [] });
  });

  it("stops a production boot that would be insecure or unreachable", () => {
    const r = checkEnv({ NODE_ENV: "production", WEB_URL: "http://localhost:3000", DEFAULT_USER_EMAIL: "dev@jobgraph.local" });
    expect(r.errors.join("\n")).toMatch(/DATABASE_URL/);
    expect(r.errors.join("\n")).toMatch(/WEB_URL/);
    expect(r.errors.join("\n")).toMatch(/CREDENTIALS_KEY/);
    expect(r.errors.join("\n")).toMatch(/DEFAULT_USER_EMAIL/);
  });

  it("rejects a malformed encryption key and port in any environment", () => {
    const r = checkEnv({ CREDENTIALS_KEY: "too-short", API_PORT: "abc", WEB_URL: "not a url" });
    expect(r.errors).toHaveLength(3);
  });

  it("warns, but does not stop, for missing optional production pieces", () => {
    const { RESEND_API_KEY: _a, ARTIFACTS_DIR: _b, MCP_TOKEN: _c, ...rest } = GOOD_PROD;
    const r = checkEnv(rest);
    expect(r.errors).toEqual([]);
    expect(r.warnings.join("\n")).toMatch(/RESEND_API_KEY/);
    expect(r.warnings.join("\n")).toMatch(/ARTIFACTS_DIR/);
    expect(r.warnings.join("\n")).toMatch(/MCP_TOKEN/);
    expect(checkEnv({ ...GOOD_PROD, ALLOW_REAL_SUBMIT: "true" }).warnings.join("\n")).toMatch(/submitted for real/);
    expect(checkEnv({ RESEND_API_KEY: "x" }).warnings.join("\n")).toMatch(/EMAIL_FROM/);
  });
});

describe("integrationReport", () => {
  it("never calls a service verified, and names exactly what is missing", () => {
    const r = integrationReport({ COMPOSIO_API_KEY: "k", RESEND_API_KEY: "k" });
    expect(r.map((x) => x.state)).not.toContain("verified");
    const by = Object.fromEntries(r.map((x) => [x.id, x]));
    expect(by.composio).toMatchObject({ state: "configured", needs: [] });
    expect(by.email).toMatchObject({ state: "blocked", needs: ["EMAIL_FROM"] });
    expect(by.telegram).toMatchObject({ state: "blocked", needs: ["TELEGRAM_BOT_TOKEN"] });
    expect(by.whatsapp.needs).toEqual(["WHATSAPP_TOKEN", "WHATSAPP_PHONE_ID", "WHATSAPP_VERIFY_TOKEN"]);
    expect(by.llm.state).toBe("blocked");
    for (const x of r) expect(x.without.length).toBeGreaterThan(10);
  });

  it("treats a hosted model as configured once a key and provider exist", () => {
    expect(integrationReport({ HOSTED_LLM_API_KEY: "k", HOSTED_LLM_PROVIDER: "cline" }).find((x) => x.id === "llm")!.state).toBe("configured");
    expect(integrationReport({ ANTHROPIC_API_KEY: "k" }).find((x) => x.id === "llm")!.state).toBe("configured");
    expect(integrationReport({ HOSTED_LLM_API_KEY: "k" }).find((x) => x.id === "llm")!.state).toBe("blocked");
  });
});
