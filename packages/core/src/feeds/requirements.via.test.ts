import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { openTestDb, type Db } from "../db/client.js";
import { jobs } from "../db/schema.js";
import { setLLM, type LLM } from "../llm/index.js";
import { upsertJobs } from "./normalize.js";
import { ensureRequirements, extractRequirements } from "./requirements.js";

const JD = "We build UIs with React and TypeScript.\n\nRequirements\n- 4+ years of experience\n- React and TypeScript";

/** A model that answers every extraction with fixed requirements and counts its calls. */
function fakeLLM(behaviour: "ok" | "fail"): LLM & { calls: number } {
  const llm = {
    calls: 0, provider: "openai-compatible" as const, model: "fake", available: true, mode: "ollama" as const,
    async json() {
      llm.calls++;
      if (behaviour === "fail") throw new Error("model timed out");
      return {
        skills: [{ name: "React", required: true }], seniority: "senior", roleFamily: "frontend", yearsMin: 4,
        mustHaves: ["React"], niceToHaves: [], disqualifiers: [], keywords: ["React"], summary: "from the model",
      };
    },
    async text() { return ""; },
  };
  return llm as unknown as LLM & { calls: number };
}

let db: Db;
let n = 0;
async function newJob(): Promise<string> {
  const { ids } = await upsertJobs(db, [{
    companyName: "Acme", atsType: "web", externalId: `req-${n++}`, title: "Senior Frontend Engineer", remote: true,
    descriptionText: JD, applyUrl: "https://example.com/apply", discoveredVia: "feed",
  }]);
  return ids[0];
}
const stored = async (id: string) => (await db.select().from(jobs).where(eq(jobs.id, id)))[0].requirements;

beforeAll(async () => { db = await openTestDb(); }, 60_000);
afterEach(() => setLLM(null));

describe("requirements: rules first, model for the jobs that matter", () => {
  it("llm:false never calls the model and marks the result as rules-only", async () => {
    const llm = fakeLLM("ok");
    setLLM(llm);
    const id = await newJob();
    const r = await ensureRequirements(db, id, { llm: false });
    expect(llm.calls).toBe(0);
    expect(r?.via).toBe("heuristic");
    expect((await stored(id))?.via).toBe("heuristic");
  });

  it("without upgrade a stored rules-only result is returned as is", async () => {
    const llm = fakeLLM("ok");
    setLLM(llm);
    const id = await newJob();
    await ensureRequirements(db, id, { llm: false });
    const again = await ensureRequirements(db, id);
    expect(llm.calls).toBe(0);
    expect(again?.via).toBe("heuristic");
  });

  it("upgrade re-reads a rules-only result with the model, once", async () => {
    const llm = fakeLLM("ok");
    const id = await newJob();
    await ensureRequirements(db, id, { llm: false });
    setLLM(llm);
    const up = await ensureRequirements(db, id, { upgrade: true });
    expect(up?.via).toBe("llm");
    expect(up?.summary).toBe("from the model");
    await ensureRequirements(db, id, { upgrade: true });
    expect(llm.calls).toBe(1); // already model-quality: not extracted again
  });

  it("upgrade does nothing when no model is available", async () => {
    const id = await newJob();
    await ensureRequirements(db, id, { llm: false });
    const up = await ensureRequirements(db, id, { upgrade: true });
    expect(up?.via).toBe("heuristic");
  });

  it("a model that fails keeps the rules result and is not retried on every look", async () => {
    const llm = fakeLLM("fail");
    setLLM(llm);
    const id = await newJob();
    const r = await ensureRequirements(db, id);
    expect(r?.via).toBe("fallback");
    expect(r?.yearsMin).toBe(4); // still usable
    await ensureRequirements(db, id, { upgrade: true });
    await ensureRequirements(db, id, { upgrade: true });
    expect(llm.calls).toBe(1);
  });

  it("extractRequirements({llm:false}) is the plain rules pass", async () => {
    const llm = fakeLLM("ok");
    setLLM(llm);
    const out = await extractRequirements({ title: "Senior Frontend Engineer", descriptionText: JD }, { llm: false });
    expect(out.usedLLM).toBe(false);
    expect(out.requirements.via).toBe("heuristic");
    expect(llm.calls).toBe(0);
  });
});
