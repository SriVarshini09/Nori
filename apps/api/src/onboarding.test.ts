import { beforeAll, describe, expect, it } from "vitest";
import { openTestDb } from "@jobgraph/core";
import { createApp } from "./app.js";

let app: ReturnType<typeof createApp>;
let cookie = "";

async function put(step: string, data?: unknown) {
  const res = await app.request("/api/onboarding", { method: "PUT", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ step, data }) });
  return { status: res.status, json: (await res.json()) as any };
}

beforeAll(async () => {
  app = createApp(await openTestDb(), { mcp: false, defaultUserEmail: null, rateLimit: false });
  const s = await app.request("/api/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "ob@example.com", password: "onboard-pass-1" }) });
  cookie = (s.headers.get("set-cookie") ?? "").split(";")[0];
  await put("resume");
  await put("contact", { fullName: "Ob User", city: "Austin", state: "TX", country: "US" });
  await put("authorization", { workAuth: { authorizedUS: true, needsSponsorship: false, status: "citizen" }, willingToRelocate: false });
});

describe("screening step", () => {
  it("lets a user skip the salary: a blank form field must not block onboarding", async () => {
    // exactly what the dashboard sent before the fix when the salary box was empty
    const r = await put("screening", { salaryExpectation: { amount: null, currency: "USD", period: "year" }, noticePeriodWeeks: null, over18: true, eeo: { gender: "decline" } });
    expect(r.status).toBe(200);
    expect(r.json.step).toBe("preferences");
    expect(r.json.profile.salaryExpectation).toBeNull();
  });

  it("accepts null, and keeps a real amount", async () => {
    expect((await put("screening", { salaryExpectation: null })).json.profile.salaryExpectation).toBeNull();
    const r = await put("screening", { salaryExpectation: { amount: 150000, currency: "USD", period: "year" }, over18: true });
    expect(r.status).toBe(200);
    expect(r.json.profile.salaryExpectation).toEqual({ amount: 150000, currency: "USD", period: "year" });
  });

  it("still rejects nonsense", async () => {
    expect((await put("screening", { salaryExpectation: { amount: -5 } })).status).toBe(400);
    expect((await put("screening", { salaryExpectation: { amount: "lots" } })).status).toBe(400);
    expect((await put("screening", { salaryExpectation: { amount: 1, period: "fortnight" } })).status).toBe(400);
  });
});
