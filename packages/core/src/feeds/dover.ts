import type { NormalizedJob } from "../contracts.js";
import { getJson, prettifyToken, REMOTE_RE, safeUrl, type FeedSourceExt } from "./http.js";

/**
 * Dover ATS adapter — modeled on career-ops-hq/career-ops (providers/dover.mjs):
 *   Token format: "<Company>:<board-uuid>" or "<board-uuid>"
 *   GET https://app.dover.com/api/v1/careers-page/<board-uuid>/jobs?limit=300&offset=0
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type DoverLocation = {
  name?: string;
  location_type?: string;
  location_option?: { display_name?: string; location_type?: string; city?: string; state?: string; country?: string };
};

type DoverJob = {
  id?: string;
  title?: string;
  is_published?: boolean;
  is_sample?: boolean;
  workplace_type?: string;
  locations?: DoverLocation[];
};

function parseDoverToken(token: string): { company?: string; boardId: string } | null {
  const parts = token.split(":");
  if (parts.length === 2 && UUID_RE.test(parts[1]!)) {
    return { company: parts[0]!, boardId: parts[1]!.toLowerCase() };
  }
  if (UUID_RE.test(token)) {
    return { boardId: token.toLowerCase() };
  }
  return null;
}

function formatDoverLocations(locs: DoverLocation[] | undefined, workplaceType?: string): { location?: string; remote: boolean } {
  const labels: string[] = [];
  let remote = /remote/i.test(workplaceType ?? "");
  for (const l of locs ?? []) {
    const opt = l.location_option;
    if (opt?.location_type === "REGION" && opt.display_name === "International") {
      labels.push("Remote (International)");
      remote = true;
      continue;
    }
    const name = opt?.display_name || l.name || [opt?.city, opt?.state, opt?.country].filter(Boolean).join(", ");
    if (name) labels.push(name);
    if (/remote/i.test(l.location_type ?? "") || REMOTE_RE.test(name ?? "")) remote = true;
  }
  return { location: [...new Set(labels)].join(" | ") || undefined, remote };
}

export const dover: FeedSourceExt = {
  atsType: "dover",
  async fetchJobs(token) {
    const parsed = parseDoverToken(token);
    if (!parsed) return [];
    const data = await getJson<{ results?: DoverJob[] }>(
      `https://app.dover.com/api/v1/careers-page/${encodeURIComponent(parsed.boardId)}/jobs?limit=300&offset=0`,
    ).catch(() => null);
    const items = data?.results ?? [];
    if (!items.length) return [];

    const companySlug = parsed.company || "company";
    const companyName = parsed.company ? prettifyToken(parsed.company) : "Dover Board";
    const out: NormalizedJob[] = [];

    for (const j of items) {
      if (j.is_published === false || j.is_sample === true) continue;
      const id = String(j.id ?? "").trim();
      const title = j.title?.trim();
      if (!id || !title) continue;
      const { location, remote } = formatDoverLocations(j.locations, j.workplace_type);
      out.push({
        atsType: "dover",
        externalId: id,
        companyName,
        companyToken: token,
        title,
        location,
        remote: remote || REMOTE_RE.test(title),
        descriptionText: [title, companyName, location].filter(Boolean).join(" — "),
        applyUrl: `https://app.dover.com/apply/${encodeURIComponent(companySlug)}/${encodeURIComponent(id)}`,
        discoveredVia: "feed",
        raw: j,
      });
    }
    return out;
  },

  parseUrl(url) {
    const u = safeUrl(url);
    if (!u || !/^app\.dover\.com$/i.test(u.hostname)) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    // https://app.dover.com/<Company>/careers/<uuid>
    if (parts.length >= 3 && parts[1] === "careers" && UUID_RE.test(parts[2]!)) {
      return { token: `${parts[0]}:${parts[2]!.toLowerCase()}` };
    }
    // https://app.dover.com/apply/<Company>/<job-uuid>
    if (parts.length >= 3 && parts[0] === "apply" && UUID_RE.test(parts[2]!)) {
      return { token: parts[1]!, externalId: parts[2]!.toLowerCase() };
    }
    return null;
  },
};
