import type { NormalizedJob } from "../contracts.js";
import { htmlToText, unescapeHtml } from "./html.js";
import { getJson, parseDate, prettifyToken, REMOTE_RE, safeUrl, type FeedSourceExt } from "./http.js";

type GhJob = {
  id: number | string; title: string; absolute_url: string; updated_at?: string; first_published?: string;
  location?: { name?: string }; content?: string; company_name?: string;
};

function toJob(token: string, j: GhJob): NormalizedJob {
  const html = unescapeHtml(j.content ?? "");
  const location = j.location?.name || undefined;
  return {
    atsType: "greenhouse",
    externalId: String(j.id),
    companyName: j.company_name || prettifyToken(token),
    companyToken: token,
    title: j.title,
    location,
    remote: REMOTE_RE.test(location ?? "") || REMOTE_RE.test(j.title),
    descriptionText: htmlToText(html),
    descriptionHtml: html || undefined,
    applyUrl: j.absolute_url,
    postedAt: parseDate(j.first_published) ?? parseDate(j.updated_at),
    discoveredVia: "feed",
    raw: j,
  };
}

export const greenhouse: FeedSourceExt = {
  atsType: "greenhouse",
  async fetchJobs(token) {
    const data = await getJson<{ jobs?: GhJob[] }>(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`);
    return (data?.jobs ?? []).map((j) => toJob(token, j));
  },
  parseUrl(url) {
    const u = safeUrl(url);
    if (!u || !/^(boards|job-boards)\.greenhouse\.io$/i.test(u.hostname)) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    // embed form: /embed/job_app?for=token&token=id
    if (parts[0] === "embed") {
      const token = u.searchParams.get("for");
      return token ? { token, externalId: u.searchParams.get("token") ?? undefined } : null;
    }
    if (!parts[0]) return null;
    const externalId = parts[1] === "jobs" && parts[2] ? parts[2] : undefined;
    return { token: parts[0], externalId };
  },
};

/**
 * Where the application form really is. Many companies set their Greenhouse board to redirect to their own careers
 * site (the feed's absolute_url points there too), and that site renders the form late, inside an iframe, or not at
 * all for a headless browser. Greenhouse always serves the bare form at the embed address, so for a Greenhouse job
 * whose link is not on greenhouse.io, open that instead. Returns null when the link is already Greenhouse's own or
 * the board token or job id is unknown.
 */
export function greenhouseFormUrl(job: { atsType: string; applyUrl: string; externalId: string }, boardToken: string | null | undefined): string | null {
  if (job.atsType !== "greenhouse" || !boardToken || !/^\d+$/.test(job.externalId)) return null;
  try {
    const host = new URL(job.applyUrl).hostname;
    if (/(^|\.)greenhouse\.io$/i.test(host)) return null;
  } catch { /* an unparseable link: the embed address is still the best bet */ }
  return `https://job-boards.greenhouse.io/embed/job_app?for=${encodeURIComponent(boardToken)}&token=${job.externalId}`;
}
