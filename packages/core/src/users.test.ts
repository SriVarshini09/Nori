import { describe, expect, it } from "vitest";
import { openTestDb } from "./db/client.js";
import { advanceOnboarding, authenticate, createPasswordUser, ensureDefaultUser, getProfile, nextOnboardingStep } from "./users.js";

describe("users", () => {
  it("creates password users, rejects duplicates, authenticates", async () => {
    const db = await openTestDb();
    const u = await createPasswordUser(db, { email: " Sam@Example.com ", password: "hunter22!", name: "Sam Lee" });
    expect(u?.email).toBe("sam@example.com");
    expect(u?.passwordHash).toMatch(/^scrypt\$/);
    expect((await getProfile(db, u!.id)).fullName).toBe("Sam Lee");
    expect((await getProfile(db, u!.id)).onboarding).toEqual({ step: "resume" });
    expect((await getProfile(db, u!.id)).eeo).toEqual({ gender: "decline", race: "decline", veteran: "decline", disability: "decline" });
    expect(await createPasswordUser(db, { email: "sam@example.com", password: "another1" })).toBeNull();
    expect((await authenticate(db, "SAM@example.com", "hunter22!"))?.id).toBe(u!.id);
    expect(await authenticate(db, "sam@example.com", "wrong-pass")).toBeNull();
    expect(await authenticate(db, "nobody@example.com", "hunter22!")).toBeNull();
    const d = await ensureDefaultUser(db, "dev@example.com");
    expect(await authenticate(db, "dev@example.com", "")).toBeNull(); // passwordless users cannot log in
    expect((await ensureDefaultUser(db, "dev@example.com")).id).toBe(d.id);
  });

  it("advances onboarding without moving backwards", () => {
    expect(nextOnboardingStep("resume")).toBe("contact");
    expect(nextOnboardingStep("done")).toBe("done");
    expect(advanceOnboarding({ step: "resume" }, "resume")).toEqual({ step: "contact", completedAt: null });
    expect(advanceOnboarding({ step: "screening" }, "contact").step).toBe("screening");
    const now = new Date("2026-01-01T00:00:00Z");
    expect(advanceOnboarding({ step: "integrations" }, "integrations", now)).toEqual({ step: "done", completedAt: now.toISOString() });
    expect(advanceOnboarding({ step: "done", completedAt: "x" }, "contact")).toEqual({ step: "done", completedAt: "x" });
  });
});
