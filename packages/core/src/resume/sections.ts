/** Resume section headings, shared by the contact extractor and the structural parser. */
export type Section =
  | "experience" | "education" | "skills" | "projects" | "certifications" | "summary"
  | "contact" | "publications" | "awards" | "languages" | "volunteer" | "other";

const HEADINGS: [Section, RegExp][] = [
  ["experience", /^(?:(?:professional|work|relevant|industry|related|recent|career|employment|teaching|research|leadership|military)\s+)?experience$|^(?:employment|work|career|professional)(?:\s+(?:history|record|experience|background))?$|^experience\s*(?:&|and)\s*(?:projects|leadership)$|^positions?\s+held$|^internships?$|^(?:selected\s+)?work$/],
  ["education", /^education(?:al)?(?:\s+(?:background|history|qualifications))?(?:\s*(?:&|and)\s*(?:training|certifications?|awards|credentials|qualifications))?$|^academic(?:s| background| qualifications| history)?$|^qualifications$|^training$/],
  ["skills", /^(?:(?:technical|core|key|relevant|professional|hard|soft|computer|it|programming)\s+)?(?:skills?|competenc(?:ies|e)|expertise|technologies|tech(?:nical)?\s+stack|toolkit|tools)(?:\s*(?:&|and|\/)\s*(?:skills|tools|technologies|competencies|interests|languages|expertise|certifications))?$|^skills?\s+(?:summary|set|profile)$|^areas\s+of\s+expertise$|^summary\s+of\s+skills$|^programming\s+languages$|^tools\s*(?:&|and)\s*technologies$/],
  ["projects", /^(?:(?:personal|selected|side|key|notable|open[ -]source|technical|academic|relevant|research|major|independent)\s+)?projects?(?:\s*(?:&|and)\s*(?:publications|research|open source))?$|^portfolio$/],
  ["certifications", /^(?:licenses?\s*(?:&|and|\/)\s*)?certifications?(?:\s*(?:&|and|\/)\s*(?:licenses?|training|courses))?$|^licenses?$|^certificates?$|^credentials$|^professional\s+(?:certifications?|development|licenses?)$|^courses?(?:\s*(?:&|and)\s*certifications?)?$/],
  ["summary", /^(?:professional\s+|career\s+|executive\s+|personal\s+)?(?:summary|profile|objective|statement|overview)$|^about(?:\s+me)?$|^summary\s+of\s+qualifications$|^highlights$|^career\s+highlights$/],
  ["contact", /^(?:contact|contact\s+(?:info(?:rmation)?|details|me)|personal\s+(?:details|information|info)|details|links|find\s+me\s+online|online)$/],
  ["publications", /^(?:selected\s+)?(?:publications?|papers|research\s+papers|patents|talks|presentations|speaking)(?:\s*(?:&|and)\s*(?:patents|talks|presentations))?$/],
  ["awards", /^(?:awards?|honou?rs|achievements|accomplishments|recognition|scholarships)(?:\s*(?:&|and)\s*(?:honou?rs|awards|achievements|recognition))?$/],
  ["languages", /^(?:spoken\s+|foreign\s+)?languages?(?:\s+spoken)?$/],
  ["volunteer", /^(?:volunteer(?:ing)?|community(?:\s+(?:service|involvement))?|volunteer\s+(?:experience|work))$|^(?:leadership\s*(?:&|and)\s*)?(?:activities|extracurriculars?|involvement)$/],
  ["other", /^(?:interests|hobbies|references|leadership|affiliations|memberships|professional\s+affiliations|additional\s+information|miscellaneous)$/],
];

/** Normalize a candidate heading line: strip markdown, decoration and letter spacing ("E X P E R I E N C E"). */
function headingText(line: string): string {
  let t = line.trim().replace(/^#+\s*/, "").replace(/[:\-=_*#|\s]+$/g, "").replace(/^[-=_*#|\s]+/g, "").trim();
  if (/^(?:\S\s){3,}\S$/.test(t)) t = t.replace(/\s/g, "");
  return t.replace(/\s+/g, " ").toLowerCase();
}

/** The section a line opens, or null when it is not a heading. */
export function sectionOf(line: string): Section | null {
  const raw = line.trim();
  if (!raw || raw.length > 48) return null;
  const t = headingText(raw);
  if (!t || t.length > 45) return null;
  for (const [name, re] of HEADINGS) if (re.test(t)) return name;
  return null;
}
