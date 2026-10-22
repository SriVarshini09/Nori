import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MODEL_PRESETS, assertModelUrlAllowed, listProviderModels, openTestDb, presetIdFor, resolveUserModels, getUserCredentials, type Db } from "@jobgraph/core";
import { createApp } from "./app.js";

let db: Db;
let app: ReturnType<typeof createApp>;
let server: Server;
let base: string;

/** A stand-in provider: GET /models needs the bearer "good-key" and answers a list; anything else is refused. */
beforeAll(async () => {
  server = createServer((req, res) => {
    const ok = req.headers.authorization === "Bearer good-key" || req.headers["x-api-key"] === "good-key";
    if (req.url?.startsWith("/models") || req.url?.startsWith("/v1/models")) {
      if (!ok) { res.writeHead(401).end("no"); return; }
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [{ id: "zeta-large" }, { id: "alpha-mini" }, { id: "models/gemini-x" }, { id: "alpha-mini" }] }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  db = await openTestDb();
  app = createApp(db, { mcp: false, rateLimit: false, defaultUserEmail: "me@example.com" });
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

async function call(method: string, url: string, body?: unknown) {
  const res = await app.request(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

const withProduction = async <T,>(fn: () => Promise<T>): Promise<T> => {
  const saved = { NODE_ENV: process.env.NODE_ENV, ALLOW: process.env.ALLOW_PRIVATE_MODEL_URLS };
  process.env.NODE_ENV = "production"; delete process.env.ALLOW_PRIVATE_MODEL_URLS;
  try { return await fn(); } finally {
    for (const [k, v] of [["NODE_ENV", saved.NODE_ENV], ["ALLOW_PRIVATE_MODEL_URLS", saved.ALLOW]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
};

describe("presets", () => {
  it("is a clean list: unique ids, hosted ones public https, local ones flagged", () => {
    const ids = MODEL_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of MODEL_PRESETS) {
      if (!p.local && p.baseUrl) expect(p.baseUrl).toMatch(/^https:\/\//);
      if (p.local) expect(p.needsKey).toBe(false);
      expect(p.label.length).toBeGreaterThan(2);
    }
    expect(ids).toEqual(expect.arrayContaining(["openai", "anthropic", "gemini", "openrouter", "ollama", "lmstudio", "custom"]));
  });

  it("recognises the preset behind a stored provider and URL", () => {
    expect(presetIdFor("openai-compatible", "https://api.openai.com/v1/")).toBe("openai");
    expect(presetIdFor("openai-compatible", "https://api.groq.com/openai/v1")).toBe("groq");
    expect(presetIdFor("openai-compatible", "https://my-gateway.example.com/v1")).toBe("custom");
    expect(presetIdFor("anthropic", null)).toBe("anthropic");
    expect(presetIdFor("ollama", "http://localhost:11434")).toBe("ollama");
    expect(presetIdFor(null, null)).toBeNull();
  });

  it("serves the list and the server's rules", async () => {
    const r = await call("GET", "/api/settings/model/presets");
    expect(r.status).toBe(200);
    expect(r.json.presets.length).toBe(MODEL_PRESETS.length);
    expect(r.json.strictUrls).toBe(false);
    expect((await withProduction(() => call("GET", "/api/settings/model/presets"))).json.strictUrls).toBe(true);
  });
});

describe("listing a provider's models", () => {
  it("returns sorted, de-duplicated ids with the typed key", async () => {
    expect(await listProviderModels({ provider: "openai-compatible", baseUrl: base, apiKey: "good-key" })).toEqual(["alpha-mini", "gemini-x", "zeta-large"]);
    expect(await listProviderModels({ provider: "ollama", baseUrl: base, apiKey: null }).catch((e: Error) => e.message)).toMatch(/rejected|HTTP/);
  });

  it("explains a rejected key and a dead address in plain words", async () => {
    await expect(listProviderModels({ provider: "openai-compatible", baseUrl: base, apiKey: "wrong" })).rejects.toThrow(/rejected the API key/);
    const closed = createServer(); // a port that was just free and now has nothing on it
    await new Promise<void>((r) => closed.listen(0, "127.0.0.1", r));
    const deadPort = (closed.address() as AddressInfo).port;
    await new Promise<void>((r) => closed.close(() => r()));
    await expect(listProviderModels({ provider: "openai-compatible", baseUrl: `http://127.0.0.1:${deadPort}`, apiKey: "x" })).rejects.toThrow(/Nothing is listening/);
    await expect(listProviderModels({ provider: "openai-compatible", baseUrl: null, apiKey: "x" })).rejects.toThrow(/base URL/);
  });

  it("works through the API, using the saved key when none is typed, and never echoes a key", async () => {
    const typed = await call("POST", "/api/settings/model/models", { provider: "openai-compatible", baseUrl: base, apiKey: "good-key" });
    expect(typed.status).toBe(200);
    expect(typed.json.models).toContain("alpha-mini");
    expect(JSON.stringify(typed.json)).not.toContain("good-key");

    expect((await call("PUT", "/api/settings/model", { provider: "openai-compatible", baseUrl: base, apiKey: "good-key", qualityModel: "zeta-large" })).status).toBe(200);
    const saved = await call("POST", "/api/settings/model/models", { provider: "openai-compatible" });
    expect(saved.json.models).toContain("zeta-large");
    expect((await call("GET", "/api/settings/model")).json).toMatchObject({ preset: "custom", hasKey: true });

    const bad = await call("POST", "/api/settings/model/models", { provider: "openai-compatible", baseUrl: base, apiKey: "wrong" });
    expect(bad.status).toBe(422);
    expect(bad.json.error).toMatch(/rejected the API key/);
  });
});

describe("what a shared server will call", () => {
  it("lets private addresses through in development and refuses them in production", async () => {
    await expect(assertModelUrlAllowed("http://127.0.0.1:11434")).resolves.toBeUndefined();
    await withProduction(async () => {
      for (const u of ["http://127.0.0.1:11434", "http://localhost:1234/v1", "http://169.254.169.254/latest", "http://10.0.0.8/v1"]) {
        await expect(assertModelUrlAllowed(u), u).rejects.toThrow(/public model endpoints/);
      }
      await expect(assertModelUrlAllowed("https://93.184.216.34/v1")).resolves.toBeUndefined();
    });
    process.env.NODE_ENV = "production"; process.env.ALLOW_PRIVATE_MODEL_URLS = "1";
    try { await expect(assertModelUrlAllowed("http://127.0.0.1:11434")).resolves.toBeUndefined(); } finally { process.env.NODE_ENV = "test"; delete process.env.ALLOW_PRIVATE_MODEL_URLS; }
  });

  it("refuses to save, list or use a private model endpoint in production", async () => {
    await withProduction(async () => {
      const put = await call("PUT", "/api/settings/model", { provider: "openai-compatible", baseUrl: "http://169.254.169.254/v1", apiKey: "k" });
      expect(put.status).toBe(422);
      expect(put.json.error).toMatch(/public model endpoints/);
      expect((await call("PUT", "/api/settings/model", { provider: "ollama", baseUrl: "http://localhost:11434" })).status).toBe(422);
      expect((await call("POST", "/api/settings/model/models", { provider: "openai-compatible", baseUrl: base, apiKey: "good-key" })).status).toBe(422);
    });
  });

  it("ignores an already stored private endpoint at call time and says so in the connection test", async () => {
    // saved while the server was in development mode, then the server moved to production
    expect((await call("PUT", "/api/settings/model", { provider: "openai-compatible", baseUrl: base, apiKey: "good-key", qualityModel: "zeta-large", bulkModel: "alpha-mini" })).status).toBe(200);
    const me = (await call("GET", "/api/me")).json.user.id as string;
    expect((await resolveUserModels(db, me)).quality.model).toBe("zeta-large"); // a private URL is "local": used in development
    await withProduction(async () => {
      expect((await resolveUserModels(db, me)).quality.model).not.toBe("zeta-large");
      const t = await call("POST", "/api/settings/model/test");
      expect(t.json.ok).toBe(false);
      expect(t.json.error).toMatch(/public model endpoints/);
    });
    expect((await getUserCredentials(db, me))?.baseUrl).toBe(base); // not deleted, only not called
  });
});
