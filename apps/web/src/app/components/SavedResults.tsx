import { useId, useMemo, useRef, useState } from "react";
import { Checkbox } from "@base-ui/react/checkbox";
import { Field } from "@base-ui/react/field";
import type { Measurement } from "@bt/shared/core/types";
import { activeOn } from "@bt/shared/core/protocols";
import { flagMeasurement, resolveRange, sortByDate } from "@bt/shared/core/trends";
import { formatValue } from "@bt/shared/core/units";
import { deleteMeasurements } from "../../db/db";
import { displayUnitFor, formatDate, showMeasurement, showRange, valueUnit } from "../format";
import { useDisplayUnits, useProfile, useProtocols } from "../hooks";
import { BIOMARKER_MAP, fullName } from "../knowledge";
import { ConfirmDialog } from "./ConfirmDialog";
import { MeasurementEditor } from "./MeasurementEditor";
import { Button, CheckIcon, FlagBadge, inputStyles, labelStyles } from "./ui";

const PAGE_SIZE = 10;
const SOURCE: Record<Measurement["source"], string> = {
  manual: "Typed in", pdf: "Lab PDF", csv: "CSV import", photo: "Photo or scan", device: "Device import",
};

/** One saved-reading list for blood results, body data and individual marker histories. */
export function SavedResults({ measurements, filterable = true, showMarker = filterable }: { measurements: Measurement[]; filterable?: boolean; showMarker?: boolean }) {
  const id = useId();
  const profile = useProfile();
  const units = useDisplayUnits();
  const protocols = useProtocols() ?? [];
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);
  const top = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return sortByDate(measurements.filter((m) => {
      const def = BIOMARKER_MAP.get(m.biomarkerId);
      if (!def || (from && m.date < from) || (to && m.date > to)) return false;
      return !term || [def.name, def.abbreviation, ...def.aliases, m.date, m.lab, m.note, SOURCE[m.source]]
        .some((text) => text?.toLocaleLowerCase().includes(term));
    })).reverse();
  }, [measurements, search, from, to]);
  const selectedIds = filtered.filter((m) => selected.has(m.id)).map((m) => m.id);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  if (currentPage !== page) setPage(currentPage);
  const offset = currentPage * PAGE_SIZE;
  const rows = filtered.slice(offset, offset + PAGE_SIZE);

  function showPage(next: number) {
    setPage(next);
    top.current?.scrollIntoView({ block: "start" });
  }

  function filter(change: () => void) {
    change();
    setSelected(new Set());
    setPage(0);
    setMessage("");
    setError("");
  }

  async function remove(ids: string[]) {
    setDeleting(true);
    setError("");
    setMessage("");
    try {
      const count = await deleteMeasurements(ids);
      const removed = new Set(ids);
      setSelected((current) => new Set([...current].filter((key) => !removed.has(key))));
      if (editing && removed.has(editing)) setEditing(null);
      setMessage(count === 0 ? "These results have already been removed." : `Deleted ${count} ${count === 1 ? "result" : "results"}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't delete the selected results. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div ref={top} className="flex min-w-0 scroll-mt-24 flex-col gap-3">
      {filterable && (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_10rem]">
          <Field.Root className="flex min-w-0 flex-col gap-1.5">
            <Field.Label className={labelStyles}>Search saved results</Field.Label>
            <Field.Control value={search} onValueChange={(value) => filter(() => setSearch(value))} disabled={deleting || editing !== null} className={inputStyles} placeholder="Marker, lab or note" />
          </Field.Root>
          <Field.Root className="flex min-w-0 flex-col gap-1.5">
            <Field.Label className={labelStyles}>From date</Field.Label>
            <Field.Control type="date" value={from} onValueChange={(value) => filter(() => setFrom(value))} disabled={deleting || editing !== null} className={inputStyles} />
          </Field.Root>
          <Field.Root className="flex min-w-0 flex-col gap-1.5">
            <Field.Label className={labelStyles}>To date</Field.Label>
            <Field.Control type="date" value={to} onValueChange={(value) => filter(() => setTo(value))} disabled={deleting || editing !== null} className={inputStyles} />
          </Field.Root>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-b border-line pb-3">
        <span role="status" className="mr-auto text-sm text-ink-2">{selectedIds.length} selected</span>
        {filtered.length > 0 && selectedIds.length !== filtered.length && (
          <Button variant="secondary" disabled={deleting || editing !== null} onClick={() => setSelected(new Set(filtered.map((m) => m.id)))}>
            Select all {filtered.length}{filterable ? " matching" : ""}
          </Button>
        )}
        {selectedIds.length > 0 && !deleting && editing === null && (
          <>
            <Button variant="quiet" onClick={() => setSelected(new Set())}>Clear selection</Button>
            <ConfirmDialog
              trigger={`Delete selected (${selectedIds.length})`}
              triggerVariant="danger"
              title={`Delete ${selectedIds.length} selected ${selectedIds.length === 1 ? "result" : "results"}?`}
              description="Only the selected readings will be removed from this profile. This cannot be undone. Original report files are kept."
              confirmLabel={`Delete ${selectedIds.length} ${selectedIds.length === 1 ? "result" : "results"}`}
              onConfirm={() => remove(selectedIds)}
            />
          </>
        )}
        {deleting && <span role="status" className="text-sm text-ink-2">Deleting…</span>}
      </div>
      {message && <p role="status" className="text-sm text-ink">{message}</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {from && to && from > to && <p role="alert" className="text-sm text-danger">From date must be on or before To date.</p>}
      {filtered.length === 0 ? (
        <p className="py-3 text-ink-2">{measurements.length === 0 ? "No saved results." : "No results match these filters."}</p>
      ) : (
        <>
          <p className="text-sm text-ink-2">Showing {offset + 1}–{offset + rows.length} of {filtered.length} results, newest first. Select all includes matching results on every page.</p>
          <ul className="divide-y divide-line">
            {rows.map((m) => {
              const def = BIOMARKER_MAP.get(m.biomarkerId)!;
              const unit = displayUnitFor(def, units[def.id]);
              const value = `${showMeasurement(def, m, unit)} ${valueUnit(def, unit)}`.trim();
              const flag = flagMeasurement(def, m, profile);
              const range = resolveRange(def, m, profile);
              const entered = valueUnit(def, unit) && m.originalUnit !== unit ? `${m.qualifier ?? ""}${formatValue(m.originalValue)} ${m.originalUnit}` : undefined;
              const during = activeOn(protocols, m.date);
              const checkId = `${id}-${m.id}`;
              return (
                <li key={m.id} className="py-3">
                  <div className="flex items-start gap-2">
                    <label htmlFor={checkId} className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center">
                      <Checkbox.Root
                        id={checkId}
                        aria-label={`Select ${fullName(def)} ${value} from ${formatDate(m.date)}`}
                        checked={selected.has(m.id)}
                        disabled={deleting || editing !== null}
                        onCheckedChange={(checked) => setSelected((current) => {
                          const next = new Set(current);
                          if (checked) next.add(m.id); else next.delete(m.id);
                          return next;
                        })}
                        className="flex size-6 shrink-0 items-center justify-center rounded-md border-2 border-line-strong bg-surface text-accent-ink data-checked:border-accent data-checked:bg-accent"
                      >
                        <Checkbox.Indicator className="flex data-unchecked:hidden"><CheckIcon /></Checkbox.Indicator>
                      </Checkbox.Root>
                    </label>
                    <div className="min-w-0 flex-1">
                      {showMarker && <p className="font-medium text-ink">{fullName(def)}</p>}
                      <p className="text-ink"><span className="font-medium tabular-nums">{value}</span><span className="text-sm text-ink-2"> · {formatDate(m.date)}</span></p>
                      <p className="text-sm text-ink-2">{SOURCE[m.source]}{m.lab && ` · ${m.lab}`}</p>
                      {flag !== "unknown" && <FlagBadge flag={flag} className="mt-1" />}
                    </div>
                    <Button variant="quiet" className="shrink-0 px-2" disabled={deleting || editing !== null} aria-label={`Edit ${fullName(def)} from ${formatDate(m.date)}`} aria-expanded={editing === m.id} onClick={() => { setEditing(m.id); setMessage(""); setError(""); }}>Edit</Button>
                  </div>
                  {editing === m.id ? (
                    <div className="mt-3 border-t border-line pt-4">
                      <MeasurementEditor key={m.id} measurement={m} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); setMessage("Updated result."); }} />
                    </div>
                  ) : (
                    <details className="ml-11 mt-1 min-w-0">
                      <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-ink-2">Details</summary>
                      <div className="flex flex-col gap-2 text-sm text-ink-2">
                        {entered && <p>Entered as {entered}</p>}
                        {range && <p>{range.comparisonOnly ? "Population comparison (not clinical limits)" : "Range"} {showRange(def, range, unit)}{range.source === "lab" ? " (lab)" : ""}</p>}
                        {m.fasted !== undefined && <p>{m.fasted ? "Fasting" : "Not fasting"}</p>}
                        {m.note && <p className="break-words italic">{m.note}</p>}
                        {during.length > 0 && <p>At the time: {during.map((p) => p.label).join(", ")}</p>}
                        {!deleting && editing === null && <div><ConfirmDialog trigger="Delete this result" triggerVariant="quiet" triggerClassName="-ml-3 text-sm" title="Delete this result?" description={`${fullName(def)} ${value} from ${formatDate(m.date)} will be removed from this profile. This cannot be undone.`} confirmLabel="Delete result" onConfirm={() => remove([m.id])} /></div>}
                      </div>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
          {pageCount > 1 && (
            <nav aria-label="Saved result pages" className="flex flex-wrap items-center justify-between gap-2">
              <Button variant="secondary" disabled={currentPage === 0 || deleting || editing !== null} onClick={() => showPage(currentPage - 1)}>Previous</Button>
              <span className="text-sm text-ink-2" aria-live="polite">Page {currentPage + 1} of {pageCount}</span>
              <Button variant="secondary" disabled={currentPage + 1 === pageCount || deleting || editing !== null} onClick={() => showPage(currentPage + 1)}>Next</Button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
