import type { AtsType } from "../db/schema.js";
import { htmlToText } from "./html.js";
import { prettifyToken, safeUrl } from "./http.js";
import { matchFeedUrl } from "./registry.js";
import { safeFetch } from "./ssrf.js";

export type DetectedBoard = { atsType: AtsType; token: string; name: string };

/** Words that appear in embed URLs but are never a company's board token. */
const NOT_TOKENS = new Set(["embed", "jobs", "job", "api", "v1", "v0", "boards", "static", "assets", "careers", "apply", "widget", "js", "css"]);

const PATTERNS: { atsType: AtsType; re: RegExp }[] = [
  { atsType: "greenhouse", re: /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board(?:\/js)?\?for=)?([a-z0-9_-]+)/gi },
  { atsType: "greenhouse", re: /boards-api\.greenhouse\.io\/v1\/boards\/([a-z0-9_-]+)/gi },
  { atsType: "lever", re: /jobs(?:\.eu)?\.lever\.co\/([a-z0-9_-]+)/gi },
  { atsType: "lever", re: /api\.lever\.co\/v0\/postings\/([a-z0-9_-]+)/gi },
  { atsType: "ashby", re: /jobs\.ashbyhq\.com\/([a-z0-9_.-]+)/gi },
  { atsType: "ashby", re: /api\.ashbyhq\.com\/posting-api\/job-board\/([a-z0-9_.-]+)/gi },
  { atsType: "smartrecruiters", re: /(?:jobs|careers)\.smartrecruiters\.com\/([a-z0-9_-]+)/gi },
];

/** Every board token a page's HTML points at, most frequent first. Pure, so it is tested without a network. */
export function findBoardsInHtml(html: string): DetectedBoard[] {
  const counts = new Map<string, DetectedBoard & { n: number }>();
  for (const { atsType, re } of PATTERNS) {
    for (const m of html.matchAll(re)) {
      const token = m[1];
      if (!token || NOT_TOKENS.has(token.toLowerCase()) || token.length < 2) continue;
      const key = `${atsType}:${token.toLowerCase()}`;
      const hit = counts.get(key);
      if (hit) hit.n++; else counts.set(key, { atsType, token, name: prettifyToken(token), n: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.n - a.n).map(({ n: _n, ...b }) => b);
}

/**
 * Work out which supported job board a company link belongs to: a board or posting URL directly, otherwise the
 * company's own careers page (read through the SSRF guard) for an embedded or linked board. Null when none is found.
 */
export async function detectBoard(link: string): Promise<DetectedBoard | null> {
  const u = safeUrl(link.trim());
  if (!u) return null;
  const direct = matchFeedUrl(u.toString());
  if (direct) return { atsType: direct.feed.atsType, token: direct.token, name: prettifyToken(direct.token) };

  const res = await safeFetch(u.toString(), { headers: { "user-agent": "Mozilla/5.0 (compatible; jobgraph)", accept: "text/html" }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return null;
  const html = (await res.text()).slice(0, 1_500_000);
  const found = findBoardsInHtml(html)[0];
  if (!found) return null;
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const siteName = title ? htmlToText(title).split(/[|\-–—·]/)[0].replace(/\b(careers?|jobs?)\b/gi, "").replace(/\s+/g, " ").trim() : "";
  return { ...found, name: siteName.length >= 2 && siteName.length <= 60 ? siteName : found.name };
}
