import type { ReactNode } from "react";
import { checkCitations } from "../../ai/citations";
import { cx } from "./ui";

/** Where a verified citation links to. */
function citeUrl(id: string): string {
  const separator = id.indexOf(":");
  const kind = id.slice(0, separator);
  const value = id.slice(separator + 1);
  if (kind === "DOI") return `https://doi.org/${encodeURI(value).replace(/[?#]/g, encodeURIComponent)}`;
  return kind === "PMCID" ? `https://europepmc.org/article/PMC/${value}` : `https://pubmed.ncbi.nlm.nih.gov/${value}/`;
}

/** **bold** inside plain text. Everything is rendered as text, never as HTML. */
function inline(text: string, keyBase: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <strong key={`${keyBase}-${i}`}>{part.slice(2, -2)}</strong> : <span key={`${keyBase}-${i}`}>{part}</span>,
  );
}

function line(text: string, allowed: ReadonlySet<string>, key: string): ReactNode[] {
  return checkCitations(text, allowed).segments.map((s, i) =>
    s.type === "text" ? (
      inline(s.text, `${key}-${i}`)
    ) : s.valid ? (
      <a
        key={`${key}-${i}`}
        href={citeUrl(s.id)}
        target="_blank"
        rel="noopener noreferrer"
        className="mx-0.5 inline-flex items-center rounded bg-accent-soft px-1.5 font-mono text-xs text-accent no-underline"
      >
        {s.id}
      </a>
    ) : (
      <span key={`${key}-${i}`} title="Not one of the studies the assistant retrieved" className="mx-0.5 inline-flex items-center rounded bg-danger-soft px-1.5 font-mono text-xs text-danger line-through">
        {s.id}
      </span>
    ),
  );
}

/** An assistant answer with checked citations and simple formatting (paragraphs, lists, bold, headings). */
export function CitedAnswer({ text, allowed, truncated }: { text: string; allowed: ReadonlySet<string>; truncated?: boolean }) {
  const check = checkCitations(text, allowed);
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{line(it, allowed, `li-${blocks.length}-${i}`)}</li>);
    blocks.push(list.ordered ? <ol key={blocks.length} className="list-decimal pl-5">{items}</ol> : <ul key={blocks.length} className="list-disc pl-5">{items}</ul>);
    list = null;
  };
  for (const raw of text.split("\n")) {
    const t = raw.trim();
    const bullet = /^[-*•]\s+(.*)$/.exec(t);
    const num = /^\d+[.)]\s+(.*)$/.exec(t);
    if (bullet || num) {
      const ordered = !!num;
      if (!list || list.ordered !== ordered) {
        flush();
        list = { ordered, items: [] };
      }
      list.items.push((bullet ?? num)![1]!);
      continue;
    }
    flush();
    if (!t) continue;
    const heading = /^#{1,4}\s+(.*)$/.exec(t);
    blocks.push(
      heading ? (
        <p key={blocks.length} className="font-semibold">
          {line(heading[1]!, allowed, `h-${blocks.length}`)}
        </p>
      ) : (
        <p key={blocks.length}>{line(t, allowed, `p-${blocks.length}`)}</p>
      ),
    );
  }
  flush();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 leading-relaxed">{blocks}</div>
      <ul className="flex flex-col gap-1 border-t border-line pt-2 text-sm">
        {check.verified.length > 0 && (
          <li className="text-ok">
            {check.verified.length} {check.verified.length === 1 ? "citation" : "citations"} checked against the studies the assistant retrieved.
          </li>
        )}
        {check.unverified.length > 0 && (
          <li className="font-medium text-danger">
            {check.unverified.length} {check.unverified.length === 1 ? "citation is" : "citations are"} not among the retrieved studies (struck through). Don't rely on{" "}
            {check.unverified.length === 1 ? "it" : "them"}.
          </li>
        )}
        {check.looseReferences.length > 0 && (
          <li className={cx("font-medium text-warn")}>Mentions {check.looseReferences.join(", ")} without an ID, so it can't be checked.</li>
        )}
        {truncated && <li className="text-warn">The answer was cut off because it was too long.</li>}
      </ul>
    </div>
  );
}
