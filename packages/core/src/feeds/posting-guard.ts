/**
 * Integrity & charset layer for fetched job postings, adapted from:
 * - ai-job-search-dev/ai-job-search (tools/posting_guard.py, tools/page_decode.py)
 * - career-ops-hq/career-ops (browser-extract.mjs)
 *
 * Strips hidden HTML elements (display:none, visibility:hidden, opacity:0, font-size:0,
 * color:transparent, clip/clip-path, off-screen positioning, hidden, aria-hidden),
 * zero-width characters, bidirectional override controls, and Unicode Tag characters
 * (U+E0000-U+E007F) before untrusted job descriptions reach the database or LLM.
 */

const PRESCAN_BYTES = 1024;
const META_CHARSET_RE = /<meta\b[^>]*?charset\s*=\s*["']?\s*([A-Za-z0-9._:-]+)/i;

const ALLOWED_LABELS: Record<string, string> = {
  "utf-8": "utf-8",
  "utf8": "utf-8",
  "windows-1252": "windows-1252",
  "cp1252": "windows-1252",
  "iso-8859-1": "windows-1252",
  "latin1": "windows-1252",
  "us-ascii": "windows-1252",
  "euc-kr": "euc-kr",
  "cp949": "euc-kr",
  "shift_jis": "shift_jis",
  "shift-jis": "shift_jis",
  "sjis": "shift_jis",
  "euc-jp": "euc-jp",
  "gb18030": "gb18030",
  "gbk": "gbk",
  "gb2312": "gb18030",
  "big5": "big5",
  "windows-1250": "windows-1250",
  "windows-1251": "windows-1251",
  "iso-8859-2": "iso-8859-2",
  "iso-8859-15": "iso-8859-15",
  "koi8-r": "koi8-r",
};

/**
 * Decode raw response bytes the way a browser does:
 * 1. Valid UTF-8 wins immediately.
 * 2. Otherwise check UTF-16 BOM or <meta charset> in the first 1024 bytes.
 * 3. Fall back to UTF-8 with replacement.
 */
export function decodePageBytes(raw: Uint8Array): string {
  if (raw.length >= 2) {
    if (raw[0] === 0xff && raw[1] === 0xfe) return new TextDecoder("utf-16le").decode(raw);
    if (raw[0] === 0xfe && raw[1] === 0xff) return new TextDecoder("utf-16be").decode(raw);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    // Non-UTF-8 bytes present; inspect declared charset in the first 1024 bytes
  }
  const head = new TextDecoder("latin1").decode(raw.subarray(0, PRESCAN_BYTES));
  const m = META_CHARSET_RE.exec(head);
  const label = m?.[1]?.toLowerCase();
  const encoding = (label && ALLOWED_LABELS[label]) || "utf-8";
  try {
    return new TextDecoder(encoding, { fatal: false }).decode(raw);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(raw);
  }
}

/** CSS declarations that hide content from a human reader while leaving it visible to an LLM/scraper. */
const HIDDEN_STYLE_RE = /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|opacity\s*:\s*0(?:\.0+)?(?:\s*[;!]|$)|font-size\s*:\s*0(?:px|pt|em|rem|%)?|color\s*:\s*(?:transparent|rgba\([^)]*,\s*0(?:\.0+)?\s*\))|clip-path\s*:\s*inset\(\s*(?:50|100)%|(?:left|top)\s*:\s*-\d{4,}px|(?:width|height|max-width|max-height)\s*:\s*0(?:px)?(?=[^;]*overflow\s*:\s*hidden))/i;

const HIDDEN_ATTR_RE = /\b(?:hidden|aria-hidden\s*=\s*["']?true["']?)\b/i;

/** Invisible characters: zero-width spaces, joiners, BOM, bidi controls, soft hyphens, and Unicode Tag block (U+E0000-U+E007F). */
const INVISIBLE_CHARS_RE = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF\u{E0000}-\u{E007F}]/gu;

/** Prompt-injection / instruction-shaped lines aimed at an AI evaluation agent rather than a job applicant. */
const INJECTION_LINE_RE = /\b(?:ignore (?:all |any )?(?:previous|prior|above) instructions|system prompt|you are an? (?:ai|llm|assistant)|disregard (?:previous|all) instructions|rank this candidate|score this (?:resume|candidate|application) (?:100|highest|5\/5))\b/i;

export type PostingGuardReport = {
  cleanedHtml: string;
  hiddenBlocksRemoved: number;
  invisibleCharsRemoved: number;
  suspiciousLines: string[];
};

function isHiddenOpenTag(attrs: string): boolean {
  if (HIDDEN_ATTR_RE.test(attrs)) return true;
  const styleMatch = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
  if (!styleMatch) return false;
  const style = (styleMatch[1] ?? styleMatch[2] ?? styleMatch[3] ?? "").replace(/\/\*[\s\S]*?\*\//g, "");
  return HIDDEN_STYLE_RE.test(style);
}

/**
 * Strip hidden DOM elements, script/style/template/svg/noscript blocks, and invisible/tag Unicode
 * characters from untrusted job HTML.
 */
export function guardPostingHtml(html: string): PostingGuardReport {
  if (!html) return { cleanedHtml: "", hiddenBlocksRemoved: 0, invisibleCharsRemoved: 0, suspiciousLines: [] };

  let hiddenBlocksRemoved = 0;
  // Remove comments and non-content elements first.
  let cleaned = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, "");

  // Remove common inline/block tags that carry hidden attributes or hidden inline styles.
  const HIDDEN_TAG_RE = /<(div|span|p|section|article|aside|header|footer|a|li|ul|ol|small|font)\b([^>]*?)>([\s\S]*?)<\/\1>/gi;
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    cleaned = cleaned.replace(HIDDEN_TAG_RE, (full, _tag: string, attrs: string) => {
      if (isHiddenOpenTag(attrs)) {
        hiddenBlocksRemoved++;
        changed = true;
        return "";
      }
      return full;
    });
    if (!changed) break;
  }

  let invisibleCharsRemoved = 0;
  cleaned = cleaned.replace(INVISIBLE_CHARS_RE, () => {
    invisibleCharsRemoved++;
    return "";
  });

  const suspiciousLines: string[] = [];
  for (const line of cleaned.split(/\r?\n/)) {
    const trimmed = line.replace(/<[^>]+>/g, "").trim();
    if (trimmed && INJECTION_LINE_RE.test(trimmed)) {
      suspiciousLines.push(trimmed.slice(0, 200));
    }
  }

  return { cleanedHtml: cleaned, hiddenBlocksRemoved, invisibleCharsRemoved, suspiciousLines };
}

/** Strip invisible characters and bidi/tag controls from plain text. */
export function sanitizePostingText(text: string): string {
  if (!text) return "";
  return text.replace(INVISIBLE_CHARS_RE, "");
}
