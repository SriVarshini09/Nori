import type { NormalizedJob } from "../contracts.js";
import { decodeEntities, htmlToText } from "./html.js";
import { FETCH_TIMEOUT_MS, parseDate, prettifyToken, REMOTE_RE, safeUrl, type FeedSourceExt } from "./http.js";
import { guardPostingHtml } from "./posting-guard.js";

/**
 * Personio adapter — modeled on career-ops-hq/career-ops (providers/personio.mjs):
 *   Token format: "<slug>" (defaults to .de, falls back to .com) or "<slug>.de" / "<slug>.com"
 *   Reads /xml (documented Personio XML feed) and falls back to /?language=en JSON payload.
 */

const HOST_RE = /^([a-z0-9][a-z0-9-]*)\.jobs\.personio\.(de|com)$/i;
const TOKEN_RE = /^([a-z0-9][a-z0-9-]*)(?:\.(de|com))?$/i;

function resolveHosts(token: string): { slug: string; hosts: string[] } | null {
  const m = TOKEN_RE.exec(token.trim().toLowerCase());
  if (!m) return null;
  const slug = m[1]!;
  const tld = m[2];
  const hosts = tld ? [`${slug}.jobs.personio.${tld}`] : [`${slug}.jobs.personio.de`, `${slug}.jobs.personio.com`];
  return { slug, hosts };
}

async function fetchText(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "Mozilla/5.0 (compatible; jobgraph)" } });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function extractXmlTag(block: string, tag: string): string {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(block);
  if (!m?.[1]) return "";
  return decodeEntities(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim());
}

export function parsePersonioXml(xml: string, host: string, slug: string): NormalizedJob[] {
  const companyName = prettifyToken(slug);
  const out: NormalizedJob[] = [];
  const seen = new Set<string>();

  for (const m of xml.matchAll(/<position\b[^>]*>([\s\S]*?)<\/position>/gi)) {
    const block = m[1] ?? "";
    const id = extractXmlTag(block, "id");
    const title = extractXmlTag(block, "name");
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);

    const office = extractXmlTag(block, "office");
    const department = extractXmlTag(block, "department");
    const createdAt = extractXmlTag(block, "createdAt");

    const descBlocks: string[] = [];
    for (const dm of block.matchAll(/<jobDescription\b[^>]*>([\s\S]*?)<\/jobDescription>/gi)) {
      const name = extractXmlTag(dm[1] ?? "", "name");
      const val = extractXmlTag(dm[1] ?? "", "value");
      if (val) descBlocks.push(name ? `<h3>${name}</h3>\n${val}` : val);
    }

    const rawHtml = descBlocks.join("\n");
    const guarded = guardPostingHtml(rawHtml);
    const descriptionText = htmlToText(guarded.cleanedHtml) || [title, department, office].filter(Boolean).join(" — ");

    out.push({
      atsType: "personio",
      externalId: id,
      companyName,
      companyToken: slug,
      title,
      location: office || undefined,
      remote: REMOTE_RE.test(office) || REMOTE_RE.test(title),
      descriptionText,
      descriptionHtml: guarded.cleanedHtml || undefined,
      applyUrl: `https://${host}/job/${encodeURIComponent(id)}`,
      postedAt: parseDate(createdAt),
      discoveredVia: "feed",
    });
  }
  return out;
}

export const personio: FeedSourceExt = {
  atsType: "personio",
  async fetchJobs(token) {
    const resolved = resolveHosts(token);
    if (!resolved) return [];
    for (const host of resolved.hosts) {
      const xml = await fetchText(`https://${host}/xml?language=en`);
      if (xml && /<workzag-jobs|<position\b/i.test(xml)) {
        const jobs = parsePersonioXml(xml, host, resolved.slug);
        if (jobs.length > 0) return jobs;
      }
    }
    return [];
  },

  parseUrl(url) {
    const u = safeUrl(url);
    if (!u) return null;
    const m = HOST_RE.exec(u.hostname);
    if (!m) return null;
    const slug = m[1]!.toLowerCase();
    const tld = m[2]!.toLowerCase();
    const parts = u.pathname.split("/").filter(Boolean);
    const externalId = parts[0] === "job" && parts[1] ? parts[1] : undefined;
    return { token: tld === "com" ? `${slug}.com` : slug, externalId };
  },
};
