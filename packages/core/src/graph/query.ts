import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { graphNodes, graphEdges, type JobRequirements, type ResumeContent, type ResumeBullet } from "../db/schema.js";
import type { Evidence, Graph, GraphEdgeRef, GraphNodeRef } from "../contracts.js";
import { canonicalSkill, findSkills, skillCategory } from "./skills.js";
import { formatDate, isRecent } from "./metrics.js";

export async function getGraph(db: Db, userId: string): Promise<Graph> {
  const nodes = await db.select().from(graphNodes).where(eq(graphNodes.userId, userId));
  const edges = await db.select().from(graphEdges).where(eq(graphEdges.userId, userId));
  return {
    nodes: nodes.map((n) => ({ id: n.id, type: n.type, label: n.label, props: n.props ?? {}, startDate: n.startDate, endDate: n.endDate })),
    edges: edges.map((e) => ({ id: e.id, src: e.src, dst: e.dst, type: e.type })),
  };
}

// ---------- graph index ----------
type Index = {
  graph: Graph;
  byId: Map<string, GraphNodeRef>;
  out: Map<string, GraphEdgeRef[]>;
  inn: Map<string, GraphEdgeRef[]>;
};

function indexGraph(graph: Graph): Index {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out = new Map<string, GraphEdgeRef[]>();
  const inn = new Map<string, GraphEdgeRef[]>();
  for (const e of graph.edges) {
    (out.get(e.src) ?? out.set(e.src, []).get(e.src)!).push(e);
    (inn.get(e.dst) ?? inn.set(e.dst, []).get(e.dst)!).push(e);
  }
  return { graph, byId, out, inn };
}

const outOf = (ix: Index, id: string, type: string) => (ix.out.get(id) ?? []).filter((e) => e.type === type).map((e) => ix.byId.get(e.dst)).filter((n): n is GraphNodeRef => !!n);
const inOf = (ix: Index, id: string, type: string) => (ix.inn.get(id) ?? []).filter((e) => e.type === type).map((e) => ix.byId.get(e.src)).filter((n): n is GraphNodeRef => !!n);

const isAlnum = (c: string | undefined) => !!c && /[a-z0-9]/i.test(c);
/** Whole-word, case-insensitive substring test. */
function hasPhrase(hay: string, needle: string): boolean {
  const h = hay.toLowerCase(), n = needle.toLowerCase();
  if (!n) return false;
  let i = h.indexOf(n);
  while (i >= 0) {
    if (!isAlnum(h[i - 1]) && !isAlnum(h[i + n.length])) return true;
    i = h.indexOf(n, i + 1);
  }
  return false;
}

function nodeSkills(n: GraphNodeRef): string[] {
  const s = n.props.skills;
  if (Array.isArray(s)) return s.map(String);
  return findSkills(n.label);
}
const num = (v: unknown) => (typeof v === "number" ? v : Number.POSITIVE_INFINITY);

// ---------- requirement items ----------
type Item = { text: string; weight: number; required: boolean; terms: string[]; phrase: string | null };

function buildItems(req: JobRequirements): Item[] {
  const items = new Map<string, Item>();
  const add = (text: string, weight: number, required: boolean) => {
    const t = text.trim();
    if (!t) return;
    const canon = canonicalSkill(t);
    const terms = canon ? [canon] : findSkills(t);
    const key = (terms.length === 1 ? terms[0] : t).toLowerCase();
    const prev = items.get(key);
    if (prev) { prev.weight = Math.max(prev.weight, weight); prev.required ||= required; return; }
    items.set(key, { text: terms.length === 1 && canon ? t : t, weight, required, terms, phrase: terms.length ? null : t.slice(0, 120) });
  };
  for (const s of req.skills ?? []) add(s.name, s.required ? 1 : 0.5, s.required);
  for (const m of req.mustHaves ?? []) add(m, 1, true);
  for (const k of req.keywords ?? []) add(k, 0.5, false);
  for (const n of req.niceToHaves ?? []) add(n, 0.5, false);
  return [...items.values()];
}

function skillNodeMatches(n: GraphNodeRef, item: Item): boolean {
  const label = n.label;
  const canon = (canonicalSkill(label) ?? label).toLowerCase();
  const probes = item.terms.length ? item.terms : item.phrase ? [item.phrase] : [];
  return probes.some((t) => {
    const tl = t.toLowerCase();
    if (canon === tl || label.toLowerCase() === tl) return true;
    if (tl.length < 3 || label.length < 3) return false;
    return hasPhrase(label, t) || hasPhrase(t, label);
  });
}

function textMatches(n: GraphNodeRef, item: Item): boolean {
  if (item.terms.length) {
    const have = new Set(nodeSkills(n).map((s) => s.toLowerCase()));
    return item.terms.some((t) => have.has(t.toLowerCase()));
  }
  return !!item.phrase && item.phrase.length >= 4 && hasPhrase(`${n.label} ${String(n.props.statement ?? "")}`, item.phrase);
}

function ownerContext(ix: Index, owner: GraphNodeRef): { roleId?: string; roleLabel?: string; companyLabel?: string } {
  if (owner.type === "role") return { roleId: owner.id, roleLabel: owner.label, companyLabel: outOf(ix, owner.id, "worked_at")[0]?.label };
  if (owner.type === "project") {
    const role = outOf(ix, owner.id, "part_of")[0];
    if (role) return { roleId: role.id, roleLabel: role.label, companyLabel: outOf(ix, role.id, "worked_at")[0]?.label };
    return { roleLabel: owner.label };
  }
  return {};
}

function roleLine(owner: GraphNodeRef): string {
  const start = formatDate(owner.startDate);
  const end = owner.endDate ? formatDate(owner.endDate) : start ? "Present" : undefined;
  return start ? `${owner.label} (${start} - ${end})` : owner.label;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

const SOFT_RE = /\b(communicat\w*|collaborat\w*|team\s?work|team player|problem[- ]solving|interpersonal|time management|adaptab\w*)\b/i;
function isSoftRequirement(item: Item): boolean {
  return SOFT_RE.test(item.text) || item.terms.some((t) => SOFT_RE.test(t));
}

function gatherEvidence(ix: Index, item: Item): Evidence[] {
  const found = new Map<string, Evidence>();
  const put = (e: Evidence) => {
    const prev = found.get(e.nodeId);
    if (!prev || prev.score < e.score) found.set(e.nodeId, e);
  };
  const base = item.weight;

  // Owners (roles/projects) reached through matching skill nodes or whose own label matches.
  const owners = new Map<string, GraphNodeRef>();
  for (const n of ix.graph.nodes) {
    if ((n.type === "skill" || n.type === "tool") && skillNodeMatches(n, item)) {
      for (const o of inOf(ix, n.id, "used")) if (o.type === "role" || o.type === "project") owners.set(o.id, o);
    } else if ((n.type === "role" || n.type === "project") && textMatches(n, item)) {
      owners.set(n.id, n);
    } else if (n.type === "metric" && textMatches(n, item)) {
      for (const o of inOf(ix, n.id, "achieved")) owners.set(o.id, o);
    }
  }

  for (const owner of owners.values()) {
    const ctx = ownerContext(ix, owner);
    const recent = isRecent(owner.endDate);
    put({ requirement: item.text, nodeId: owner.id, nodeType: owner.type, label: owner.label, text: roleLine(owner), ...ctx, score: r3(base * 0.6 + (recent ? 0.2 : 0)) });

    const metrics = outOf(ix, owner.id, "achieved").sort((a, b) => num(a.props.order) - num(b.props.order));
    let untagged = 0;
    for (const m of metrics) {
      const tagged = textMatches(m, item);
      if (!tagged && untagged >= 2) continue;
      if (!tagged) untagged++;
      const hasNumber = typeof m.props.hasNumber === "boolean" ? m.props.hasNumber : /\d/.test(String(m.props.statement ?? m.label));
      const score = (tagged ? base : base * 0.5) + (hasNumber ? 0.3 : 0) + (recent ? 0.2 : 0);
      put({ requirement: item.text, nodeId: m.id, nodeType: "metric", label: m.label, text: String(m.props.statement ?? m.label), ...ctx, score: r3(score) });
    }
  }

  // Skills listed in a skills section count even with no role attached (lower than role-backed evidence).
  for (const n of ix.graph.nodes) {
    if ((n.type === "skill" || n.type === "tool") && skillNodeMatches(n, item)) {
      put({ requirement: item.text, nodeId: n.id, nodeType: n.type, label: n.label, text: `Listed skill: ${n.label}`, score: r3(base * 0.6) });
    }
  }

  // Education and certifications that name the requirement.
  for (const n of ix.graph.nodes) {
    if (n.type !== "education" && n.type !== "certification") continue;
    const hay = `${n.label} ${String(n.props.field ?? "")}`;
    const hit = item.terms.length ? findSkills(hay).some((s) => item.terms.includes(s)) : !!item.phrase && item.phrase.length >= 4 && hasPhrase(hay, item.phrase);
    if (hit) put({ requirement: item.text, nodeId: n.id, nodeType: n.type, label: n.label, text: n.label, score: r3(base * 0.6) });
  }

  // Every JD lists soft skills; anyone with a work history (2+ roles) gets a low-score row for them.
  if (found.size === 0 && isSoftRequirement(item)) {
    const roles = ix.graph.nodes.filter((n) => n.type === "role");
    if (roles.length >= 2) {
      const newest = [...roles].sort((a, b) => (b.endDate ?? "9999-12").localeCompare(a.endDate ?? "9999-12") || (b.startDate ?? "").localeCompare(a.startDate ?? ""))[0];
      put({ requirement: item.text, nodeId: newest.id, nodeType: "role", label: newest.label, text: `General strength across ${roles.length} roles: ${item.text}`, ...ownerContext(ix, newest), score: r3(base * 0.2) });
    }
  }

  return [...found.values()].sort((a, b) => b.score - a.score).slice(0, 8);
}

/** Evidence from the career graph for every requirement, best first. */
export async function retrieveEvidence(db: Db, userId: string, requirements: JobRequirements): Promise<Evidence[]> {
  const ix = indexGraph(await getGraph(db, userId));
  return buildItems(requirements).flatMap((item) => gatherEvidence(ix, item)).sort((a, b) => b.score - a.score);
}

/** Requirements for which the graph holds no evidence at all. */
export async function skillGaps(db: Db, userId: string, requirements: JobRequirements): Promise<{ requirement: string; required: boolean }[]> {
  const ix = indexGraph(await getGraph(db, userId));
  return buildItems(requirements)
    .filter((item) => gatherEvidence(ix, item).length === 0)
    .map((item) => ({ requirement: item.text, required: item.required }));
}

// ---------- baseline resume ----------
export type BaselineProfile = {
  fullName?: string | null; email?: string | null; phone?: string | null;
  location?: string | null; linkedin?: string | null; website?: string | null;
};

const GROUPS = ["Languages", "Frameworks", "Data", "Cloud", "Other"] as const;

function bulletsOf(ix: Index, ownerId: string, prefix: string): ResumeBullet[] {
  return outOf(ix, ownerId, "achieved")
    .filter((m) => m.type === "metric")
    .sort((a, b) => num(a.props.order) - num(b.props.order) || a.label.localeCompare(b.label))
    .map((m, j) => ({ id: `${prefix}-b${j}`, text: String(m.props.statement ?? m.label), nodeIds: [m.id] }));
}

/** Untailored resume assembled straight from the graph. */
export async function buildBaselineResume(db: Db, userId: string, profile: BaselineProfile): Promise<ResumeContent> {
  const ix = indexGraph(await getGraph(db, userId));
  const ofType = (t: string) => ix.graph.nodes.filter((n) => n.type === t);

  const roles = ofType("role").sort((a, b) => {
    const ea = a.endDate ?? "9999-12", eb = b.endDate ?? "9999-12";
    if (ea !== eb) return ea < eb ? 1 : -1;
    const sa = a.startDate ?? "", sb = b.startDate ?? "";
    return sa < sb ? 1 : sa > sb ? -1 : 0;
  });

  const experience = roles.map((r, i) => {
    const start = formatDate(r.startDate);
    return {
      title: String(r.props.title ?? r.label),
      company: outOf(ix, r.id, "worked_at")[0]?.label ?? String(r.props.company ?? ""),
      location: r.props.location ? String(r.props.location) : undefined,
      start,
      end: start ? (r.endDate ? formatDate(r.endDate) : "Present") : undefined,
      bullets: bulletsOf(ix, r.id, `e${i}`),
    };
  });

  const projects = ofType("project").map((p, i) => {
    let bullets = bulletsOf(ix, p.id, `p${i}`);
    if (!bullets.length && p.props.description) bullets = [{ id: `p${i}-b0`, text: String(p.props.description), nodeIds: [p.id] }];
    return { name: p.label, bullets };
  }).filter((p) => p.bullets.length);

  const education = ofType("education").sort((a, b) => (b.endDate ?? "").localeCompare(a.endDate ?? "")).map((e) => ({
    school: String(e.props.school ?? e.label),
    degree: e.props.degree ? String(e.props.degree) : undefined,
    field: e.props.field ? String(e.props.field) : undefined,
    start: e.startDate?.slice(0, 4),
    end: e.endDate?.slice(0, 4),
  }));

  const skillNodes = [...ofType("skill"), ...ofType("tool")];
  const grouped = new Map<string, { label: string; uses: number }[]>();
  for (const s of skillNodes) {
    const g = skillCategory(canonicalSkill(s.label) ?? s.label);
    (grouped.get(g) ?? grouped.set(g, []).get(g)!).push({ label: s.label, uses: (ix.inn.get(s.id) ?? []).filter((e) => e.type === "used").length });
  }
  const skills = GROUPS.filter((g) => grouped.get(g)?.length).map((g) => ({
    group: g,
    items: grouped.get(g)!.sort((a, b) => b.uses - a.uses || a.label.localeCompare(b.label)).map((x) => x.label),
  }));

  const contact: ResumeContent["contact"] = {};
  if (profile.email) contact.email = profile.email;
  if (profile.phone) contact.phone = profile.phone;
  if (profile.location) contact.location = profile.location;
  if (profile.linkedin) contact.linkedin = profile.linkedin;
  if (profile.website) contact.website = profile.website;

  return {
    name: profile.fullName ?? "",
    contact,
    experience,
    education,
    skills,
    projects: projects.length ? projects : undefined,
    certifications: ofType("certification").map((c) => c.label),
  };
}
