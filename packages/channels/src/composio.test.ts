import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
vi.mock("@composio/core", () => ({ Composio: class { create = create; } }));

import { executeTool, isNoConnectionError, resetComposioCache } from "./composio";

const NO_CONNECTION = '400 {"error":{"message":"No active connection found for toolkit(s) \'gmail\' in this session.","slug":"ToolRouterV2_NoActiveConnection"}}';

describe("executeTool", () => {
  beforeEach(() => {
    process.env.COMPOSIO_API_KEY = "ak_test";
    resetComposioCache();
    create.mockReset();
  });

  it("recognises the no-connection error", () => {
    expect(isNoConnectionError(NO_CONNECTION)).toBe(true);
    expect(isNoConnectionError("rate limited")).toBe(false);
  });

  it("retries once on a fresh session when a cached one predates the connection", async () => {
    const stale = { execute: vi.fn().mockRejectedValue(new Error(NO_CONNECTION)) };
    const fresh = { execute: vi.fn().mockResolvedValue({ data: { messages: [1, 2] } }) };
    create.mockResolvedValueOnce(stale).mockResolvedValueOnce(fresh);
    const data = await executeTool("u1", "GMAIL_FETCH_EMAILS");
    expect(data).toEqual({ messages: [1, 2] });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("gives up after one retry", async () => {
    const stale = { execute: vi.fn().mockRejectedValue(new Error(NO_CONNECTION)) };
    create.mockResolvedValue(stale);
    await expect(executeTool("u1", "GMAIL_FETCH_EMAILS")).rejects.toThrow(/No active connection/);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("does not retry other errors", async () => {
    const s = { execute: vi.fn().mockResolvedValue({ error: "boom" }) };
    create.mockResolvedValue(s);
    await expect(executeTool("u1", "X")).rejects.toThrow(/boom/);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
