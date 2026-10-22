export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2021-03" / "2021-03-15" -> "Mar 2021"; "2021" stays; "present"/"current" -> "Present"; anything else passes through. */
export function formatDate(d?: string | null): string {
  if (!d) return "";
  const t = d.trim();
  if (/^(present|current|now)$/i.test(t)) return "Present";
  const m = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?/.exec(t);
  if (m) {
    const mi = Number(m[2]) - 1;
    return mi >= 0 && mi < 12 ? `${MONTHS[mi]} ${m[1]}` : m[1];
  }
  return t;
}

export function dateRange(start?: string | null, end?: string | null): string {
  const s = formatDate(start);
  const e = formatDate(end) || (s ? "Present" : "");
  if (s && e) return `${s} – ${e}`;
  return s || e;
}

/** Visible text for a URL: no scheme, no www, no trailing slash. */
export function displayUrl(u: string): string {
  return u.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "");
}

export function hrefOf(u: string): string {
  const t = u.trim();
  return /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`;
}
