import path from "node:path";
import { extractResume, type ExtractedResume } from "@jobgraph/core";

export const MAX_RESUME_BYTES = 10 * 1024 * 1024;

export type ResumeKind = "pdf" | "docx" | "txt";

/** pdf / docx / txt by MIME type, falling back to the file extension. */
export function resumeKind(name: string, mime: string): ResumeKind | null {
  const ext = path.extname(name).toLowerCase();
  if (mime === "application/pdf" || ext === ".pdf") return "pdf";
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || ext === ".docx") return "docx";
  if (mime.startsWith("text/plain") || mime.startsWith("text/markdown") || ext === ".txt" || ext === ".md") return "txt";
  return null;
}

/** Text, hyperlinks and layout facts from an uploaded resume (see packages/core/src/resume/extract-text.ts). */
export async function extractResumeFile(kind: ResumeKind, bytes: Uint8Array): Promise<ExtractedResume> {
  return extractResume(bytes, kind);
}

/** Plain text only; kept for callers that do not need links or layout. */
export async function extractResumeText(kind: ResumeKind, bytes: Uint8Array): Promise<string> {
  return (await extractResume(bytes, kind)).text;
}
