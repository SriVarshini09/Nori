import type { ResumeContent } from "../db/schema.js";

export type Density = "normal" | "compact" | "tight";

/** Section headings in the order ATS parsers and recruiters expect. */
export const SECTION_ORDER = ["Summary", "Experience", "Education", "Skills", "Projects", "Certifications"] as const;

const DENSITY: Record<Density, { body: number; name: number; h2: number; lh: number; secGap: number; roleGap: number; liGap: number; contact: number }> = {
  normal: { body: 11, name: 19, h2: 12, lh: 1.32, secGap: 11, roleGap: 7, liGap: 2, contact: 10.5 },
  compact: { body: 10.75, name: 17.5, h2: 11.5, lh: 1.24, secGap: 8, roleGap: 5, liGap: 1, contact: 10 },
  tight: { body: 10.5, name: 16, h2: 11, lh: 1.16, secGap: 6, roleGap: 3.5, liGap: 0, contact: 9.75 },
};

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

/**
 * Single-column, ATS-safe resume HTML: real text, semantic headings, standard fonts, no tables,
 * images, icons or multi-column layout. Letter size with 0.5in margins.
 */
export function renderHtml(content: ResumeContent, density: Density = "normal"): string {
  const d = DENSITY[density];
  const e = escapeHtml;
  const contactParts = [content.contact.email, content.contact.phone, content.contact.location, content.contact.linkedin, content.contact.website]
    .filter((x): x is string => !!x && !!x.trim())
    .map((x) => e(x.trim()));

  const sections: string[] = [];
  for (const name of SECTION_ORDER) {
    const body = sectionBody(name, content);
    if (body) sections.push(`<section class="sec" id="${name.toLowerCase()}">\n<h2>${name}</h2>\n${body}\n</section>`);
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${e(content.name)} - Resume</title>
<style>
@page { size: Letter; margin: 0.5in; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: Calibri, Carlito, Arial, Helvetica, sans-serif; font-size: ${d.body}pt; line-height: ${d.lh}; color: #111; }
h1 { font-size: ${d.name}pt; margin: 0 0 2pt 0; font-weight: 700; letter-spacing: 0.2pt; }
.contact { font-size: ${d.contact}pt; margin: 0 0 ${Math.max(2, d.secGap - 4)}pt 0; color: #222; }
h2 { font-size: ${d.h2}pt; text-transform: uppercase; letter-spacing: 0.6pt; margin: ${d.secGap}pt 0 3pt 0; padding-bottom: 1pt; border-bottom: 0.75pt solid #444; font-weight: 700; }
.sec:first-of-type h2 { margin-top: ${Math.max(4, d.secGap - 3)}pt; }
h3 { font-size: ${d.body}pt; margin: ${d.roleGap}pt 0 1pt 0; font-weight: 700; display: flex; justify-content: space-between; gap: 8pt; }
h3 .when { font-weight: 400; white-space: nowrap; }
.sub { margin: 0 0 1pt 0; font-style: italic; }
p { margin: 0; }
ul { margin: 1pt 0 0 0; padding-left: 14pt; }
li { margin: 0 0 ${d.liGap}pt 0; }
.skills p { margin: 0 0 1pt 0; }
.edu { margin: ${d.roleGap * 0.6}pt 0 0 0; }
</style>
</head>
<body>
<header>
<h1>${e(content.name)}</h1>
${contactParts.length ? `<p class="contact">${contactParts.join(" | ")}</p>` : ""}
</header>
${sections.join("\n")}
</body>
</html>
`;
}

function bullets(items: { text: string }[]): string {
  const li = items.map((b) => b.text.trim()).filter(Boolean).map((t) => `<li>${escapeHtml(t)}</li>`);
  return li.length ? `<ul>\n${li.join("\n")}\n</ul>` : "";
}

function sectionBody(name: (typeof SECTION_ORDER)[number], c: ResumeContent): string {
  const e = escapeHtml;
  switch (name) {
    case "Summary":
      return c.summary?.trim() ? `<p>${e(c.summary.trim())}</p>` : "";
    case "Experience":
      return c.experience.map((r) => {
        const when = dateRange(r.start, r.end);
        const heading = [r.title, r.company].filter(Boolean).map((x) => e(x)).join(", ");
        return `<div class="role">\n<h3><span>${heading}</span>${when ? `<span class="when">${e(when)}</span>` : ""}</h3>\n${r.location ? `<p class="sub">${e(r.location)}</p>\n` : ""}${bullets(r.bullets)}\n</div>`;
      }).join("\n");
    case "Education":
      return c.education.map((ed) => {
        const deg = [ed.degree, ed.field].filter(Boolean).join(", ");
        const when = dateRange(ed.start, ed.end);
        const left = [deg, ed.school].filter(Boolean).map((x) => e(x!)).join(" - ");
        return `<div class="edu"><h3><span>${left}</span>${when ? `<span class="when">${e(when)}</span>` : ""}</h3></div>`;
      }).join("\n");
    case "Skills": {
      const rows = c.skills.filter((g) => g.items.length > 0).map((g) => `<p><strong>${e(g.group)}:</strong> ${g.items.map((i) => e(i)).join(", ")}</p>`);
      return rows.length ? `<div class="skills">\n${rows.join("\n")}\n</div>` : "";
    }
    case "Projects":
      return (c.projects ?? []).filter((p) => p.name).map((p) => `<div class="role">\n<h3><span>${e(p.name)}</span></h3>\n${bullets(p.bullets)}\n</div>`).join("\n");
    case "Certifications": {
      const certs = (c.certifications ?? []).filter((x) => x.trim());
      return certs.length ? bullets(certs.map((t) => ({ text: t }))) : "";
    }
  }
}
