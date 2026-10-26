import { beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type Db } from "../db/client.js";
import { ensureDefaultUser, getProfile } from "../users.js";
import { clearSavedAnswers, deleteSavedAnswer, isRememberable, rememberAnswers, savedKey, savedValues, upsertSavedAnswer } from "./saved-answers.js";
import { makeAnswerQuestion } from "./answers.js";
import type { FormField } from "../contracts.js";

let db: Db;
let userId: string;
beforeAll(async () => {
  db = await openTestDb();
  userId = (await ensureDefaultUser(db)).id;
});

const profile = { fullName: "Ada Lovelace", firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", phone: "", workAuth: { authorizedUS: true, needsSponsorship: false } } as never;
const text = (label: string, extra: Partial<FormField> = {}): FormField => ({ label, kind: "text", required: true, selector: "#x", ...extra } as FormField);

describe("saved answers", () => {
  it("keeps short personal answers and drops job-specific, long and special ones", () => {
    expect(isRememberable("What is your major or area of study?", "AI", "text")).toBe(true);
    expect(isRememberable("Why do you want to work here?", "Because", "text")).toBe(false);
    expect(isRememberable("Cover letter", "Dear team", "textarea")).toBe(false);
    expect(isRememberable("Anything else?", "x".repeat(300), "text")).toBe(false);
    expect(isRememberable("Verification code", "123456", "verification_code")).toBe(false);
    expect(isRememberable("Location (City)", "   ", "text")).toBe(false);
  });

  it("stores answers on the profile and reads them back by normalised label", async () => {
    const n = await rememberAnswers(db, userId, {
      "Location (City) *": "San Francisco", "Why do you want to work here?": "Robots", "Highest degree": "Master's",
    }, { "Highest degree": "select" });
    expect(n).toBe(2);
    const saved = savedValues((await getProfile(db, userId)).preferences);
    expect(saved[savedKey("Location (City)")]).toBe("San Francisco");
    expect(saved[savedKey("Highest degree")]).toBe("Master's");
    expect(Object.keys(saved).some((k) => k.includes("why do you"))).toBe(false);
  });

  it("the answer generator fills a repeated question from what was saved, without asking", async () => {
    const ask = makeAnswerQuestion({ profile, evidence: [], jobTitle: "ML Engineer", companyName: "Acme", saved: { [savedKey("What is your major or area of study?")]: "AI" } });
    expect(await ask(text("What is your major or area of study? *"), "")).toBe("AI");
  });

  it("reuses a saved choice only when the same option is offered", async () => {
    const saved = { [savedKey("Highest degree")]: "Master's" };
    const ask = makeAnswerQuestion({ profile, evidence: [], jobTitle: "ML Engineer", companyName: "Acme", saved });
    expect(await ask(text("Highest degree", { kind: "select", options: ["Bachelor's", "master's", "PhD"] }), "")).toBe("master's");
  });

  it("supports upserting, deleting, and clearing saved answers", async () => {
    const afterUpsert = await upsertSavedAnswer(db, userId, "Preferred office location", "New York, NY");
    expect(afterUpsert[savedKey("Preferred office location")]).toEqual({
      label: "Preferred office location",
      value: "New York, NY",
    });

    const afterDelete = await deleteSavedAnswer(db, userId, "Preferred office location");
    expect(afterDelete[savedKey("Preferred office location")]).toBeUndefined();

    const afterClear = await clearSavedAnswers(db, userId);
    expect(afterClear).toEqual({});
  });
});
