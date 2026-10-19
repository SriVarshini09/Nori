import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { openTestDb, type Db } from "../db/client.js";
import { profiles, users } from "../db/schema.js";
import { setLLM, LLMUnavailableError, type LLM } from "../llm/index.js";
import { parseResumeHeuristic } from "../graph/parse.js";
import { ingestResume } from "../graph/ingest.js";
import { extractResume, SCANNED_PDF_ERROR } from "./extract-text.js";
import { extractContact, normalizeUrl, parseLocation } from "./contact.js";
import { sectionOf } from "./sections.js";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const load = async (f: string) => extractResume(await readFile(path.join(FIX, f)), path.extname(f));

type Expect = {
  file: string; layout: "single" | "multi"; fullName: string; email: string; phone: string;
  linkedin?: string; github?: string; website?: string; city: string; state?: string; country: string; roles: number;
};

const CASES: Expect[] = [
  { file: "alex-chen-links.pdf", layout: "single", fullName: "Alex Chen", email: "alex.chen@example.com", phone: "(206) 555-0142",
    linkedin: "https://linkedin.com/in/alexchen-dev", github: "https://github.com/alexchendev", website: "https://alexchen.dev",
    city: "Seattle", state: "WA", country: "United States", roles: 3 },
  { file: "samira-two-column.pdf", layout: "multi", fullName: "Samira Haddad", email: "samira.haddad@example.com", phone: "+1 312 555 0187",
    linkedin: "https://linkedin.com/in/samirahaddad", github: "https://github.com/shaddad",
    city: "Chicago", state: "IL", country: "United States", roles: 3 },
  { file: "maria-garcia.docx", layout: "single", fullName: "Maria Garcia", email: "maria.garcia@example.com", phone: "512.555.0199",
    linkedin: "https://linkedin.com/in/mariagarcia", github: "https://github.com/mgarcia-codes", website: "https://mariagarcia.design",
    city: "Austin", state: "Texas", country: "United States", roles: 2 },
  { file: "devon-handles.txt", layout: "single", fullName: "Devon O'Brien", email: "devon.obrien@example.com", phone: "720-555-0110",
    linkedin: "https://linkedin.com/in/devonobrien", github: "https://github.com/devob", website: "https://devob.io",
    city: "Denver", state: "CO", country: "United States", roles: 2 },
  { file: "kenji-work-history.pdf", layout: "single", fullName: "Kenji Watanabe", email: "kenji.watanabe@example.com", phone: "503-555-0123",
    linkedin: "https://linkedin.com/in/kenjiwatanabe", city: "Portland", state: "OR", country: "United States", roles: 3 },
  { file: "oliver-london.pdf", layout: "single", fullName: "Oliver Bennett", email: "oliver.bennett@example.co.uk", phone: "+44 20 7946 0958",
    linkedin: "https://linkedin.com/in/oliverbennett", github: "https://github.com/obennett", city: "London", country: "United Kingdom", roles: 2 },
  { file: "priya-pmp.txt", layout: "single", fullName: "Priya R. Natarajan", email: "priya.natarajan@example.com", phone: "+1 (732) 555-0168",
    linkedin: "https://linkedin.com/in/priyarnatarajan", city: "Edison", state: "NJ", country: "United States", roles: 3 },
  { file: "rahul-india.md", layout: "single", fullName: "Rahul Sharma", email: "rahul.sharma@example.com", phone: "+91 98765 43210",
    linkedin: "https://linkedin.com/in/rahulsharma", github: "https://github.com/rahul-sh", city: "Bengaluru", state: "Karnataka", country: "India", roles: 2 },
];

describe("resume fixtures (heuristic path)", () => {
  for (const c of CASES) {
    it(`extracts contact and roles from ${c.file}`, async () => {
      const doc = await load(c.file);
      expect(doc.hadTextLayer).toBe(true);
      expect(doc.layout).toBe(c.layout);
      const parsed = parseResumeHeuristic(doc.text, doc.links);
      const contact = extractContact(doc.text, doc.links);
      expect({
        fullName: contact.fullName, email: contact.email, phone: contact.phone, linkedin: contact.linkedin, github: contact.github,
        website: contact.website, city: contact.city, state: contact.state, country: contact.country,
      }).toEqual({
        fullName: c.fullName, email: c.email, phone: c.phone, linkedin: c.linkedin, github: c.github,
        website: c.website, city: c.city, state: c.state, country: c.country,
      });
      expect(parsed.profile).toMatchObject({ fullName: c.fullName, email: c.email, city: c.city, country: c.country });
      expect(parsed.roles?.length).toBe(c.roles);
      for (const r of parsed.roles ?? []) {
        expect(r.company, r.title).toBeTruthy();
        expect(r.start, r.title).toMatch(/^\d{4}-\d{2}$/);
        expect(r.bullets?.length, r.title).toBeGreaterThan(0);
      }
      for (const k of ["fullName", "email", "phone", "city"] as const) expect(contact.confidence[k]).toBeGreaterThanOrEqual(0.9);
    });
  }

  it("recovers hyperlinks hidden behind words in a PDF", async () => {
    const doc = await load("alex-chen-links.pdf");
    expect(doc.links).toEqual(expect.arrayContaining([
      { url: "https://www.linkedin.com/in/alexchen-dev/", anchor: "LinkedIn" },
      { url: "https://github.com/alexchendev", anchor: "GitHub" },
      { url: "https://alexchen.dev/", anchor: "Portfolio" },
    ]));
    expect(doc.text).not.toContain("alexchendev");
    const contact = extractContact(doc.text, doc.links);
    expect(contact.confidence.linkedin).toBe(1);
    expect(contact.confidence.github).toBe(1);
  });

  it("reads a two-column PDF column by column and keeps bullets with their role", async () => {
    const doc = await load("samira-two-column.pdf");
    const lines = doc.text.split("\n");
    // sidebar is read as one block, not interleaved with experience
    const skills = lines.indexOf("SKILLS"), exp = lines.indexOf("EXPERIENCE");
    expect(skills).toBeGreaterThan(-1);
    expect(lines.slice(skills, skills + 11)).toEqual(expect.arrayContaining(["Python", "Snowflake", "Tableau"]));
    expect(lines.slice(exp).some((l) => /^(?:Python|Snowflake|Airflow)$/.test(l))).toBe(false);

    const roles = parseResumeHeuristic(doc.text, doc.links).roles!;
    expect(roles.map((r) => [r.title, r.company, r.start, r.end])).toEqual([
      ["Senior Data Engineer", "Grubhub", "2021-03", null],
      ["Data Engineer", "Groupon", "2017-07", "2021-02"],
      ["Business Intelligence Analyst", "Morningstar", "2015-06", "2017-06"],
    ]);
    const texts = roles.map((r) => r.bullets!.map((b) => b.text));
    expect(texts[0]).toEqual([
      "Designed a Kafka streaming layer that moved order events into Snowflake in under 90 seconds end to end",
      "Cut warehouse spend 35% by rewriting the heaviest Spark jobs and adding incremental dbt models",
      "Owned on-call for the ingestion platform serving 14 product teams",
    ]);
    expect(texts[1].join(" ")).toMatch(/Airflow DAGs/);
    expect(texts[1].join(" ")).not.toMatch(/Kafka|Tableau/);
    expect(texts[2].join(" ")).toMatch(/Tableau dashboards/);
    expect(texts[2]).toHaveLength(2);
  });

  it("parses DOCX hyperlinks, tables and other links", async () => {
    const doc = await load("maria-garcia.docx");
    expect(doc.text).toMatch(/React, TypeScript, Vue\.js \| Figma, Storybook, Jest/);
    const contact = extractContact(doc.text, doc.links);
    expect(contact.otherLinks).toEqual([{ kind: "dribbble", url: "https://dribbble.com/mariag", label: "Dribbble" }]);
    const parsed = parseResumeHeuristic(doc.text, doc.links);
    expect(parsed.education?.[0]).toMatchObject({ degree: "B.F.A.", field: "Graphic Design", school: "The University of Texas at Austin" });
  });

  it("parses Work History with MM/YYYY dates and two-line headers", async () => {
    const parsed = parseResumeHeuristic((await load("kenji-work-history.pdf")).text);
    expect(parsed.roles?.map((r) => [r.title, r.company, r.location, r.start, r.end])).toEqual([
      ["Operations Manager", "Columbia Sportswear", "Portland, OR", "2019-06", "2022-02"],
      ["Logistics Coordinator", "Nike", "Beaverton, OR", "2016-08", "2019-05"],
      ["Warehouse Associate", "Fred Meyer", "Portland, OR", "2014-01", "2016-12"],
    ]);
    expect(parsed.certifications).toEqual([{ name: "APICS Certified Supply Chain Professional (CSCP)", date: "2020-12" }]);
  });

  it("strips credentials from names and keeps middle initials", async () => {
    const parsed = parseResumeHeuristic((await load("priya-pmp.txt")).text);
    expect(parsed.profile?.fullName).toBe("Priya R. Natarajan");
    expect(parsed.education?.map((e) => e.school)).toEqual(["Rutgers University", "Anna University"]);
    expect(parsed.certifications).toHaveLength(2);
  });

  it("flags a scanned PDF with no text layer", async () => {
    const doc = await load("lena-scanned.pdf");
    expect(doc.hadTextLayer).toBe(false);
    expect(doc.text).toBe("");
    expect(doc.error).toBe(SCANNED_PDF_ERROR);
  });
});

describe("contact rules", () => {
  it("normalizes URLs and handles", () => {
    expect(normalizeUrl("www.LinkedIn.com/in/Alex-Chen/")).toBe("https://linkedin.com/in/Alex-Chen");
    expect(normalizeUrl("github.com/alex?tab=repositories")).toBe("https://github.com/alex");
    expect(normalizeUrl("mailto:a@b.co")).toBeNull();
  });

  it("parses locations", () => {
    expect(parseLocation("San Francisco, CA 94105")).toMatchObject({ city: "San Francisco", state: "CA", country: "United States" });
    expect(parseLocation("Toronto, ON, Canada")).toMatchObject({ city: "Toronto", state: "ON", country: "Canada" });
    expect(parseLocation("Location: Berlin, Germany")).toMatchObject({ city: "Berlin", country: "Germany" });
    expect(parseLocation("Austin, TX, USA")).toMatchObject({ city: "Austin", state: "TX", country: "United States" });
    expect(parseLocation("Python, Go")).toBeNull();
  });

  it("classifies links and derives a GitHub profile from a repo link", () => {
    const c = extractContact(
      "Sam Okafor\nsam@okafor.io · 415-555-0100 · Oakland, CA\nhttps://gitlab.com/sokafor · medium.com/@sokafor · x.com/sokafor\n\nPROJECTS\n• Ledger, github.com/sokafor/ledger",
      [],
    );
    expect(c.github).toBe("https://github.com/sokafor");
    expect(c.confidence.github).toBe(0.7);
    expect(c.otherLinks.map((l) => l.kind)).toEqual(["gitlab", "medium", "twitter"]);
    expect(c.website).toBeUndefined();
  });

  it("lets a PDF annotation outrank a disagreeing text URL", () => {
    const c = extractContact("Ana Ruiz\nana@example.com | linkedin.com/in/old-handle\n", [{ url: "https://www.linkedin.com/in/ana-ruiz", anchor: "LinkedIn" }]);
    expect(c.linkedin).toBe("https://linkedin.com/in/ana-ruiz");
  });

  it("does not mistake dates or zip codes for phone numbers", () => {
    const c = extractContact("Lee Park\nSeattle, WA 98101 (206) 555-0100\n\nEXPERIENCE\nEngineer | Acme | 2019 - 2022\n", []);
    expect(c.phone).toBe("(206) 555-0100");
    expect(extractContact("Lee Park\nEXPERIENCE\nEngineer | Acme | 06/2019 - 02/2022", []).phone).toBeUndefined();
  });

  it("recognizes heading variants", () => {
    for (const [h, s] of [["WORK HISTORY", "experience"], ["Professional Experience:", "experience"], ["Employment", "experience"], ["Licenses & Certifications", "certifications"],
      ["About Me", "summary"], ["Publications", "publications"], ["Volunteer Experience", "volunteer"], ["Languages", "languages"], ["E X P E R I E N C E", "experience"],
      ["Awards & Honors", "awards"], ["Technical Skills", "skills"], ["Selected Projects", "projects"]] as const) {
      expect(sectionOf(h), h).toBe(s);
    }
    expect(sectionOf("Senior Engineer at Acme")).toBeNull();
  });
});

describe("ingest contact fields", () => {
  let db: Db;
  const none: LLM = { provider: "none", model: "none", available: false, async json() { throw new LLMUnavailableError(); }, async text() { throw new LLMUnavailableError(); } };

  beforeAll(async () => { db = await openTestDb(); });

  const newUser = async (email: string) => {
    const [u] = await db.insert(users).values({ email }).returning();
    await db.insert(profiles).values({ userId: u.id, email });
    return u.id;
  };

  it("sets github, city, state and country on the profile (heuristic)", async () => {
    setLLM(none);
    const userId = await newUser("alex@example.com");
    const doc = await load("alex-chen-links.pdf");
    const r = await ingestResume(db, userId, doc.text, { links: doc.links });
    expect(r.usedLLM).toBe(false);
    expect(r.profilePatch).toMatchObject({ fullName: "Alex Chen", github: "https://github.com/alexchendev", city: "Seattle", state: "WA", country: "United States", website: "https://alexchen.dev" });
    expect(r.contact.linkedin).toBe("https://linkedin.com/in/alexchen-dev");
    const [p] = await db.select().from(profiles).where(eq(profiles.userId, userId));
    expect(p).toMatchObject({ github: "https://github.com/alexchendev", city: "Seattle", state: "WA", country: "United States", linkedin: "https://linkedin.com/in/alexchen-dev" });
  });

  it("merges the LLM contact: strong rules win, the model fills gaps, invented URLs are dropped", async () => {
    let prompt = "";
    setLLM({
      provider: "anthropic", model: "test", available: true,
      async json(opts: { prompt: string }) {
        prompt = opts.prompt;
        return {
          contact: {
            fullName: "Alexander Chen", email: "alex.chen@example.com", phone: "(206) 555-0142", city: "Seattle", state: "Washington", country: "USA",
            linkedin: "https://linkedin.com/in/made-up", github: "https://github.com/alexchendev", website: "https://alexchen.dev",
            otherLinks: [{ kind: "twitter", url: "https://x.com/invented", label: "X" }],
          },
          roles: [], skills: [],
        };
      },
      async text() { return ""; },
    } as unknown as LLM);
    try {
      const userId = await newUser("alex2@example.com");
      const doc = await load("alex-chen-links.pdf");
      const r = await ingestResume(db, userId, doc.text, { links: doc.links });
      expect(r.usedLLM).toBe(true);
      expect(prompt).toContain("Links found in the document");
      expect(prompt).toContain('https://github.com/alexchendev <- "GitHub"');
      expect(r.contact.fullName).toBe("Alex Chen");
      expect(r.contact.state).toBe("WA");
      expect(r.contact.linkedin).toBe("https://linkedin.com/in/alexchen-dev");
      expect(r.contact.otherLinks).toEqual([]);
    } finally {
      setLLM(none);
    }
  });

  it("uses the model for fields the rules missed", async () => {
    setLLM({
      provider: "anthropic", model: "test", available: true,
      async json() { return { contact: { fullName: "Jo Bo", city: "Reno", state: "NV", country: "United States", github: "https://github.com/jobo" }, roles: [] }; },
      async text() { return ""; },
    } as unknown as LLM);
    try {
      const userId = await newUser("jobo@example.com");
      const r = await ingestResume(db, userId, "jo bo\njobo@example.com\nsee github.com/jobo for code\n\nEXPERIENCE\nEngineer | Acme | 2020 - Present\n• Built things");
      expect(r.contact).toMatchObject({ fullName: "Jo Bo", city: "Reno", state: "NV", country: "United States", location: "Reno, NV", github: "https://github.com/jobo" });
      expect(r.contact.confidence.fullName).toBe(0.85);
    } finally {
      setLLM(none);
    }
  });
});
