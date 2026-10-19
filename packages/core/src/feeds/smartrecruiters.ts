import type { NormalizedJob } from "../contracts.js";
import { htmlToText } from "./html.js";
import { getJson, parseDate, prettifyToken, safeUrl, type FeedSourceExt } from "./http.js";

type SrListItem = {
  id: string; name: string; releasedDate?: string;
  company?: { identifier?: string; name?: string };
  location?: { city?: string; region?: string; country?: string; remote?: boolean; fullLocation?: string };
};
type SrDetail = SrListItem & {
  applyUrl?: string; postingUrl?: string;
  jobAd?: { sections?: Record<string, { title?: string; text?: string } | undefined> };
};

const SECTION_ORDER = ["companyDescription", "jobDescription", "qualifications", "additionalInformation"];
const MAX_POSTINGS = 200;

function locationOf(l: SrListItem["location"]): string | undefined {
  if (!l) return undefined;
  return l.fullLocation || [l.city, l.region, l.country?.toUpperCase()].filter(Boolean).join(", ") || undefined;
}

function toJob(token: string, d: SrDetail): NormalizedJob {
  const sections = SECTION_ORDER.map((k) => d.jobAd?.sections?.[k]).filter((s) => s?.text);
  const html = sections.map((s) => `<h3>${s!.title ?? ""}</h3>${s!.text}`).join("\n");
  const text = sections.map((s) => `${s!.title ?? ""}\n${htmlToText(s!.text!)}`).join("\n\n").trim();
  return {
    atsType: "smartrecruiters",
    externalId: String(d.id),
    companyName: d.company?.name || prettifyToken(token),
    companyToken: token,
    title: d.name,
    location: locationOf(d.location),
    remote: Boolean(d.location?.remote),
    descriptionText: text,
    descriptionHtml: html || undefined,
    applyUrl: d.postingUrl || d.applyUrl || `https://jobs.smartrecruiters.com/${token}/${d.id}`,
    postedAt: parseDate(d.releasedDate),
    discoveredVia: "feed",
    raw: d,
  };
}

function fetchDetail(token: string, id: string): Promise<SrDetail | null> {
  return getJson<SrDetail>(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(token)}/postings/${encodeURIComponent(id)}`);
}

export const smartrecruiters: FeedSourceExt = {
  atsType: "smartrecruiters",
  async fetchJobs(token) {
    const items: SrListItem[] = [];
    for (let offset = 0; items.length < MAX_POSTINGS; offset += 100) {
      const page = await getJson<{ content?: SrListItem[]; totalFound?: number }>(
        `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(token)}/postings?limit=100&offset=${offset}`);
      if (!page) return [];
      const batch = page.content ?? [];
      items.push(...batch);
      if (batch.length < 100 || items.length >= (page.totalFound ?? 0)) break;
    }
    const out: NormalizedJob[] = [];
    const queue = items.slice(0, MAX_POSTINGS);
    const workers = Array.from({ length: 5 }, async () => {
      for (let it = queue.shift(); it; it = queue.shift()) {
        let detail: SrDetail | null = null;
        try { detail = await fetchDetail(token, it.id); } catch { /* keep list-level data */ }
        out.push(toJob(token, detail ?? it));
      }
    });
    await Promise.all(workers);
    return out;
  },
  async fetchJob(token, externalId) {
    const d = await fetchDetail(token, externalId);
    return d ? toJob(token, d) : null;
  },
  parseUrl(url) {
    const u = safeUrl(url);
    if (!u || !/^(jobs|careers)\.smartrecruiters\.com$/i.test(u.hostname)) return null;
    const [token, slug] = u.pathname.split("/").filter(Boolean);
    if (!token) return null;
    const externalId = slug ? (slug.match(/^(\d+)/)?.[1] ?? slug) : undefined;
    return { token, externalId };
  },
};
