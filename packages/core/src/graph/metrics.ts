/** Quantity extraction and date helpers shared by ingest, facts and query. */

export type ExtractedMetric = { statement: string; value: string | null; unit: string | null };

const MONEY = /\$\s?(\d[\d,]*(?:\.\d+)?)\s?(k|m|b|mm|million|billion|thousand)?\b/i;
const PERCENT = /(\d+(?:\.\d+)?)\s?%/;
const MULTIPLE = /(?<![\w.])(\d+(?:\.\d+)?)\s?[x×](?![A-Za-z0-9])/i;
const COUNT = /(?<![\w.$])(\d[\d,]*(?:\.\d+)?)\s?(k|m|b)?\+?\s+([A-Za-z][A-Za-z-]*)/i;
const SKIP_UNITS = new Set(["years", "year", "yrs", "yr", "months", "month", "th", "st", "nd", "rd", "of", "and"]);

/** Pull the most significant number out of a sentence. Returns null when there is none. */
export function extractQuantity(text: string): { value: string; unit: string } | null {
  const pct = PERCENT.exec(text);
  if (pct) return { value: pct[1], unit: "%" };
  const money = MONEY.exec(text);
  if (money) return { value: `${money[1]}${(money[2] ?? "").replace(/million/i, "M").replace(/billion/i, "B").replace(/thousand/i, "K").toUpperCase()}`, unit: "$" };
  const mult = MULTIPLE.exec(text);
  if (mult) return { value: mult[1], unit: "x" };
  const re = new RegExp(COUNT.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const num = m[1];
    if (/^(19|20)\d{2}$/.test(num) && !m[2]) continue; // a year
    const unit = m[3].toLowerCase();
    if (SKIP_UNITS.has(unit)) continue;
    return { value: `${num}${(m[2] ?? "").toUpperCase()}`, unit };
  }
  return null;
}

export function extractMetrics(text: string): ExtractedMetric[] {
  const q = extractQuantity(text);
  return [{ statement: text, value: q?.value ?? null, unit: q?.unit ?? null }];
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * Normalize "Jan 2022", "January 2022", "01/2022", "2022-01", "2022" to YYYY-MM. Year-only dates get
 * month 01 for starts and 12 for ends. "Present"/"Current" return null.
 */
export function normalizeDate(raw: string | null | undefined, edge: "start" | "end" = "start"): string | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (!s || /^(present|current|now|ongoing|today|till date|to date)$/.test(s)) return null;
  let m = /^(\d{4})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
  m = /^(\d{1,2})[/.](\d{4})$/.exec(s);
  if (m) return `${m[2]}-${m[1].padStart(2, "0")}`;
  m = /^([a-z]{3,9})\.?,?\s+(\d{4})$/.exec(s);
  if (m) {
    const idx = MONTHS.indexOf(m[1].slice(0, 3));
    if (idx >= 0) return `${m[2]}-${String(idx + 1).padStart(2, "0")}`;
  }
  m = /^(\d{4})$/.exec(s);
  if (m) return `${m[1]}-${edge === "start" ? "01" : "12"}`;
  m = /(\d{4})/.exec(s);
  if (m) return `${m[1]}-${edge === "start" ? "01" : "12"}`;
  return null;
}

export function isPresent(raw: string | null | undefined): boolean {
  return !!raw && /^(present|current|now|ongoing|today|till date|to date)$/i.test(raw.trim());
}

/** "2022-03" -> "Mar 2022" */
export function formatDate(d: string | null | undefined): string | undefined {
  if (!d) return undefined;
  const m = /^(\d{4})-(\d{2})/.exec(d);
  if (!m) return d;
  return `${MONTHS[Number(m[2]) - 1]?.replace(/^./, (c) => c.toUpperCase()) ?? ""} ${m[1]}`.trim();
}

/** True when the date is null (still current) or within `years` of now. */
export function isRecent(endDate: string | null | undefined, years = 3, now = new Date()): boolean {
  if (!endDate) return true;
  const m = /^(\d{4})-(\d{2})/.exec(endDate);
  if (!m) return false;
  const end = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 28));
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
  return end >= cutoff;
}
