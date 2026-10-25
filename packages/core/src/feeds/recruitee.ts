import type { NormalizedJob } from "../contracts.js";
import { htmlToText } from "./html.js";
import { getJson, parseDate, prettifyToken, REMOTE_RE, safeUrl, type FeedSourceExt } from "./http.js";
import { guardPostingHtml } from "./posting-guard.js";

/**
 * Recruitee adapter — modeled on career-ops-hq/career-ops (providers/recruitee.mjs):
 *   GET https://<slug>.recruitee.com/api/offers/
 */

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/i;

type RecruiteeOffer = {
  id?: number | string;
  slug?: string;
  title?: string;
  company_name?: string;
  city?: string;
  state_code?: string;
  country?: string;
  location?: string;
  remote?: boolean;
  hybrid?: boolean;
  description?: string;
  requirements?: string;
  careers_url?: string;
  careers_apply_url?: string;
  published_at?: string;
  created_at?: string;
};

export const recruitee: FeedSourceExt = {
  atsType: "recruitee",
  async fetchJobs(token) {
    const slug = token.toLowerCase();
    if (!SLUG_RE.test(slug)) return [];
    const data = await getJson<{ offers?: RecruiteeOffer[] }>(`https://${slug}.recruitee.com/api/offers/`).catch(() => null);
    if (!data?.offers) return [];
    const out: NormalizedJob[] = [];
    for (const o of data.offers) {
      const id = String(o.id ?? o.slug ?? "").trim();
      const title = o.title?.trim();
      if (!id || !title) continue;
      const html = [o.description, o.requirements].filter(Boolean).join("\n");
      const guarded = guardPostingHtml(html);
      const location = o.location?.trim() || [o.city, o.state_code, o.country].filter(Boolean).join(", ") || undefined;
      const remote = Boolean(o.remote) || REMOTE_RE.test(location ?? "") || REMOTE_RE.test(title);
      out.push({
        atsType: "recruitee",
        externalId: id,
        companyName: o.company_name?.trim() || prettifyToken(slug),
        companyToken: slug,
        title,
        location,
        remote,
        descriptionText: htmlToText(guarded.cleanedHtml) || title,
        descriptionHtml: guarded.cleanedHtml || undefined,
        applyUrl: o.careers_url || o.careers_apply_url || `https://${slug}.recruitee.com/o/${o.slug || id}`,
        postedAt: parseDate(o.published_at) ?? parseDate(o.created_at),
        discoveredVia: "feed",
        raw: o,
      });
    }
    return out;
  },

  parseUrl(url) {
    const u = safeUrl(url);
    if (!u) return null;
    const m = /^([a-z0-9][a-z0-9-]*)\.recruitee\.com$/i.exec(u.hostname);
    if (!m) return null;
    const token = m[1]!.toLowerCase();
    const parts = u.pathname.split("/").filter(Boolean);
    const externalId = (parts[0] === "o" || parts[0] === "career") && parts[1] ? parts[1] : undefined;
    return { token, externalId };
  },
};
