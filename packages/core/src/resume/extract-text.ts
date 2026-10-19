/**
 * Resume file -> clean reading-order text plus the hyperlinks hidden behind words.
 *
 * PDF: text items with positions (pdf.js via unpdf), link annotations (URI actions), two-column detection
 * by finding a vertical gutter no text crosses, lines rebuilt by baseline proximity, bullets kept on their
 * own lines. DOCX: mammoth HTML with <a href> and tables flattened row by row. TXT/MD: as-is.
 * Parsers load lazily so callers that never see a file pay nothing at startup.
 */

export type ExtractedLink = { url: string; anchor?: string };
export type ExtractedResume = {
  text: string;
  links: ExtractedLink[];
  pages: number;
  layout: "single" | "multi" | "unknown";
  hadTextLayer: boolean;
  /** Set when the file had no extractable text (scanned PDF without OCR available). */
  error?: string;
};

export const SCANNED_PDF_ERROR = "scanned PDF, please upload a text-based PDF or DOCX";

const BULLET_CHARS = "•·●▪■◦‣▸►○∙➢➤✓✔◆◇□–-*";
/** Private-use and symbol-font glyphs Word and LaTeX emit for list bullets. */
const ODD_BULLETS = /^[•●▪◦‣⁃∙]\s*/;

export function normalizeText(text: string): string {
  return text
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[   ]/g, " ")
    .replace(/[​-‍⁠]/g, "")
    .replace(/ﬁ/g, "fi").replace(/ﬂ/g, "fl").replace(/ﬀ/g, "ff").replace(/ﬃ/g, "ffi").replace(/ﬄ/g, "ffl")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/g, "").replace(ODD_BULLETS, (m) => (m.trim() ? "• " : m)))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** "pdf" | "docx" | "txt" from a MIME type or extension ("application/pdf", ".docx", "md"). */
export function resumeFormat(mimeOrExt: string): "pdf" | "docx" | "txt" | null {
  const s = mimeOrExt.toLowerCase().trim();
  if (s.includes("pdf")) return "pdf";
  if (s.includes("wordprocessingml") || /(?:^|\.)docx$/.test(s)) return "docx";
  if (s.startsWith("text/") || /(?:^|\.)(?:txt|md|markdown|text)$/.test(s)) return "txt";
  return null;
}

export async function extractResume(buffer: Uint8Array | ArrayBuffer | Buffer, mimeOrExt: string): Promise<ExtractedResume> {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const fmt = resumeFormat(mimeOrExt) ?? sniff(bytes);
  if (fmt === "pdf") return extractPdf(bytes);
  if (fmt === "docx") return extractDocx(bytes);
  const raw = new TextDecoder("utf-8").decode(bytes);
  const links: ExtractedLink[] = [];
  const isMd = /(?:^|\.|\/)(?:md|markdown)$/i.test(mimeOrExt.trim()) || /\[[^\]\n]+\]\(https?:[^)\s]+\)|^#{1,6}\s/m.test(raw);
  const text = normalizeText(isMd ? markdownToText(raw, links) : raw);
  return { text, links, pages: 1, layout: "single", hadTextLayer: true };
}

/** Markdown -> plain lines: [text](url) becomes text (url collected), emphasis and heading marks dropped, list items become "• ". */
function markdownToText(md: string, links: ExtractedLink[]): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]\n]+)\]\(((?:https?:|mailto:|tel:)[^)\s]+)\)/g, (_m, anchor: string, url: string) => {
      if (!links.some((l) => l.url === url)) links.push({ url, anchor: anchor.trim() });
      return anchor;
    })
    .replace(/<((?:https?:|mailto:)[^>\s]+)>/g, (_m, url: string) => { if (!links.some((l) => l.url === url)) links.push({ url }); return url; })
    .split("\n")
    .map((l) => l
      .replace(/^\s{0,3}#{1,6}\s+/, "")
      .replace(/^\s*(?:[-*+])\s+/, "• ")
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,;:]|$)/g, "$1$2")
      .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/, ""))
    .join("\n");
}

function sniff(b: Uint8Array): "pdf" | "docx" | "txt" {
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "pdf";
  if (b[0] === 0x50 && b[1] === 0x4b) return "docx";
  return "txt";
}

// ====================================================================== PDF
type Item = { str: string; x: number; y: number; w: number; h: number };
type Line = { y: number; h: number; x: number; items: Item[] };

async function extractPdf(bytes: Uint8Array): Promise<ExtractedResume> {
  const { getDocumentProxy } = await import("unpdf");
  // pdf.js transfers (detaches) the buffer it is given; hand it a copy so callers keep theirs.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const pageTexts: string[] = [];
  const links: ExtractedLink[] = [];
  let multi = false;
  let chars = 0;
  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const [, , pw] = page.view;
      const content = await page.getTextContent();
      const items: Item[] = [];
      for (const it of content.items as { str?: string; transform?: number[]; width?: number; height?: number }[]) {
        if (typeof it.str !== "string" || !it.transform) continue;
        if (!it.str.trim()) continue;
        const h = Math.abs(it.height || it.transform[3] || it.transform[0] || 10);
        items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width ?? 0, h });
      }
      chars += items.reduce((n, i) => n + i.str.trim().length, 0);

      const annots = (await page.getAnnotations().catch(() => [])) as { subtype?: string; url?: string; unsafeUrl?: string; rect?: number[] }[];
      for (const a of annots) {
        const url = a.subtype === "Link" ? a.url ?? a.unsafeUrl : undefined;
        if (!url || !a.rect) continue;
        const [x1, y1, x2, y2] = a.rect;
        const inside = items.filter((i) => {
          const cx = i.x + i.w / 2, cy = i.y + i.h / 3;
          return cx >= Math.min(x1, x2) - 1 && cx <= Math.max(x1, x2) + 1 && cy >= Math.min(y1, y2) - 2 && cy <= Math.max(y1, y2) + 2;
        }).sort((a2, b2) => b2.y - a2.y || a2.x - b2.x);
        const anchor = inside.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim();
        if (!links.some((l) => l.url === url)) links.push(anchor ? { url, anchor } : { url });
      }

      const { text, columns } = layoutPage(items, pw);
      if (columns > 1) multi = true;
      pageTexts.push(text);
    }
  } finally {
    await closePdf(pdf);
  }

  const pages = pageTexts.length;
  if (chars < 20) {
    const ocr = await tryOcr(bytes, pages);
    if (ocr) return { text: normalizeText(ocr), links, pages, layout: "unknown", hadTextLayer: false };
    return { text: "", links, pages, layout: "unknown", hadTextLayer: false, error: SCANNED_PDF_ERROR };
  }
  return { text: normalizeText(pageTexts.join("\n\n")), links, pages, layout: multi ? "multi" : "single", hadTextLayer: true };
}

type Gutter = { x: number; rightEdge: number };

/** Most common value (within `tol`) of a list of numbers, with its share. */
function modeOf(xs: number[], tol: number): { value: number; share: number } {
  let best = { value: xs[0] ?? 0, count: 0 };
  for (const x of xs) {
    const count = xs.filter((y) => Math.abs(y - x) <= tol).length;
    if (count > best.count) best = { value: x, count };
  }
  return { value: best.value, share: xs.length ? best.count / xs.length : 0 };
}

/**
 * Find a vertical gutter: an x in the middle of the page that (almost) no text crosses, with real text on
 * both sides, and whose right-hand lines share a left edge (a column), unlike right-aligned dates.
 */
function findGutter(items: Item[], pageWidth: number): Gutter | null {
  const lines = groupLines(items);
  if (lines.length < 8) return null;
  const minX = Math.min(...items.map((i) => i.x)), maxX = Math.max(...items.map((i) => i.x + i.w));
  const width = maxX - minX;
  if (width < pageWidth * 0.4) return null;
  const step = 2;
  const candidates: { x: number; ok: boolean }[] = [];
  for (let x = minX + width * 0.18; x <= minX + width * 0.82; x += step) {
    let crossing = 0, left = 0, right = 0;
    for (const l of lines) {
      let lc = false, ll = false, lr = false;
      for (const i of l.items) {
        if (i.x < x - 1 && i.x + i.w > x + 1) lc = true;
        else if (i.x + i.w <= x + 1) ll = true;
        else lr = true;
      }
      if (lc) crossing++;
      if (ll) left++;
      if (lr) right++;
    }
    candidates.push({ x, ok: crossing <= Math.max(1, lines.length * 0.12) && left >= lines.length * 0.25 && right >= lines.length * 0.25 });
  }
  let best: { x: number; run: number } | null = null;
  let runStart = -1;
  for (let k = 0; k <= candidates.length; k++) {
    if (candidates[k]?.ok) { if (runStart < 0) runStart = k; continue; }
    if (runStart >= 0) {
      const run = k - runStart;
      const center = candidates[runStart].x + ((run - 1) * step) / 2;
      if (run * step >= 6 && (!best || run > best.run)) best = { x: center, run };
      runStart = -1;
    }
  }
  if (!best) return null;
  const g = best.x;
  // The right side must look like a column: most of its lines start at one left edge.
  const starts = lines.map((l) => l.items.find((i) => i.x >= g - 1)?.x).filter((x): x is number => x !== undefined);
  const edge = modeOf(starts, 3);
  if (edge.share < 0.5 || starts.length < 6) return null;
  return { x: g, rightEdge: edge.value };
}

function groupLines(items: Item[]): Line[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Line[] = [];
  for (const it of sorted) {
    const tol = Math.max(2, Math.min(it.h, 14) * 0.45);
    const line = lines.find((l) => Math.abs(l.y - it.y) <= tol);
    if (line) { line.items.push(it); line.h = Math.max(line.h, it.h); line.x = Math.min(line.x, it.x); }
    else lines.push({ y: it.y, h: it.h, x: it.x, items: [it] });
  }
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);
  return lines.sort((a, b) => b.y - a.y);
}

const BULLET_START = new RegExp(`^[${BULLET_CHARS.replace(/[-\]\\]/g, "\\$&")}]$`);
const HAS_BULLET = /^\s*(?:[•·●▪■◦‣▸►○∙➢➤✓✔◆◇□]|[-–—*]\s)/;

function lineText(l: Line): string {
  let out = "";
  let prev: Item | null = null;
  for (const it of l.items) {
    if (prev) {
      const gap = it.x - (prev.x + prev.w);
      const fs = Math.max(4, Math.min(prev.h, it.h));
      const prevBullet = BULLET_START.test(prev.str.trim());
      if (gap > fs * 2.5 && !prevBullet) out = out.replace(/\s+$/, "") + "   ";
      else if (gap > fs * 0.12 && !/\s$/.test(out) && !/^\s/.test(it.str)) out += " ";
      else if (prevBullet && !/\s$/.test(out)) out += " ";
    }
    out += it.str;
    prev = it;
  }
  out = out.replace(/\s+$/, "");
  // A bullet glyph after a wide gap starts a new logical line.
  return out.replace(/\s{2,}([•●▪■◦‣▸►])\s*/g, "\n$1 ").replace(/^([•●▪■◦‣▸►])(?=\S)/, "$1 ");
}

const right = (l: Line) => Math.max(...l.items.map((i) => i.x + i.w));

/**
 * Lines of one column -> text. List markers drawn as graphics (Chromium, many design tools) leave no glyph,
 * so indented runs are recovered as bullets: a line at a recurring indent starts a new bullet unless the line
 * before it ran to the right margin (a wrapped continuation).
 */
function linesToText(lines: Line[]): string {
  if (!lines.length) return "";
  const left = Math.min(...lines.map((l) => l.x));
  const rightMargin = Math.max(...lines.map(right));
  const width = Math.max(1, rightMargin - left);
  const indents = lines.map((l) => l.x - left).filter((d) => d > 5 && d < 45);
  const indent = indents.length >= 2 ? modeOf(indents, 1.5) : null;
  const isIndented = (l: Line) => indent !== null && Math.abs(l.x - left - indent.value) <= 1.5;
  const centered = (l: Line) => Math.abs((l.x - left) - (rightMargin - right(l))) < 8 && l.x - left > 20;

  const out: string[] = [];
  let prev: Line | null = null;
  let prevListed = false;
  for (const l of lines) {
    let gapBreak = false;
    if (prev) {
      const gap = prev.y - l.y;
      if (gap > Math.max(prev.h, l.h) * 1.9) { out.push(""); gapBreak = true; }
    }
    let text = lineText(l);
    let listed = false;
    if (isIndented(l) && !centered(l) && !HAS_BULLET.test(text)) {
      // Word-wrap test: a continuation's first word could not have fit in the space left on the line before.
      let wrapped = false;
      if (prev && prevListed && !gapBreak && Math.abs(prev.x - l.x) <= 1.5 && !/[.!?]$/.test(lineText(prev).trim())) {
        const charW = (right(l) - l.x) / Math.max(1, text.length);
        const firstWord = (text.split(/\s+/)[0] ?? "").length * charW;
        const remaining = rightMargin - right(prev);
        wrapped = firstWord + charW * 1.5 > remaining && right(prev) >= rightMargin - width * 0.25;
      }
      if (!wrapped) text = `• ${text}`;
      listed = true;
    }
    out.push(text);
    prevListed = listed || HAS_BULLET.test(text);
    prev = l;
  }
  return out.join("\n");
}

/**
 * Reading-order text for one page. Rows that cross the gutter, or sit centered on the page off the column
 * edges (a name banner), are full-width bands; between them, the left column is read before the right.
 */
function layoutPage(items: Item[], pageWidth: number): { text: string; columns: number } {
  if (!items.length) return { text: "", columns: 1 };
  const gutter = findGutter(items, pageWidth);
  if (gutter == null) return { text: linesToText(groupLines(items)), columns: 1 };
  const g = gutter.x;

  const rows = groupLines(items);
  const minX = Math.min(...items.map((i) => i.x)), maxX = Math.max(...items.map((i) => i.x + i.w));
  const center = (minX + maxX) / 2;
  const full = (l: Line) => {
    if (l.items.some((i) => i.x < g - 1 && i.x + i.w > g + 1)) return true;
    const lx = l.x, rx = right(l);
    const offEdges = Math.abs(lx - minX) > 4 && Math.abs(lx - gutter.rightEdge) > 4;
    return offEdges && Math.abs((lx + rx) / 2 - center) < 12;
  };
  const parts: string[] = [];
  let band: Line[] = [];
  let bandSplit = false;
  const flush = () => {
    if (!band.length) return;
    if (!bandSplit) parts.push(linesToText(band));
    else {
      const left: Line[] = [], rightCol: Line[] = [];
      for (const l of band) {
        const li = l.items.filter((i) => i.x + i.w / 2 < g);
        const ri = l.items.filter((i) => i.x + i.w / 2 >= g);
        if (li.length) left.push({ ...l, items: li, x: li[0].x });
        if (ri.length) rightCol.push({ ...l, items: ri, x: ri[0].x });
      }
      parts.push([linesToText(left), linesToText(rightCol)].filter(Boolean).join("\n\n"));
    }
    band = [];
  };
  for (const r of rows) {
    const split = !full(r);
    if (band.length && split !== bandSplit) flush();
    bandSplit = split;
    band.push(r);
  }
  flush();
  return { text: parts.filter(Boolean).join("\n\n"), columns: 2 };
}

/** OCR fallback when tesseract.js and @napi-rs/canvas are installed (both optional). */
async function tryOcr(bytes: Uint8Array, pages: number): Promise<string | null> {
  const dyn = (m: string) => import(/* @vite-ignore */ m) as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const tesseract = await dyn("tesseract.js");
    const canvasMod = "@napi-rs/canvas";
    await dyn(canvasMod);
    const { renderPageAsImage, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const worker = await tesseract.createWorker("eng");
    const texts: string[] = [];
    try {
      for (let p = 1; p <= Math.min(pages, 6); p++) {
        const img = await renderPageAsImage(pdf, p, { canvasImport: () => dyn(canvasMod), scale: 2.5 });
        const { data } = await worker.recognize(Buffer.from(img));
        texts.push(String(data.text ?? ""));
      }
    } finally {
      await worker.terminate();
      await closePdf(pdf);
    }
    const text = texts.join("\n\n").trim();
    return text.length >= 20 ? text : null;
  } catch {
    return null;
  }
}

// ====================================================================== DOCX
async function extractDocx(bytes: Uint8Array): Promise<ExtractedResume> {
  const mammoth = (await import("mammoth")).default ?? (await import("mammoth"));
  const { value: html } = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
  const links: ExtractedLink[] = [];
  const text = htmlToText(html, links);
  return { text: normalizeText(text), links, pages: 1, layout: "single", hadTextLayer: true };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
  if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENTITIES[e.toLowerCase()] ?? m;
});

/** Mammoth HTML -> text: block elements become lines, list items get "• ", table rows become "cell | cell", links are collected. */
export function htmlToText(html: string, links: ExtractedLink[]): string {
  let s = html.replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
    const url = decode(href).trim();
    const anchor = decode(inner.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
    if (url && !url.startsWith("#") && !links.some((l) => l.url === url)) links.push(anchor ? { url, anchor } : { url });
    return inner;
  });
  // Table rows: short single-paragraph cells read as "a | b | c"; cells holding blocks (layout tables used
  // for two-column resumes) are read cell by cell.
  s = s.replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, (_m, row: string) => {
    const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => c[1]);
    const blocky = cells.some((c) => (c.match(/<(?:p|li|h[1-6])\b/gi)?.length ?? 0) > 1);
    if (blocky) return `\n${cells.join("\n")}\n`;
    return `\n${cells.map((c) => c.replace(/<\/?(?:p|h[1-6])\b[^>]*>/gi, " ").trim()).filter(Boolean).join(" | ")}\n`;
  });
  s = s
    .replace(/<\/?(?:table|tbody|thead)\b[^>]*>/gi, "\n")
    .replace(/<li\b[^>]*>(?:\s*<p\b[^>]*>)?/gi, "\n• ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(?:p|h[1-6]|ul|ol|div|li)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decode(s)
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .map((l) => (/^•\s*$/.test(l) ? "" : l))
    .join("\n")
    .replace(/(?:\s*\|\s*){2,}/g, " | ")
    .replace(/^\s*\|\s*|\s*\|\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n");
}

async function closePdf(pdf: unknown): Promise<void> {
  const p = pdf as { destroy?: () => Promise<void>; loadingTask?: { destroy?: () => Promise<void> } };
  await (p.destroy?.() ?? p.loadingTask?.destroy?.())?.catch(() => undefined);
}
