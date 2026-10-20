import { useEffect, useState } from "react";
import type { ResumeContent } from "@/lib/types";

/** Keep these in step with packages/core/src/resume/theme.ts. */
export const SECTION_IDS = ["summary", "experience", "education", "skills", "projects", "certifications"] as const;
export type SectionId = (typeof SECTION_IDS)[number];
export const SECTION_TITLES: Record<SectionId, string> = {
  summary: "Summary", experience: "Experience", education: "Education", skills: "Skills", projects: "Projects", certifications: "Certifications",
};
export const EXTRA_TITLES = ["Awards", "Languages", "Volunteer Experience", "Publications", "Interests", "Leadership", "Activities"] as const;

let seq = 0;
/** A client-side id for a new bullet. The server keeps ids that are unique within the resume. */
export const newId = (prefix = "n") => `${prefix}-c${Date.now().toString(36)}${(seq++).toString(36)}`;

export const blankRole = (): ResumeContent["experience"][number] => ({ title: "", company: "", bullets: [{ id: newId("e"), text: "", nodeIds: [] }] });
export const blankSchool = (): ResumeContent["education"][number] => ({ school: "" });
export const blankGroup = (): ResumeContent["skills"][number] => ({ group: "", items: [] });
export const blankProject = (): NonNullable<ResumeContent["projects"]>[number] => ({ name: "", bullets: [{ id: newId("p"), text: "", nodeIds: [] }] });

export function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return list;
  const next = [...list];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}

/** Order and visibility as the user sees them: every known section once, hidden ones flagged. */
export function sectionState(c: ResumeContent): { id: SectionId; hidden: boolean }[] {
  const hidden = new Set(c.layout?.hidden ?? []);
  const wanted = (c.layout?.sections ?? []).filter((s): s is SectionId => (SECTION_IDS as readonly string[]).includes(s));
  const order = [...new Set<SectionId>([...wanted, ...SECTION_IDS])];
  return order.map((id) => ({ id, hidden: hidden.has(id) }));
}

export function withSections(c: ResumeContent, state: { id: SectionId; hidden: boolean }[]): ResumeContent {
  return { ...c, layout: { sections: state.map((s) => s.id), hidden: state.filter((s) => s.hidden).map((s) => s.id) } };
}

/** Debounced copy of a value. */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Stable JSON with sorted keys, for "did anything change" checks. */
export function stable(v: unknown): string {
  return JSON.stringify(v, (_k, val) => (val && typeof val === "object" && !Array.isArray(val) ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : val));
}
