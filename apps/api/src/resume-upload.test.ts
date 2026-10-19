import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { openTestDb, setLLM, LLMUnavailableError, type Db } from "@jobgraph/core";
import { createApp } from "./app.js";

const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../packages/core/src/resume/fixtures");

let db: Db;
let app: ReturnType<typeof createApp>;

async function upload(file: string, type: string) {
  const form = new FormData();
  form.append("file", new File([await readFile(path.join(FIX, file))], file, { type }));
  const res = await app.request("/api/profile/resume-file", { method: "POST", body: form });
  return { status: res.status, json: await res.json() as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

beforeAll(async () => {
  setLLM({
    provider: "none", model: "none", available: false,
    async json() { throw new LLMUnavailableError(); },
    async text() { throw new LLMUnavailableError(); },
  });
  db = await openTestDb();
  app = createApp(db, { mcp: false, defaultUserEmail: "upload@example.com" });
});

describe("resume upload routes", () => {
  it("returns contact, layout and page facts for a PDF with hidden links", async () => {
    const r = await upload("samira-two-column.pdf", "application/pdf");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ pages: 1, layout: "multi", hadTextLayer: true, usedLLM: false });
    expect(r.json.extractedChars).toBeGreaterThan(500);
    expect(r.json.contact).toMatchObject({
      fullName: "Samira Haddad", phone: "+1 312 555 0187", city: "Chicago", state: "IL", country: "United States",
      linkedin: "https://linkedin.com/in/samirahaddad", github: "https://github.com/shaddad",
    });
    expect(r.json.profilePatch).toMatchObject({ github: "https://github.com/shaddad", city: "Chicago" });
    const me = await (await app.request("/api/me")).json() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(me.profile).toMatchObject({ fullName: "Samira Haddad", github: "https://github.com/shaddad", state: "IL", country: "United States" });
  });

  it("reads DOCX hyperlinks", async () => {
    const r = await upload("maria-garcia.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(r.status).toBe(200);
    expect(r.json.contact).toMatchObject({ linkedin: "https://linkedin.com/in/mariagarcia", website: "https://mariagarcia.design" });
  });

  it("rejects a scanned PDF with a clear message", async () => {
    const r = await upload("lena-scanned.pdf", "application/pdf");
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.json)).toContain("scanned PDF, please upload a text-based PDF or DOCX");
  });

  it("returns contact from the text route", async () => {
    const text = await readFile(path.join(FIX, "priya-pmp.txt"), "utf8");
    const res = await app.request("/api/profile/resume", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    expect(res.status).toBe(200);
    const json = await res.json() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(json.contact).toMatchObject({ fullName: "Priya R. Natarajan", city: "Edison", state: "NJ", linkedin: "https://linkedin.com/in/priyarnatarajan" });
  });
});
