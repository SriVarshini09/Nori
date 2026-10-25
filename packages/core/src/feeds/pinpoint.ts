import type { NormalizedJob } from "../contracts.js";
import { htmlToText } from "./html.js";
import { getJson, parseDate, prettifyToken, REMOTE_RE, safeUrl, type FeedSourceExt } from "./http.js";
import { guardPostingHtml } from "./posting-guard.js";

/**
 * Pinpoint adapter — modeled on career-ops-hq/career-ops (providers/pinpoint.mjs):
 *   GET https://<slug>.pinpointhq.com/postings.json
 */

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;
/** Canned demo-account video marker from career-ops #4190. */
const PINPOINT_DEMO_VIDEO_MARKER = "youtube.com/embed/https://www.youtube.com/embed/pFxm6fszrpw";

type PinpointPosting = {
  id?: string | number;
  title?: string;
  url?: string;
  path?: string;
  description?: string;
  key_responsibilities?: string;
  skills_knowledge_expertise?: string;
  workplace_type?: string;
  workplace_type_text?: string;
  location?: { name?: string; city?: string; province?: string; country?: string };
  created_at?: string;
   deadline_at?: string;
};

export const pinpoint: FeedSourceExt = {
  atsType: "pinpoint",
  async fetchJobs(token) {
    const slug = token.toLowerCase();
    if (!SLUG_RE.test(slug)) return [];
    const res = await getJson<{ data?: PinpointPosting[] }>(`https://${slug}.pinpointhq.com/postings.json`).catch(() => null);
    const items = res?.data ?? [];
    if (!items.length) return [];

    const companyName = prettifyToken(slug);
    const out: NormalizedJob[] = [];
    for (const p of items) {
      const id = String(p.id ?? p.path ?? "").trim();
      const title = p.title?.trim();
      if (!id || !title) continue;
      const rawHtml = [p.description, p.key_responsibilities, p.skills_knowledge_expertise].filter(Boolean).join("\n");
      if (rawHtml.includes(PINPOINT_DEMO_VIDEO_MARKER)) continue;
      const guarded = guardPostingHtml(rawHtml);
      const location = p.location?.name || [p.location?.city, p.location?.province, p.location?.country].filter(Boolean).join(", ") || undefined;
      const remote = /remote/i.test(p.workplace_type ?? "") || /remote/i.test(p.workplace_type_text ?? "") || REMOTE_RE.test(location ?? "") || REMOTE_RE.test(title);
      const applyUrl = p.url || `https://${slug}.pinpointhq.com${p.path?.startsWith("/") ? p.path : `/postings/${id}`}`;

      out.push({
        atsType: "pinpoint",
        externalId: id,
        companyName,
        companyToken: slug,
        title,
        location,
        remote,
        descriptionText: htmlToText(guarded.cleanedHtml) || title,
        descriptionHtml: guarded.cleanedHtml || undefined,
        applyUrl,
        postedAt: parseDate(p.created_at),
        discoveredVia: "feed",
        raw: p,
      });
    }
    return out;
  },

  parseUrl(url) {
    const u = safeUrl(url);
    if (!u) return null;
    const m = /^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\.pinpointhq\.com$/i.exec(u.hostname);
    if (!m) return null;
    const token = m[1]!.toLowerCase();
    const parts = u.pathname.split("/").filter(Boolean);
    const externalId = parts[0] === "postings" && parts[1] ? parts[1] : undefined;
    return { token, externalId };
  },
};
