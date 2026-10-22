import { describe, expect, it } from "vitest";
import { findSkills } from "./skills.js";

describe("skills outside software", () => {
  it("reads Go as the language in the places a posting uses it, not as the verb", () => {
    expect(findSkills("4+ years of backend development in Go")).toContain("Go");
    expect(findSkills("Experience with Go and Kubernetes")).toEqual(expect.arrayContaining(["Go", "Kubernetes"]));
    expect(findSkills("You will build Go services at scale")).toContain("Go");
    expect(findSkills("Python, Go, Rust")).toContain("Go");
    for (const prose of ["We go above and beyond", "Go to the website", "You can go for it", "Let us go live in May"]) {
      expect(findSkills(prose)).not.toContain("Go");
    }
  });

  it("recognises engineering, health, marketing and finance terms", () => {
    expect(findSkills("SolidWorks and GD&T")).toEqual(expect.arrayContaining(["SolidWorks", "GD&T"]));
    expect(findSkills("Active RN license in Illinois, BLS and ACLS certification")).toEqual(expect.arrayContaining(["RN License", "BLS", "ACLS"]));
    expect(findSkills("Google Analytics and SEO")).toEqual(expect.arrayContaining(["Google Analytics", "SEO"]));
  });
});
