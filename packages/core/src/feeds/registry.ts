import type { AtsType } from "../db/schema.js";
import { ashby } from "./ashby.js";
import { greenhouse } from "./greenhouse.js";
import { lever } from "./lever.js";
import { smartrecruiters } from "./smartrecruiters.js";
import type { FeedSourceExt } from "./http.js";

/** Feed sources for the four supported ATS vendors. Other AtsTypes (workday, web, manual) have none. */
export const FEEDS: Partial<Record<AtsType, FeedSourceExt>> = { greenhouse, lever, ashby, smartrecruiters };

export const FEED_LIST: FeedSourceExt[] = [greenhouse, lever, ashby, smartrecruiters];

/** Find the feed whose parseUrl recognizes this URL. */
export function matchFeedUrl(url: string): { feed: FeedSourceExt; token: string; externalId?: string } | null {
  for (const feed of FEED_LIST) {
    const p = feed.parseUrl(url);
    if (p) return { feed, ...p };
  }
  return null;
}
