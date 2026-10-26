import { createHash } from "node:crypto";
import type { NormalizedJob } from "../contracts.js";
import { decodeEntities, htmlToText } from "./html.js";
import { parseDate, REMOTE_RE, safeUrl } from "./http.js";
import { guardPostingHtml, sanitizePostingText } from "./posting-guard.js";

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");

type JsonLdNode = Record<string, unknown>;

const SCRIPT_LD_RE = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

function isJobPostingType(t: unknown): boolean {
  if (typeof t === "string") return /(?:^|\/|:)JobPosting$/i.test(t.trim());
  if (Array.isArray(t)) return t.some(isJobPostingType);
  return false;
}

function collectJobPostings(node: unknown, out: JsonLdNode[] = []): JsonLdNode[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const item of node) collectJobPostings(item, out);
    return out;
  }
  const obj = node as JsonLdNode;
  if (isJobPostingType(obj["@type"]) || isJobPostingType(obj["type"])) {
    out.push(obj);
  }
  if (Array.isArray(obj["@graph"])) {
    collectJobPostings(obj["@graph"], out);
  }
  if (Array.isArray(obj["itemListElement"])) {
    for (const el of obj["itemListElement"] as unknown[]) {
      if (el && typeof el === "object") {
        const rec = el as JsonLdNode;
        collectJobPostings(rec["item"] ?? rec, out);
      }
    }
  }
  return out;
}

function stringOf(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return decodeEntities(v.trim());
  if (typeof v === "number") return String(v);
  return undefined;
}

function extractCompanyName(node: JsonLdNode, fallbackHost: string): string {
  const org = node.hiringOrganization ?? node.organization;
  if (typeof org === "string" && org.trim()) return org.trim();
  if (org && typeof org === "object") {
    const name = stringOf((org as JsonLdNode).name);
    if (name) return name;
  }
  return fallbackHost.replace(/^(www|jobs|careers|apply)\./i, "").split(".")[0] || "Company";
}

function extractLocation(node: JsonLdNode): { location?: string; remote: boolean } {
  const locType = stringOf(node.jobLocationType);
  let remote = Boolean(locType && /telecommute|remote/i.test(locType));

  const rawLoc = node.jobLocation;
  const locs = Array.isArray(rawLoc) ? rawLoc : rawLoc ? [rawLoc] : [];
  const parts: string[] = [];

  for (const l of locs) {
    if (typeof l === "string" && l.trim()) {
      parts.push(l.trim());
      continue;
    }
    if (!l || typeof l !== "object") continue;
    const place = l as JsonLdNode;
    const name = stringOf(place.name);
    const addr = place.address;
    if (typeof addr === "string" && addr.trim()) {
      parts.push(addr.trim());
      continue;
    }
    if (addr && typeof addr === "object") {
      const a = addr as JsonLdNode;
      const city = stringOf(a.addressLocality);
      const region = stringOf(a.addressRegion);
      const country = stringOf(a.addressCountry);
      const formatted = [city, region, country].filter(Boolean).join(", ");
      if (formatted) parts.push(formatted);
      else if (name) parts.push(name);
    } else if (name) {
      parts.push(name);
    }
  }

  const location = [...new Set(parts)].join(" | ") || (remote ? "Remote" : undefined);
  if (location && REMOTE_RE.test(location)) remote = true;
  return { location, remote };
}

function extractIdentifier(node: JsonLdNode, applyUrl: string): string {
  const id = node.identifier;
  if (typeof id === "string" && id.trim()) return id.trim();
  if (typeof id === "number") return String(id);
  if (id && typeof id === "object") {
    const val = stringOf((id as JsonLdNode).value) ?? stringOf((id as JsonLdNode).name);
    if (val) return val;
  }
  const reqId = stringOf(node.reqId) ?? stringOf(node.jobId);
  if (reqId) return reqId;
  return sha1(applyUrl);
}

/**
 * Extract all schema.org/JobPosting nodes from a page's HTML.
 * Pure & deterministic — zero LLM tokens.
 */
export function extractJsonLdPostings(
  html: string,
  pageUrl: string,
  via: NormalizedJob["discoveredVia"] = "feed",
): NormalizedJob[] {
  if (!html) return [];
  const base = safeUrl(pageUrl);
  const fallbackHost = base?.hostname ?? "company";
  const postings: JsonLdNode[] = [];

  for (const m of html.matchAll(SCRIPT_LD_RE)) {
    const raw = m[1]?.trim();
    if (!raw) continue;
    try {
      const cleaned = raw.replace(/^\s*<!--/, "").replace(/-->\s*$/, "").trim();
      const parsed: unknown = JSON.parse(cleaned);
      collectJobPostings(parsed, postings);
    } catch {
      // Tolerate unescaped control characters inside JSON-LD description strings
      try {
        const repaired = raw.replace(/[\u0000-\u001F]+/g, " ");
        const parsed: unknown = JSON.parse(repaired);
        collectJobPostings(parsed, postings);
      } catch {
        /* ignore malformed script block */
      }
    }
  }

  const results: NormalizedJob[] = [];
  for (const p of postings) {
    const title = stringOf(p.title) ?? stringOf(p.name);
    if (!title) continue;

    const rawDesc = stringOf(p.description) ?? "";
    const responsibilities = stringOf(p.responsibilities);
    const qualifications = stringOf(p.qualifications) ?? stringOf(p.skills);
    const combinedHtml = [rawDesc, responsibilities, qualifications].filter(Boolean).join("\n\n");
    const guarded = guardPostingHtml(combinedHtml);
    const descriptionText = sanitizePostingText(htmlToText(guarded.cleanedHtml));

    const rawUrl = stringOf(p.url) ?? stringOf(p.directApplyUrl) ?? stringOf(p.sameAs);
    let applyUrl = pageUrl;
    if (rawUrl && base) {
      try { applyUrl = new URL(rawUrl, base).toString(); } catch { applyUrl = pageUrl; }
    }

    const companyName = extractCompanyName(p, fallbackHost);
    const { location, remote } = extractLocation(p);
    const externalId = extractIdentifier(p, applyUrl);
    const postedAt = parseDate(p.datePosted);

    results.push({
      atsType: "web",
      externalId,
      companyName,
      title: title.slice(0, 300),
      location,
      remote: remote || REMOTE_RE.test(title) || REMOTE_RE.test(descriptionText.slice(0, 1200)),
      descriptionText,
      descriptionHtml: guarded.cleanedHtml || undefined,
      applyUrl,
      postedAt,
      discoveredVia: via,
      raw: p,
    });
  }

  return results;
}

/**
 * Adapted from career-ops/browser-extract.mjs (`normalizeJd`):
 * When a page contains both a schema.org/JobPosting JSON-LD block and DOM text,
 * compare their normalized lengths and take whichever is richer. This beats SPA shells
 * (Phenom, Avature, SuccessFactors) where DOM text is just nav chrome while JSON-LD holds
 * the full JD, AND beats stub JSON-LD pages where the DOM holds the full posting.
 */
export function selectRichestPosting(
  html: string,
  domText: string,
  pageUrl: string,
  via: NormalizedJob["discoveredVia"],
  hintTitle?: string,
  companyHint?: string,
): NormalizedJob | null {
  const ldJobs = extractJsonLdPostings(html, pageUrl, via);
  const guardedDom = sanitizePostingText(htmlToText(guardPostingHtml(html).cleanedHtml || domText));
  const bestDomText = guardedDom.length >= domText.length ? guardedDom : sanitizePostingText(domText);

  if (ldJobs.length === 1) {
    const ld = ldJobs[0]!;
    const richerText = ld.descriptionText.length >= bestDomText.length * 0.6 || bestDomText.length < 200
      ? ld.descriptionText
      : bestDomText;
    return {
      ...ld,
      companyName: ld.companyName || companyHint || "Company",
      title: ld.title || hintTitle || "Untitled role",
      descriptionText: richerText,
    };
  }

  if (ldJobs.length > 1) {
    // If pageUrl matches one specific posting's applyUrl, return that one
    const exact = ldJobs.find((j) => j.applyUrl === pageUrl);
    if (exact) return exact;
    return ldJobs[0]!;
  }

  return null;
}
