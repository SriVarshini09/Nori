import type { AtsType } from "../db/schema.js";

/** The API host each ATS feed is read from, so a poll cycle can back one host off without touching the others. */
const FEED_HOSTS: Partial<Record<AtsType, string>> = {
  greenhouse: "boards-api.greenhouse.io",
  lever: "api.lever.co",
  ashby: "api.ashbyhq.com",
  smartrecruiters: "api.smartrecruiters.com",
};

export const feedHost = (atsType: AtsType): string => FEED_HOSTS[atsType] ?? atsType;

/**
 * Per-cycle memory of which feed hosts are refusing us. A board whose retries all ended in 429/503 counts as a strike
 * against its host; after `limit` strikes in a row the host is backed off for the rest of the cycle (the caller skips
 * its remaining boards, which stay due and are tried again next cycle). A board that answers resets that host's streak.
 * Create a new one per cycle.
 */
export class HostBackoff {
  private streak = new Map<string, number>();
  private off = new Set<string>();

  constructor(private readonly limit = 2) {}

  /** True once the host has been backed off this cycle. */
  isBackedOff(host: string): boolean { return this.off.has(host); }

  /** Record a rate-limited board. Returns true when this strike backs the host off. */
  rateLimited(host: string): boolean {
    const n = (this.streak.get(host) ?? 0) + 1;
    this.streak.set(host, n);
    if (n >= this.limit && !this.off.has(host)) { this.off.add(host); return true; }
    return false;
  }

  /** Record a board that answered (any result other than rate limiting). */
  ok(host: string): void { this.streak.set(host, 0); }

  get backedOffHosts(): string[] { return [...this.off]; }
}
