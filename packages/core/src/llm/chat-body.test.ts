import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adaptBodyToRefusal, chatBody, isOpenAIReasoningModel, llmFromSpec } from "./index.js";

const msgs = [{ role: "user", content: "hi" }];
const base = { messages: msgs, json: false, maxTokens: 1000, mode: "openai-compatible" as const };

describe("chatBody", () => {
  it("sends the classic parameters to ordinary OpenAI-compatible models", () => {
    const b = chatBody({ ...base, model: "gpt-4.1", baseUrl: "https://api.openai.com/v1" });
    expect(b).toMatchObject({ model: "gpt-4.1", temperature: 0.2, max_tokens: 1000 });
    expect(b).not.toHaveProperty("max_completion_tokens");
    expect(b).not.toHaveProperty("reasoning_effort");
    expect(chatBody({ ...base, model: "gpt-5", baseUrl: "https://example.com/v1" })).toMatchObject({ temperature: 0.2, max_tokens: 1000 });
  });

  it("shapes the request for OpenAI's reasoning models: no temperature, max_completion_tokens, light reasoning", () => {
    for (const model of ["gpt-5", "gpt-5-mini", "gpt-5.1", "o3", "o4-mini"]) {
      const b = chatBody({ ...base, model, baseUrl: "https://api.openai.com/v1", json: true });
      expect(b, model).not.toHaveProperty("temperature");
      expect(b, model).not.toHaveProperty("max_tokens");
      expect(b, model).toMatchObject({ max_completion_tokens: 1000, response_format: { type: "json_object" } });
    }
    expect(chatBody({ ...base, model: "gpt-5", baseUrl: "https://api.openai.com/v1" })).toMatchObject({ reasoning_effort: "minimal" });
    expect(chatBody({ ...base, model: "gpt-5", baseUrl: "https://api.openai.com/v1", effort: "medium" })).toMatchObject({ reasoning_effort: "low" });
    expect(chatBody({ ...base, model: "o3", baseUrl: "https://api.openai.com/v1" })).toMatchObject({ reasoning_effort: "low" }); // the o-series has no "minimal"
  });

  it("recognises only OpenAI's own hosts and model families", () => {
    expect(isOpenAIReasoningModel("https://api.openai.com/v1", "gpt-5-mini")).toBe(true);
    expect(isOpenAIReasoningModel("https://api.openai.com/v1", "gpt-4.1")).toBe(false);
    expect(isOpenAIReasoningModel("https://openrouter.ai/api/v1", "gpt-5")).toBe(false);
    expect(isOpenAIReasoningModel("https://evil-openai.com.example.net/v1", "gpt-5")).toBe(false);
    expect(isOpenAIReasoningModel("not a url", "gpt-5")).toBe(false);
  });

  it("leaves a tiny cap out entirely, and keeps Ollama's reasoning switch", () => {
    expect(chatBody({ ...base, maxTokens: 16, model: "gpt-5", baseUrl: "https://api.openai.com/v1" })).not.toHaveProperty("max_completion_tokens");
    expect(chatBody({ ...base, mode: "ollama", model: "qwen3:8b", baseUrl: "http://localhost:11434/v1" })).toMatchObject({ reasoning_effort: "none", max_tokens: 1000 });
  });
});

describe("adaptBodyToRefusal", () => {
  const refusal = (param: string, message = "x") => JSON.stringify({ error: { message, type: "invalid_request_error", param, code: "unsupported_parameter" } });
  const body = { model: "m", messages: msgs, temperature: 0.2, max_tokens: 500, response_format: { type: "json_object" } };

  it("swaps max_tokens for max_completion_tokens, and back", () => {
    const a = adaptBodyToRefusal(body, refusal("max_tokens"))!;
    expect(a).toMatchObject({ max_completion_tokens: 500 });
    expect(a).not.toHaveProperty("max_tokens");
    expect(adaptBodyToRefusal(a, refusal("max_completion_tokens"))).toMatchObject({ max_tokens: 500 });
  });

  it("drops a parameter the provider refuses, reading its name from the message when `param` is missing", () => {
    expect(adaptBodyToRefusal(body, refusal("temperature"))).not.toHaveProperty("temperature");
    expect(adaptBodyToRefusal(body, refusal("response_format"))).not.toHaveProperty("response_format");
    expect(adaptBodyToRefusal(body, JSON.stringify({ error: { message: "Unsupported value: 'temperature' does not support 0.2" } }))).not.toHaveProperty("temperature");
  });

  it("gives up (null) on anything it should not paper over", () => {
    expect(adaptBodyToRefusal(body, refusal("model"))).toBeNull(); // a wrong model name is the user's to fix
    expect(adaptBodyToRefusal(body, "plain text error")).toBeNull();
    expect(adaptBodyToRefusal(body, refusal("top_p"))).toBeNull(); // not sent, so nothing to fix
    expect(adaptBodyToRefusal({ model: "m", messages: msgs }, refusal("temperature"))).toBeNull();
  });
});

describe("a strict provider end to end", () => {
  let server: Server;
  let url: string;
  const seen: Record<string, unknown>[] = [];

  beforeAll(async () => {
    // Behaves like OpenAI's gpt-5: refuses `temperature` and `max_tokens`, accepts the rest.
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const b = JSON.parse(raw) as Record<string, unknown>;
        seen.push(b);
        const refuse = (param: string) => res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: `Unsupported parameter: '${param}'`, type: "invalid_request_error", param } }));
        if ("temperature" in b) return refuse("temperature");
        if ("max_tokens" in b) return refuse("max_tokens");
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ choices: [{ message: { content: "ready" } }] }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("fixes the request after the refusals and gets an answer, without the caller noticing", async () => {
    const llm = llmFromSpec({ mode: "openai-compatible", baseUrl: url, model: "strict-model", apiKey: "k" });
    seen.length = 0;
    const out = await llm.text({ system: "s", prompt: "p", maxTokens: 800, timeoutMs: 10_000 });
    expect(out).toBe("ready");
    expect(seen.length).toBe(3); // refused temperature, refused max_tokens, accepted
    expect(seen[2]).toMatchObject({ max_completion_tokens: 800 });
    expect(seen[2]).not.toHaveProperty("temperature");
  });
});
