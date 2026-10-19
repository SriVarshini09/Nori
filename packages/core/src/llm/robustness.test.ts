import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { estimateTokens, llmFromSpec, type LLMSpec } from "./index.js";

/** A throwaway OpenAI-compatible server. `reply` null means "never answer" (a stalled model). */
async function serve(reply: string | null) {
  const bodies: Record<string, unknown>[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      bodies.push(raw ? JSON.parse(raw) : {});
      if (reply === null) return; // hang
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content: reply } }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  return { url, bodies, close: () => { server.closeAllConnections(); server.close(); } };
}

const schema = z.object({ ok: z.boolean() });
const spec = (mode: LLMSpec["mode"], baseUrl: string): LLMSpec => ({ mode, baseUrl, model: "test-model", apiKey: "k" });
let closers: (() => void)[] = [];
afterEach(() => { closers.forEach((c) => c()); closers = []; delete process.env.OLLAMA_NUM_CTX; });

describe("llm call deadline", () => {
  it("gives up on a stalled model so the caller can fall back", async () => {
    const s = await serve(null);
    closers.push(s.close);
    const llm = llmFromSpec(spec("ollama", s.url));
    const started = Date.now();
    await expect(llm.json({ name: "t", system: "s", prompt: "p", schema, timeoutMs: 400 })).rejects.toThrow(/did not answer within/);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("applies the deadline to text calls that set none", async () => {
    const s = await serve(null);
    closers.push(s.close);
    process.env.LLM_TIMEOUT_MS = "1000";
    try {
      const llm = llmFromSpec(spec("openai-compatible", s.url));
      await expect(llm.text({ system: "s", prompt: "p" })).rejects.toThrow(/did not answer within 1 s/);
    } finally { delete process.env.LLM_TIMEOUT_MS; }
  });
});

describe("reasoning effort for local models", () => {
  it("turns reasoning off for extraction and down for drafting on Ollama only", async () => {
    const s = await serve('{"ok": true}');
    closers.push(s.close);
    const local = llmFromSpec(spec("ollama", s.url));
    await local.json({ name: "t", system: "s", prompt: "p", schema });
    await local.json({ name: "t", system: "s", prompt: "p", schema, effort: "medium" });
    await local.json({ name: "t", system: "s", prompt: "p", schema, effort: "high" });
    expect(s.bodies.map((b) => b.reasoning_effort)).toEqual(["none", "low", "medium"]);

    const hosted = llmFromSpec(spec("openai-compatible", s.url));
    await hosted.json({ name: "t", system: "s", prompt: "p", schema });
    expect(s.bodies[3]).not.toHaveProperty("reasoning_effort");
  });
});

describe("local context window", () => {
  it("refuses a prompt the model would cut off, without calling it", async () => {
    const s = await serve('{"ok": true}');
    closers.push(s.close);
    process.env.OLLAMA_NUM_CTX = "1000";
    const llm = llmFromSpec(spec("ollama", s.url));
    await expect(llm.json({ name: "t", system: "s", prompt: "x".repeat(6000), schema })).rejects.toThrow(/1000-token context.*OLLAMA_CONTEXT_LENGTH/);
    expect(s.bodies).toHaveLength(0);
    // a prompt that fits goes through (the reply budget and the schema count against the window too)
    process.env.OLLAMA_NUM_CTX = "4000";
    await expect(llm.json({ name: "t", system: "s", prompt: "short", schema })).resolves.toEqual({ ok: true });
  });

  it("estimates about three characters per token", () => {
    expect(estimateTokens([{ content: "a".repeat(300) }, { content: "b".repeat(300) }])).toBe(200);
  });
});
