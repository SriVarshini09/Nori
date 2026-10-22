import { describe, expect, it } from "vitest";
import { parseResumeHeuristic } from "../graph/parse.js";
import { boundContactText, extractContact, MAX_CONTACT_CHARS } from "./contact.js";

const HEADER = "Maya Chen\nSan Francisco, CA | maya.chen@example.com | 415-555-0142 | linkedin.com/in/mayachen | github.com/mayachen\n";
const time = (fn: () => unknown) => { const t = performance.now(); fn(); return performance.now() - t; };

describe("contact extraction cannot be frozen by hostile text", () => {
  // These used to take minutes at a few hundred KB and hours at a few MB: a signed-in user could freeze the whole server.
  const HOSTILE: Record<string, string> = {
    "one very long word": "x".repeat(400_000),
    "a very long dotted word": "a.".repeat(200_000),
    "a long run of digits and spaces": "1 ".repeat(200_000),
    "a long phone-like run": "(555) 123-".repeat(40_000),
    "many www. labels": "www.a-b.".repeat(50_000),
  };
  for (const [name, junk] of Object.entries(HOSTILE)) {
    it(`finishes quickly on ${name}`, () => {
      expect(time(() => extractContact(HEADER + junk))).toBeLessThan(1500);
      expect(time(() => parseResumeHeuristic(HEADER + junk, []))).toBeLessThan(3000);
    });
  }

  it("still reads the header when junk follows it", () => {
    const c = extractContact(HEADER + "x".repeat(300_000));
    expect(c.email).toBe("maya.chen@example.com");
    expect(c.phone).toContain("415");
    expect(c.linkedin).toContain("mayachen");
    expect(c.github).toContain("mayachen");
  });

  it("only blanks runs no contact detail could be, and keeps ordinary lines intact", () => {
    expect(boundContactText("hello world\n+1 (415) 555-0142\nhttps://example.com/in/maya")).toBe("hello world\n+1 (415) 555-0142\nhttps://example.com/in/maya");
    expect(boundContactText("a".repeat(500))).toBe(" ");
    expect(boundContactText("1 ".repeat(100))).toBe(" ");
    expect(boundContactText("z".repeat(MAX_CONTACT_CHARS + 5000)).length).toBeLessThanOrEqual(MAX_CONTACT_CHARS);
  });
});
