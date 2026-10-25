import type { AtsType } from "../db/schema.js";
import { resolveGreenhouseEmbedId } from "./greenhouse.js";
import { htmlToText } from "./html.js";
import { prettifyToken, safeUrl } from "./http.js";
import { decodePageBytes } from "./posting-guard.js";
import { FEEDS, matchFeedUrl } from "./registry.js";
import { safeFetch } from "./ssrf.js";

export type DetectedBoard = { atsType: AtsType; token: string; name: string };

/** Words that appear in embed URLs or subdomains but are never a company's board token. */
const NOT_TOKENS = new Set([
  "embed", "jobs", "job", "api", "v1", "v2", "v0", "boards", "static", "assets", "careers",
  "apply", "widget", "js", "css", "www", "app", "cdn", "mail", "help", "support", "status",
  "login", "auth", "account", "accounts", "j", "p", "o", "postings", "wday", "cxs",
]);

type PatternRule = {
  atsType: AtsType;
  re: RegExp;
  extract: (m: RegExpExecArray) => { token: string; displaySlug: string } | null;
};

const simpleRule = (atsType: AtsType, re: RegExp): PatternRule => ({
  atsType,
  re,
  extract: (m) => (m[1] ? { token: m[1], displaySlug: m[1] } : null),
});

const PATTERNS: PatternRule[] = [
  simpleRule("greenhouse", /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board(?:\/js)?\?for=)?([a-z0-9_-]+)/gi),
  simpleRule("greenhouse", /boards-api\.greenhouse\.io\/v1\/boards\/([a-z0-9_-]+)/gi),
  simpleRule("lever", /jobs(?:\.eu)?\.lever\.co\/([a-z0-9_-]+)/gi),
  simpleRule("lever", /api(?:\.eu)?\.lever\.co\/v0\/postings\/([a-z0-9_-]+)/gi),
  simpleRule("ashby", /jobs\.ashbyhq\.com\/([a-z0-9_.-]+)/gi),
  simpleRule("ashby", /api\.ashbyhq\.com\/posting-api\/job-board\/([a-z0-9_.-]+)/gi),
  simpleRule("smartrecruiters", /(?:jobs|careers)\.smartrecruiters\.com\/([a-z0-9_-]+)/gi),
  simpleRule("smartrecruiters", /api\.smartrecruiters\.com\/v1\/companies\/([a-z0-9_-]+)/gi),
  {
    atsType: "workday",
    re: /https?:\/\/([\w-]+)\.(wd[\w-]*)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?(?:wday\/cxs\/[\w-]+\/)?([^/?#"'\s<>]+)/gi,
    extract: (m) => {
      const [, tenant, shard, site] = m;
      if (!tenant || !shard || !site || site.toLowerCase() === "wday") return null;
      return { token: `${tenant}:${shard}:${site}`, displaySlug: tenant };
    },
  },
  {
    atsType: "workday",
    re: /https?:\/\/(wd[\w-]*)\.myworkdaysite\.com\/recruiting\/([\w-]+)\/([^/?#"'\s<>]+)/gi,
    extract: (m) => {
      const [, shard, tenant, site] = m;
      if (!shard || !tenant || !site) return null;
      return { token: `site:${shard}:${tenant}:${site}`, displaySlug: tenant };
    },
  },
  simpleRule("workable", /apply\.workable\.com\/(?:api\/v1\/widget\/accounts\/)?([a-z0-9_-]+)/gi),
  simpleRule("rippling", /ats\.rippling\.com\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?(?:api\/v2\/board\/)?([a-z0-9_-]+)\/jobs/gi),
  simpleRule("recruitee", /([a-z0-9][a-z0-9-]*)\.recruitee\.com/gi),
  simpleRule("bamboohr", /([a-z0-9][a-z0-9-]*)\.bamboohr\.com\/(?:careers|jobs)/gi),
  simpleRule("pinpoint", /([a-z0-9][a-z0-9-]*)\.pinpointhq\.com/gi),
  simpleRule("breezy", /([a-z0-9][a-z0-9-]*)\.breezy\.hr/gi),
  {
    atsType: "dover",
    re: /app\.dover\.com\/([^/?#"'\s<>]+)\/careers\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi,
    extract: (m) => (m[1] && m[2] ? { token: `${m[1]}:${m[2].toLowerCase()}`, displaySlug: m[1] } : null),
  },
  {
    atsType: "personio",
    re: /([a-z0-9][a-z0-9-]*)\.jobs\.personio\.(de|com)/gi,
    extract: (m) => {
      const [, slug, tld] = m;
      if (!slug) return null;
      return { token: tld?.toLowerCase() === "com" ? `${slug.toLowerCase()}.com` : slug.toLowerCase(), displaySlug: slug };
    },
  },
];

/** Every board token a page's HTML points at, most frequent first. Pure, so it is tested without a network. */
export function findBoardsInHtml(html: string): DetectedBoard[] {
  const counts = new Map<string, DetectedBoard & { n: number }>();
  for (const rule of PATTERNS) {
    for (const m of html.matchAll(rule.re)) {
      const extracted = rule.extract(m);
      if (!extracted) continue;
      const { token, displaySlug } = extracted;
      if (!token || NOT_TOKENS.has(displaySlug.toLowerCase()) || displaySlug.length < 2) continue;
      const key = `${rule.atsType}:${token.toLowerCase()}`;
      const hit = counts.get(key);
      if (hit) hit.n++;
      else counts.set(key, { atsType: rule.atsType, token, name: prettifyToken(displaySlug), n: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.n - a.n).map(({ n: _n, ...b }) => b);
}

const PROBE_VENDORS: AtsType[] = [
  "greenhouse", "ashby", "lever", "workable", "smartrecruiters", "rippling", "recruitee", "pinpoint", "breezy",
];

/**
 * Modeled on career-ops-hq/career-ops (`discover-ats.mjs`):
 * Probe public ATS JSON endpoints for a candidate slug when a company's careers page is a JS SPA
 * that does not include the ATS URL in static HTML. Returns the first board with >= 1 open job.
 */
export async function probeCompanySlug(slug: string, displayName?: string): Promise<DetectedBoard | null> {
  const clean = slug.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
  if (!clean || clean.length < 2 || NOT_TOKENS.has(clean)) return null;

  const candidates = await Promise.all(
    PROBE_VENDORS.map(async (atsType) => {
      const feed = FEEDS[atsType];
      if (!feed) return null;
      try {
        const jobs = await feed.fetchJobs(clean);
        if (jobs.length > 0) {
          return {
            atsType,
            token: clean,
            name: displayName || jobs[0]?.companyName || prettifyToken(clean),
            count: jobs.length,
          };
        }
      } catch {
        /* ignore probe misses */
      }
      return null;
    }),
  );

  const hits = candidates.filter((c): c is NonNullable<typeof c> => c !== null).sort((a, b) => b.count - a.count);
  if (!hits.length) return null;
  const best = hits[0]!;
  return { atsType: best.atsType, token: best.token, name: best.name };
}

function slugFromHostname(hostname: string): string | null {
  const parts = hostname.toLowerCase().replace(/^(www|jobs|careers|apply|work|join)\./, "").split(".");
  const main = parts[0]?.replace(/[^a-z0-9_-]/g, "") ?? "";
  return main.length >= 2 && !NOT_TOKENS.has(main) ? main : null;
}

/**
 * Work out which supported job board a company link belongs to:
 * 1. Direct ATS board or posting URL (13 supported ATS platforms).
 * 2. Embedded `?gh_jid=` redirect on a corporate domain.
 * 3. HTML scan of the careers page for embedded ATS links/scripts.
 * 4. `?gh_jid=` links found inside the careers page HTML.
 * 5. Parallel ATS slug probe (`discover-ats.mjs` pattern) if options.probeSlug is enabled.
 */
export async function detectBoard(link: string, opts: { probeSlug?: boolean } = {}): Promise<DetectedBoard | null> {
  const u = safeUrl(link.trim());
  if (!u) return null;
  const direct = matchFeedUrl(u.toString());
  if (direct) {
    const slugPart = direct.token.includes(":") ? direct.token.split(":")[0]! : direct.token;
    return { atsType: direct.feed.atsType, token: direct.token, name: prettifyToken(slugPart) };
  }

  const ghEmbed = await resolveGreenhouseEmbedId(u.toString());
  if (ghEmbed) {
    return { atsType: "greenhouse", token: ghEmbed.token, name: prettifyToken(ghEmbed.token) };
  }

  const res = await safeFetch(u.toString(), {
    headers: { "user-agent": "Mozilla/5.0 (compatible; jobgraph)", accept: "text/html" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;

  const rawBytes = new Uint8Array(await res.arrayBuffer());
  const html = decodePageBytes(rawBytes).slice(0, 1_500_000);
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const siteName = title
    ? htmlToText(title).split(/[|\-–—·]/)[0]!.replace(/\b(careers?|jobs?)\b/gi, "").replace(/\s+/g, " ").trim()
    : "";
  const pickName = (fallback: string) => (siteName.length >= 2 && siteName.length <= 60 ? siteName : fallback);

  const found = findBoardsInHtml(html)[0];
  if (found) return { ...found, name: pickName(found.name) };

  // Check if the page links to a posting with ?gh_jid=123456
  const ghJidMatch = /[?&]gh_jid=(\d{5,})/i.exec(html);
  if (ghJidMatch?.[1]) {
    const resolved = await resolveGreenhouseEmbedId(`${u.origin}/?gh_jid=${ghJidMatch[1]}`);
    if (resolved) return { atsType: "greenhouse", token: resolved.token, name: pickName(prettifyToken(resolved.token)) };
  }

  if (opts.probeSlug) {
    const hostSlug = slugFromHostname(u.hostname);
    if (hostSlug) {
      const probed = await probeCompanySlug(hostSlug, siteName || undefined);
      if (probed) return probed;
    }
  }

  return null;
}
