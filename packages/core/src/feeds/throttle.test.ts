import { describe, expect, it } from "vitest";
import { HostBackoff, feedHost } from "./throttle.js";

describe("HostBackoff", () => {
  it("backs a host off after two rate-limited boards in a row, for the rest of the cycle", () => {
    const b = new HostBackoff(2);
    expect(b.rateLimited("api.lever.co")).toBe(false);
    expect(b.isBackedOff("api.lever.co")).toBe(false);
    expect(b.rateLimited("api.lever.co")).toBe(true);
    expect(b.isBackedOff("api.lever.co")).toBe(true);
    expect(b.rateLimited("api.lever.co")).toBe(false); // already off; no second announcement
    expect(b.isBackedOff("boards-api.greenhouse.io")).toBe(false);
    expect(b.backedOffHosts).toEqual(["api.lever.co"]);
  });

  it("a board that answers resets that host's streak", () => {
    const b = new HostBackoff(2);
    b.rateLimited("api.lever.co");
    b.ok("api.lever.co");
    expect(b.rateLimited("api.lever.co")).toBe(false);
    expect(b.isBackedOff("api.lever.co")).toBe(false);
  });

  it("maps each ATS to its API host", () => {
    expect(feedHost("greenhouse")).toBe("boards-api.greenhouse.io");
    expect(feedHost("lever")).toBe("api.lever.co");
    expect(feedHost("ashby")).toBe("api.ashbyhq.com");
    expect(feedHost("smartrecruiters")).toBe("api.smartrecruiters.com");
  });
});
