import { useEffect, useId, useState, type ComponentProps } from "react";
import { PreviewCard } from "@base-ui/react/preview-card";
import type { Paper } from "../../research/papers";
import { loadPaperPreview, paperPreviewId } from "../paperPreviews";

/** Public bibliographic details only; never a profile or an AI-generated summary. */
export interface PaperPreviewSource {
  title?: string;
  year?: number;
  authors?: string;
  journal?: string;
  abstract?: string;
  kind?: string;
  n?: number;
  openAccess?: boolean;
}

type Props = ComponentProps<"a"> & { href: string; source?: PaperPreviewSource };

/** A normal external link with a dismissible, hoverable bibliographic preview. */
export function PaperLink({ href, source, children, ...props }: Props) {
  const [open, setOpen] = useState(false);
  const headingId = useId();
  const previewId = useId();
  return (
    <PreviewCard.Root open={open} onOpenChange={setOpen}>
      <PreviewCard.Trigger {...props} href={href} target="_blank" rel="noopener noreferrer" aria-describedby={[props["aria-describedby"], open ? previewId : undefined].filter(Boolean).join(" ") || undefined} delay={350} closeDelay={200}>
        {children}
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        <PreviewCard.Positioner side="top" align="start" sideOffset={10} collisionPadding={12} className="z-[80] outline-none">
          <PreviewCard.Popup id={previewId} role="region" aria-labelledby={headingId} className="paper-preview max-h-[min(32rem,70vh,var(--available-height))] w-[26rem] max-w-[calc(100vw-24px)] origin-[var(--transform-origin)] overflow-y-auto rounded-xl border border-line bg-surface text-left text-ink shadow-lg">
            <PaperPreview key={href} href={href} source={source} headingId={headingId} />
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );
}

function PaperPreview({ href, source, headingId }: { href: string; source?: PaperPreviewSource; headingId: string }) {
  const id = paperPreviewId(href);
  const [lookup, setLookup] = useState<{ paper?: Paper; status: "loading" | "ready" | "unavailable" }>({ status: id && !source?.abstract ? "loading" : "ready" });
  useEffect(() => {
    if (!id || source?.abstract) return;
    let current = true;
    loadPaperPreview(id).then(
      (paper) => { if (current) setLookup({ paper, status: paper ? "ready" : "unavailable" }); },
      () => { if (current) setLookup({ status: "unavailable" }); },
    );
    return () => { current = false; };
  }, [id, source?.abstract]);
  const paper = lookup.paper;
  const title = source?.title ?? paper?.title ?? id ?? "Source";
  const kind = source?.kind ?? (paper?.kind !== "other" ? paper?.kind : undefined);
  const meta = [source?.year ?? paper?.year, kind, source?.journal ?? paper?.journal].filter(Boolean).join(" · ");
  const authors = source?.authors ?? paper?.authors;
  const abstract = source?.abstract ?? paper?.abstract;
  return (
    <div className="paper-preview-content flex flex-col gap-3 p-4 text-sm leading-relaxed">
      <h3 id={headingId} className="text-base leading-snug font-semibold [overflow-wrap:anywhere]">{title}</h3>
      {meta && <p className="text-ink-2">{meta}</p>}
      {authors && <p className="text-ink-2">{authors}</p>}
      {source?.n !== undefined && <p className="text-ink-2">{source.n.toLocaleString("en-GB")} participants</p>}
      {abstract ? (
        <div className="border-t border-line pt-3">
          <p className="mb-1 font-medium">Abstract</p>
          <p className="line-clamp-8 whitespace-pre-line [overflow-wrap:anywhere]">{abstract}</p>
        </div>
      ) : (
        <p role="status" className="text-ink-2">{lookup.status === "loading" ? "Loading study details from Europe PMC…" : lookup.status === "unavailable" ? "Study details couldn't be loaded. You can still open the source." : "No abstract is available in this preview."}</p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2 text-xs text-ink-2">
        <span>{(source?.openAccess ?? paper?.openAccess) ? "Free full text" : id ? "Europe PMC · bibliographic record" : "Source details"}</span>
        <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center font-medium text-accent underline underline-offset-2">Open source<span className="sr-only"> (opens in a new tab)</span></a>
      </div>
    </div>
  );
}
