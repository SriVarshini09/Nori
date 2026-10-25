import type { NormalizedJob } from "../contracts.js";
import { htmlToText } from "./html.js";
import { getJson, parseDate, prettifyToken, REMOTE_RE, safeUrl, type FeedSourceExt } from "./http.js";

type LeverPosting = {
  id: string; text: string; hostedUrl?: string; applyUrl?: string;
  description?: string; descriptionPlain?: string; additional?: string; additionalPlain?: string;
  lists?: { text: string; content: string }[];
  categories?: { location?: string; allLocations?: string[]; team?: string; commitment?: string };
  createdAt?: number; workplaceType?: string;
};

function toJob(token: string, p: LeverPosting): NormalizedJob {
  const listsText = (p.lists ?? []).map((l) => `${l.text}\n${htmlToText(l.content)}`).join("\n\n");
  const text = [p.descriptionPlain ?? htmlToText(p.description ?? ""), listsText, p.additionalPlain ?? htmlToText(p.additional ?? "")]
    .filter((s) => s && s.trim()).join("\n\n");
  const location = p.categories?.location || p.categories?.allLocations?.[0] || undefined;
  const wt = (p.workplaceType ?? "").toLowerCase();
  return {
    atsType: "lever",
    externalId: p.id,
    companyName: prettifyToken(token),
    companyToken: token,
    title: p.text,
    location,
    remote: wt === "remote" || REMOTE_RE.test(location ?? ""),
    descriptionText: text,
    descriptionHtml: [p.description, ...(p.lists ?? []).map((l) => `<h3>${l.text}</h3>${l.content}`), p.additional].filter(Boolean).join("\n") || undefined,
    applyUrl: p.hostedUrl ?? p.applyUrl ?? "",
    postedAt: parseDate(p.createdAt),
    discoveredVia: "feed",
    raw: p,
  };
}

export const lever: FeedSourceExt = {
  atsType: "lever",
  async fetchJobs(token) {
    const data = await getJson<LeverPosting[]>(`https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json`);
    return Array.isArray(data) ? data.map((p) => toJob(token, p)) : [];
  },
  async fetchJob(token, externalId) {
    const p = await getJson<LeverPosting>(`https://api.lever.co/v0/postings/${encodeURIComponent(token)}/${encodeURIComponent(externalId)}`).catch(() => null);
    return p?.id && p?.text ? toJob(token, p) : null;
  },
  parseUrl(url) {
    const u = safeUrl(url);
    if (!u || !/^jobs\.(eu\.)?lever\.co$/i.test(u.hostname)) return null;
    const [token, externalId] = u.pathname.split("/").filter(Boolean);
    return token ? { token, externalId } : null;
  },
};
