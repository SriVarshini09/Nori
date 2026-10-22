/**
 * Work authorization in Nori's profile is about the United States only (workAuth.authorizedUS / needsSponsorship).
 * A question about another country ("Are you legally authorised to work in the UK?") must not be answered from it:
 * a US-only candidate would be saying Yes to a legal question about a country they cannot work in.
 */
const OTHER_COUNTRIES = [
  "united kingdom", "uk", "great britain", "britain", "england", "scotland", "wales", "northern ireland", "ireland",
  "canada", "australia", "new zealand", "india", "germany", "france", "spain", "portugal", "italy", "netherlands", "belgium",
  "switzerland", "austria", "sweden", "norway", "denmark", "finland", "poland", "czech republic", "czechia", "romania", "greece",
  "european union", "eu", "eea", "europe", "singapore", "japan", "china", "hong kong", "south korea", "korea", "taiwan", "israel",
  "uae", "united arab emirates", "saudi arabia", "brazil", "mexico", "argentina", "chile", "colombia", "philippines", "vietnam",
  "indonesia", "malaysia", "thailand", "south africa", "nigeria", "kenya", "egypt", "pakistan", "bangladesh", "turkey",
];
const OTHER_RE = new RegExp(String.raw`\b(${OTHER_COUNTRIES.join("|")}|u\.k\.)(?![a-z])`, "i");

/** The non-US country a work-authorization or sponsorship question names, or null when it names none (or the US). */
export function foreignWorkCountry(label: string): string | null {
  const m = OTHER_RE.exec(label);
  if (!m) return null;
  // "the US or Canada": the profile cannot answer the Canada half either way, so it still goes to the person.
  return m[1];
}
