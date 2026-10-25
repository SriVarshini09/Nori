import type { AtsType } from "../db/schema.js";
import { ashby } from "./ashby.js";
import { bamboohr } from "./bamboohr.js";
import { breezy } from "./breezy.js";
import { dover } from "./dover.js";
import { greenhouse } from "./greenhouse.js";
import type { FeedSourceExt } from "./http.js";
import { lever } from "./lever.js";
import { personio } from "./personio.js";
import { pinpoint } from "./pinpoint.js";
import { recruitee } from "./recruitee.js";
import { rippling } from "./rippling.js";
import { smartrecruiters } from "./smartrecruiters.js";
import { workable } from "./workable.js";
import { workday } from "./workday.js";

/** Feed sources for all supported zero-token ATS vendors. */
export const FEEDS: Partial<Record<AtsType, FeedSourceExt>> = {
  greenhouse,
  lever,
  ashby,
  smartrecruiters,
  workday,
  workable,
  rippling,
  recruitee,
  bamboohr,
  pinpoint,
  breezy,
  dover,
  personio,
};

export const FEED_LIST: FeedSourceExt[] = [
  greenhouse,
  lever,
  ashby,
  smartrecruiters,
  workday,
  workable,
  rippling,
  recruitee,
  bamboohr,
  pinpoint,
  breezy,
  dover,
  personio,
];

/** Find the feed whose parseUrl recognizes this URL. */
export function matchFeedUrl(url: string): { feed: FeedSourceExt; token: string; externalId?: string } | null {
  for (const feed of FEED_LIST) {
    const p = feed.parseUrl(url);
    if (p) return { feed, ...p };
  }
  return null;
}
