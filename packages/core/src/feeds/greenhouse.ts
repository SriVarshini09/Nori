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
  async fetchJob(token, externalId) {
    const j = await getJson<GhJob>(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs/${encodeURIComponent(externalId)}?questions=false`).catch(() => null);
    return j?.title ? toJob(token, j) : null;
  },
  parseUrl(url) {
    const u = safeUrl(url);
    if (!u || !/^(boards|job-boards)(\.eu)?\.greenhouse\.io$/i.test(u.hostname)) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    // embed form: /embed/job_app?for=token&token=id or /embed/job_board?for=token
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
 * Resolve a corporate careers URL carrying `?gh_jid=<id>` (e.g. https://stripe.com/jobs/listing/foo?gh_jid=123456)
 * to its Greenhouse `{ token, externalId }` by inspecting the 301/302 Location header from
 * `https://boards.greenhouse.io/embed/job_app?token=<id>`. Modeled on career-ops/liveness-api.mjs.
 */
export async function resolveGreenhouseEmbedId(rawUrl: string): Promise<{ token: string; externalId: string } | null> {
  const u = safeUrl(rawUrl);
  if (!u || /(^|\.)greenhouse\.io$/i.test(u.hostname)) return null;
  const ghJid = u.searchParams.get("gh_jid") ?? u.searchParams.get("gh_src_jid");
  if (!ghJid || !/^\d+$/.test(ghJid)) return null;
  try {
    const res = await fetch(`https://boards.greenhouse.io/embed/job_app?token=${ghJid}`, {
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
    });
    if (res.status !== 301 && res.status !== 302) return null;
    const loc = res.headers.get("location");
    if (!loc) return null;
    const target = new URL(loc, "https://boards.greenhouse.io");
    const board = target.searchParams.get("for");
    if (!board || !/^[A-Za-z0-9._-]+$/.test(board)) return null;
    return { token: board, externalId: ghJid };
  } catch {
    return null;
  }
}

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
