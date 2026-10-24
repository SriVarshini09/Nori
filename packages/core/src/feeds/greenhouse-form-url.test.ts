import { describe, expect, it } from "vitest";
import { greenhouseFormUrl } from "./greenhouse.js";

describe("greenhouseFormUrl", () => {
  const job = (applyUrl: string, atsType = "greenhouse", externalId = "7746572") => ({ atsType, applyUrl, externalId });

  it("sends a company-hosted Greenhouse posting to the embedded form", () => {
    expect(greenhouseFormUrl(job("https://www.coinbase.com/careers/positions/7746572?gh_jid=7746572"), "coinbase"))
      .toBe("https://job-boards.greenhouse.io/embed/job_app?for=coinbase&token=7746572");
  });

  it("leaves Greenhouse's own addresses alone", () => {
    expect(greenhouseFormUrl(job("https://job-boards.greenhouse.io/vercel/jobs/123"), "vercel")).toBeNull();
    expect(greenhouseFormUrl(job("https://boards.greenhouse.io/embed/job_app?for=vercel&token=123"), "vercel")).toBeNull();
    expect(greenhouseFormUrl(job("https://boards.eu.greenhouse.io/acme/jobs/9"), "acme")).toBeNull();
  });

  it("needs a board token, a numeric job id and a Greenhouse job", () => {
    expect(greenhouseFormUrl(job("https://www.coinbase.com/careers/positions/7746572"), null)).toBeNull();
    expect(greenhouseFormUrl(job("https://www.coinbase.com/careers/positions/x", "greenhouse", "abc"), "coinbase")).toBeNull();
    expect(greenhouseFormUrl(job("https://jobs.lever.co/acme/1", "lever"), "acme")).toBeNull();
  });
});
