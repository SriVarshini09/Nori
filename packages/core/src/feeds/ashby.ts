import type { NormalizedJob } from "../contracts.js";
import { htmlToText } from "./html.js";
import { getJson, parseDate, prettifyToken, REMOTE_RE, safeUrl, type FeedSourceExt } from "./http.js";

type AshbyJob = {
  id: string; title: string; location?: string; isRemote?: boolean; isListed?: boolean;
  descriptionPlain?: string; descriptionHtml?: string; jobUrl?: string; applyUrl?: string; publishedAt?: string;
  workplaceType?: string;
};

export const ashby: FeedSourceExt = {
  atsType: "ashby",
  async fetchJobs(token) {
    const data = await getJson<{ jobs?: AshbyJob[] }>(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}`);
    return (data?.jobs ?? [])
      .filter((j) => j.isListed !== false)
      .map((j): NormalizedJob => ({
        atsType: "ashby",
        externalId: j.id,
        companyName: prettifyToken(token),
        companyToken: token,
        title: j.title,
        location: j.location || undefined,
        remote: Boolean(j.isRemote) || (j.workplaceType ?? "").toLowerCase() === "remote" || REMOTE_RE.test(j.location ?? ""),
        descriptionText: j.descriptionPlain || htmlToText(j.descriptionHtml ?? ""),
        descriptionHtml: j.descriptionHtml || undefined,
        applyUrl: j.applyUrl || j.jobUrl || "",
        postedAt: parseDate(j.publishedAt),
        discoveredVia: "feed",
        raw: j,
      }));
  },
  parseUrl(url) {
    const u = safeUrl(url);
    if (!u || !/^jobs\.ashbyhq\.com$/i.test(u.hostname)) return null;
    const [token, externalId] = u.pathname.split("/").filter(Boolean);
    return token ? { token: decodeURIComponent(token), externalId } : null;
  },
};
