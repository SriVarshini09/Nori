import { describe, expect, it } from "vitest";
import { parallelExtract, parallelSearch } from "./parallel.js";

describe.skipIf(!process.env.PARALLEL_API_KEY)("Parallel live", () => {
  it("search returns results on ATS domains", async () => {
    const results = await parallelSearch({
      objective: "Find open software engineer job postings on Greenhouse",
      search_queries: ["software engineer greenhouse job opening", "frontend engineer remote hiring"],
      include_domains: ["boards.greenhouse.io", "job-boards.greenhouse.io"],
      max_results: 3,
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].url).toMatch(/greenhouse\.io/);
  });

  it("extract returns page content", async () => {
    const out = await parallelExtract(["https://example.com"], "What is this page?");
    expect(out[0]?.content.length).toBeGreaterThan(0);
  });
});
