import { describe, expect, it, vi } from "vitest";
import { runnerEvents, type RunEventRow } from "@jobgraph/core";
import { captureError, reportRunEvent, sentryEnabled, sentrySelfTest, watchRunner } from "./sentry.js";

const ev = (level: RunEventRow["level"], step = "filling", message = "Driver gave up: CAPTCHA"): RunEventRow => ({
  id: "e1", applicationId: "app-1", ts: new Date().toISOString(), level, step, message, data: { pending: 2 },
});

describe("sentry wiring without a DSN", () => {
  it("is off, and every helper is a safe no-op", async () => {
    expect(sentryEnabled()).toBe(false);
    expect(() => captureError(new Error("x"), { ref: "abc", method: "GET", path: "/api/x", userId: "u" })).not.toThrow();
    expect(() => captureError("not an error object")).not.toThrow();
    expect(await sentrySelfTest()).toBe(false);
    expect(typeof watchRunner()).toBe("function");
  });
});

describe("runner events", () => {
  it("forwards only error-level events, with the step and application", () => {
    const sink = vi.fn();
    reportRunEvent(ev("info"), sink);
    reportRunEvent(ev("warn"), sink);
    expect(sink).not.toHaveBeenCalled();
    reportRunEvent(ev("error"), sink);
    expect(sink).toHaveBeenCalledWith("filling: Driver gave up: CAPTCHA", { applicationId: "app-1", step: "filling", data: { pending: 2 } });
  });

  it("a sink that throws never breaks the run", () => {
    expect(() => reportRunEvent(ev("error"), () => { throw new Error("sentry down"); })).not.toThrow();
  });

  it("watches the in-process bus and can stop", () => {
    const sink = vi.fn();
    const stop = watchRunner(sink);
    runnerEvents.emit("event", ev("error", "submitting", "Step failed: timeout"));
    runnerEvents.emit("event", ev("info"));
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0]).toBe("submitting: Step failed: timeout");
    stop();
    runnerEvents.emit("event", ev("error"));
    expect(sink).toHaveBeenCalledTimes(1);
  });
});
