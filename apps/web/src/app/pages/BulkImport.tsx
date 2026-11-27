// Many lab reports at once: PDFs with text are read on this device, photos and scanned PDFs by Brain (asked
// once for all of them), then one review per blood test, oldest first. Nothing is saved before Save.
import { providerInfo, takesPictures } from "@bt/shared/core/aiProviders";
import { todayIso } from "@bt/shared/core/dates";
import { type BulkTest, mergeReports, testSpan } from "@bt/shared/core/importers/bulk";
import { type ParsedReport, parseLabText } from "@bt/shared/core/importers/labText";
import type { Measurement } from "@bt/shared/core/types";
import { useEffect, useRef, useState } from "react";
import { modelLabel, useBrainSettings } from "../brain/menus";
import type { PreparedPhoto } from "../brain/photo";
import { isImage, isPdf, monthFirst, Review } from "../components/LabReview";
import { Button, Card, LinkButton, Notice } from "../components/ui";
import { formatDate } from "../format";
import { useAllMeasurements } from "../hooks";
import { BIOMARKER_MAP, BLOOD_MARKERS } from "../knowledge";
import { uploadFile, useProfiles } from "../profiles";
import { href } from "../router";

type FileState =
  | { status: "reading" }
  | { status: "read"; report: ParsedReport; byBrain?: boolean }
  | { status: "picture"; images: PreparedPhoto[] }
  | { status: "brain" }
  | { status: "skipped" }
  | { status: "failed"; error: string };

interface Item {
  id: number;
  file: File;
  state: FileState;
}

interface TestCard {
  test: BulkTest;
  state: "open" | "saved" | "dismissed";
  saveRequest?: number;
  saved?: Measurement[];
}

const waiting = (s: FileState) => s.status === "reading" || s.status === "brain" || s.status === "picture";

export function BulkImport({ files, onCancel }: { files: File[]; onCancel: () => void }) {
  const [items, setItems] = useState<Item[]>(() => files.map((file, id) => ({ id, file, state: { status: "reading" } })));
  const [pictures, setPictures] = useState<"ask" | "reading" | "skipped">("ask");
  const [tests, setTests] = useState<TestCard[] | null>(null);
  const existing = useAllMeasurements();
  const { mode, active } = useProfiles();
  const kept = useRef(new Set<string>());
  const stop = useRef(new AbortController());
  const set = (id: number, state: FileState) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, state } : x)));

  // Read every file on this device; photos and scanned PDFs wait for Brain.
  useEffect(() => {
    const controller = new AbortController();
    stop.current = controller;
    const put = (id: number, state: FileState) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, state } : x)));
    void (async () => {
      const { shrinkPhoto } = await import("../brain/photo");
      for (const [id, file] of files.entries()) {
        if (controller.signal.aborted) return;
        try {
          if (isImage(file)) put(id, { status: "picture", images: [await shrinkPhoto(file)] });
          else if (isPdf(file)) {
            const { readPdf } = await import("../pdf");
            const pdf = await readPdf(file);
            if (pdf.kind === "pages") put(id, { status: "picture", images: pdf.pages });
            else put(id, { status: "read", report: parseLabText(pdf.text, BLOOD_MARKERS, { monthFirst }) });
          } else put(id, { status: "failed", error: "Not a PDF or a photo." });
        } catch (e) {
          put(id, { status: "failed", error: e instanceof Error ? e.message : "This file couldn't be read." });
        }
      }
    })();
    return () => controller.abort();
  }, [files]);

  async function readPictures() {
    setPictures("reading");
    const { readPicturesWithBrain } = await import("../brain/readPictures");
    for (const item of items) {
      if (item.state.status !== "picture") continue;
      if (stop.current.signal.aborted) return;
      const { images } = item.state;
      set(item.id, { status: "brain" });
      try {
        const r = await readPicturesWithBrain(images, stop.current.signal);
        set(item.id, typeof r === "string" ? { status: "failed", error: r } : { status: "read", report: r, byBrain: true });
      } catch (e) {
        if (stop.current.signal.aborted) return;
        set(item.id, { status: "failed", error: e instanceof Error ? e.message : "Brain couldn't read it." });
      }
    }
  }

  function skipPictures() {
    setPictures("skipped");
    setItems((xs) => xs.map((x) => (x.state.status === "picture" ? { ...x, state: { status: "skipped" } } : x)));
  }

  const pending = items.filter((x) => waiting(x.state));
  const pictureCount = items.filter((x) => x.state.status === "picture").length;
  const stillReading = items.some((x) => x.state.status === "reading" || x.state.status === "brain");
  const ready = existing !== undefined && pending.length === 0;

  // Once every file is read (or skipped), merge them into one review per test.
  useEffect(() => {
    if (!ready || tests) return;
    const sources = items.flatMap((x) => (x.state.status === "read" ? [{ name: x.file.name, report: x.state.report }] : []));
    setTests(mergeReports(sources, existing ?? [], BIOMARKER_MAP, todayIso()).map((test) => ({ test, state: "open" })));
  }, [ready, tests, items, existing]);

  async function onSaved(index: number, saved: Measurement[], date: string) {
    const card = tests![index]!;
    setTests((ts) => ts!.map((t, i) => (i === index ? { ...t, state: "saved", saved } : t)));
    if (mode !== "folders" || !active) return;
    for (const name of card.test.files) {
      if (kept.current.has(name)) continue;
      const file = files.find((f) => f.name === name);
      if (!file) continue;
      kept.current.add(name);
      try {
        await uploadFile(active.id, file, `Lab report from ${date}, imported with others`);
      } catch {
        kept.current.delete(name);
      }
    }
  }

  const open = tests?.filter((t) => t.state === "open") ?? [];
  const savedAll = tests?.flatMap((t) => t.saved ?? []) ?? [];
  const finished = tests !== null && open.length === 0;
  const span = testSpan(tests?.flatMap((t) => (t.test.date ? [t.test.date] : [])) ?? []);
  const results = tests?.reduce((n, t) => n + t.test.report.rows.length, 0) ?? 0;
  const failed = items.filter((x) => x.state.status === "failed");

  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-col gap-3">
        <h2 className="font-serif text-2xl font-normal">
          {files.length} files{stillReading ? ": reading…" : ""}
        </h2>
        <ul className="flex flex-col divide-y divide-line text-sm">
          {items.map((x) => (
            <li key={x.id} className="flex min-h-10 flex-wrap items-center justify-between gap-x-3 py-1.5">
              <span className="min-w-0 truncate font-medium">{x.file.name}</span>
              <span className="text-ink-2">{statusText(x.state)}</span>
            </li>
          ))}
        </ul>
        {pictureCount > 0 && pictures === "ask" && <AskPictures count={pictureCount} onRead={() => void readPictures()} onSkip={skipPictures} />}
      </Card>

      {failed.length > 0 && ready && (
        <Notice tone="warn">
          {failed.length === 1 ? "One file" : `${failed.length} files`} couldn't be read. You can import {failed.length === 1 ? "it" : "them"} on{" "}
          {failed.length === 1 ? "its" : "their"} own, or type the values in.
        </Notice>
      )}

      {tests !== null && tests.length === 0 && (
        <Notice tone="warn" title="No results found">
          None of these files had results the app could recognise.
          <span className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={onCancel}>
              Choose other files
            </Button>
          </span>
        </Notice>
      )}

      {tests !== null && tests.length > 0 && !finished && (
        <Card className="flex flex-col gap-3">
          <h2 className="font-serif text-2xl font-normal">
            {tests.length} {tests.length === 1 ? "blood test" : "blood tests"}
            {span && span.from !== span.to ? `, ${formatDate(span.from)} to ${formatDate(span.to)}` : span ? `, ${formatDate(span.from)}` : ""}
          </h2>
          <p className="text-ink-2">
            {results} results found. Check each test against its report: values Brain read from pictures can be misread. Results already saved, and markers with
            two different values on one date, start unticked.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setTests((ts) => ts!.map((t) => (t.state === "open" ? { ...t, saveRequest: Date.now() } : t)))}>
              Save all {open.length} {open.length === 1 ? "test" : "tests"}
            </Button>
            <Button variant="quiet" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {tests?.map((t, i) =>
        t.state === "open" ? (
          <section key={`${t.test.date ?? "undated"}-${t.test.files.join("|")}`} className="flex flex-col gap-2">
            <h3 className="px-1 text-lg font-medium">
              {t.test.date ? formatDate(t.test.date) : "No date found"}
              <span className="ml-2 text-sm font-normal text-ink-2">{t.test.files.join(", ")}</span>
            </h3>
            <Review
              fileName={t.test.files.join(", ")}
              fromPicture={items.some((x) => t.test.files.includes(x.file.name) && x.state.status === "read" && x.state.byBrain)}
              report={t.test.report}
              inChat
              {...(t.saveRequest ? { saveRequest: t.saveRequest } : {})}
              onCancel={() => setTests((ts) => ts!.map((x, j) => (j === i ? { ...x, state: "dismissed" } : x)))}
              onSaved={(list, _skipped, date) => void onSaved(i, list, date)}
            />
          </section>
        ) : null,
      )}

      {finished && tests.length > 0 && (
        <Notice role="status" title={`Saved ${savedAll.length} ${savedAll.length === 1 ? "result" : "results"}`}>
          From {tests.filter((t) => t.state === "saved").length} of {tests.length} tests
          {span ? `, ${formatDate(span.from)} to ${formatDate(span.to)}` : ""}.
          <span className="mt-3 flex flex-wrap gap-2">
            <LinkButton href={href({ name: "blood" })}>See your timeline</LinkButton>
            <LinkButton variant="secondary" href={href({ name: "overview" })}>
              All results
            </LinkButton>
            <Button variant="secondary" onClick={onCancel}>
              Import more
            </Button>
          </span>
        </Notice>
      )}
    </div>
  );
}

function statusText(s: FileState): string {
  switch (s.status) {
    case "reading":
      return "Reading…";
    case "read":
      return `${s.report.rows.length} ${s.report.rows.length === 1 ? "result" : "results"}${s.report.date ? `, ${formatDate(s.report.date)}` : ", no date found"}${s.byBrain ? " (read by Brain)" : ""}`;
    case "picture":
      return "Photo or scan: needs Brain";
    case "brain":
      return "Brain is reading…";
    case "skipped":
      return "Skipped";
    case "failed":
      return s.error;
  }
}

/** One question for all the pictures: which model reads them and what it can see. */
function AskPictures({ count, onRead, onSkip }: { count: number; onRead: () => void; onSkip: () => void }) {
  const { settings, fresh } = useBrainSettings(true);
  const skip = (
    <Button variant="quiet" onClick={onSkip}>
      Skip {count === 1 ? "it" : "them"}
    </Button>
  );
  if (!fresh && settings === undefined) return <p className="text-ink-2">Checking which AI model is set up…</p>;
  const what = `${count} ${count === 1 ? "photo or scan" : "photos or scans"}`;
  if (!settings?.ready.ok || !takesPictures(settings.assistant.provider))
    return (
      <Notice tone="warn" title={`${what} need Brain`}>
        Photos and scanned PDFs are read by Brain, and {settings === null ? "the app's server isn't running" : "no model that can read pictures is ready"}.
        <span className="mt-3 flex flex-wrap gap-2">
          <LinkButton href={href({ name: "data", tab: "models" })}>Set up a model</LinkButton>
          {skip}
        </span>
      </Notice>
    );
  const info = providerInfo(settings.assistant.provider);
  return (
    <Notice title={`Send ${what} to Brain to read?`}>
      They go to {modelLabel(settings.assistant)} one report at a time{info?.retention === "depends" ? ", which keeps data according to your own login" : ""},
      with none of your saved data. The model sees everything printed on them, including your name, birth date and ID numbers. Nothing is saved until you check
      the values.
      <span className="mt-3 flex flex-wrap gap-2">
        <Button onClick={onRead}>Read them with Brain</Button>
        {skip}
      </span>
    </Notice>
  );
}
