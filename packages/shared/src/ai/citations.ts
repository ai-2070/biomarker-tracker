/**
 * Citation verifier. The model may only cite studies that were retrieved and
 * passed to it. Every cited ID is checked against that set; anything else is
 * flagged. Author-year references ("Smith et al., 2019") can't be checked and
 * are counted so the UI can warn about them.
 */

export type Segment = { type: "text"; text: string } | { type: "cite"; id: string; valid: boolean };

export interface CitationCheck {
  segments: Segment[];
  verified: string[];
  unverified: string[];
  /** Author-year style references that can't be matched to a retrieved study. */
  looseReferences: string[];
}

const BRACKET = /\[([^\]\n]{0,200})\]/g;
const ID_IN_TEXT = /\b(PMID|PMCID|DOI)\s*:?\s*(10\.\d{4,9}\/[^\s[\]<>"{}]+|PMC\d+|\d{4,9})/gi;
const LOOSE = /\b\p{Lu}[\p{L}'-]+(?: and \p{Lu}[\p{L}'-]+)? et al\.?,? \(?(?:19|20)\d{2}\)?/gu;

/** Normalise "PMID 123", "pmid:123", "PMCID: PMC9" to "PMID:123" / "PMCID:PMC9". */
export function normalizeId(kind: string, value: string): string {
  const k = kind.toUpperCase();
  if (k === "DOI") {
    let doi = value.replace(/[.,;]+$/, "");
    let balance = 0;
    for (const character of doi) {
      if (character === "(") balance++;
      else if (character === ")") balance--;
    }
    // Prose may wrap a citation in parentheses; balanced parentheses can belong to the DOI.
    while (balance < 0 && doi.endsWith(")")) {
      doi = doi.slice(0, -1).replace(/[.,;]+$/, "");
      balance++;
    }
    return `DOI:${doi.toLowerCase()}`;
  }
  return k === "PMCID" ? `PMCID:${value.toUpperCase().startsWith("PMC") ? value.toUpperCase() : `PMC${value}`}` : `PMID:${value}`;
}

function idsIn(text: string): string[] {
  return [...text.matchAll(ID_IN_TEXT)].map((m) => normalizeId(m[1]!, m[2]!));
}

export function checkCitations(text: string, allowed: ReadonlySet<string>): CitationCheck {
  const segments: Segment[] = [];
  const pushText = (t: string) => {
    if (!t) return;
    // IDs written without brackets are still citations and still checked.
    let last = 0;
    for (const m of t.matchAll(ID_IN_TEXT)) {
      if (m.index! > last) segments.push({ type: "text", text: t.slice(last, m.index) });
      const id = normalizeId(m[1]!, m[2]!);
      segments.push({ type: "cite", id, valid: allowed.has(id) });
      const suffix = m[1]!.toUpperCase() === "DOI" ? m[2]!.length - id.slice(4).length : 0;
      last = m.index! + m[0].length - suffix;
    }
    if (last < t.length) segments.push({ type: "text", text: t.slice(last) });
  };

  let last = 0;
  for (const m of text.matchAll(BRACKET)) {
    const ids = idsIn(m[1]!);
    if (ids.length === 0) continue; // ordinary brackets, keep as text
    pushText(text.slice(last, m.index));
    for (const id of ids) segments.push({ type: "cite", id, valid: allowed.has(id) });
    last = m.index! + m[0].length;
  }
  pushText(text.slice(last));

  const cites = segments.filter((s): s is Extract<Segment, { type: "cite" }> => s.type === "cite");
  const unique = (xs: string[]) => [...new Set(xs)];
  return {
    segments,
    verified: unique(cites.filter((c) => c.valid).map((c) => c.id)),
    unverified: unique(cites.filter((c) => !c.valid).map((c) => c.id)),
    looseReferences: unique([...text.matchAll(LOOSE)].map((m) => m[0])),
  };
}
