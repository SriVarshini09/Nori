import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { llmFromSpec } from "./index.js";

/** A "model endpoint" that redirects to a private address, and a target that would answer if the redirect were followed. */
let hits = 0;
let server: http.Server;
let base = "";
beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url?.startsWith("/secret")) { hits++; res.end('{"choices":[{"message":{"content":"metadata"}}]}'); return; }
    res.writeHead(302, { location: `${base}/secret` }).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("model endpoints", () => {
  it("never follow a redirect", async () => {
    const llm = llmFromSpec({ mode: "openai-compatible", model: "m", baseUrl: `${base}/v1`, apiKey: "k" });
    await expect(llm.text({ system: "s", prompt: "p", maxTokens: 5 })).rejects.toThrow(/redirect/);
    expect(hits).toBe(0);
  });
});
