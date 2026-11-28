// "Try one change": pick a result to improve, choose one change from what research says (or your own), plan it
// with the right before and after tests, and start it as a habit that watches that marker. The result appears on
// the habit's page when the "after" results are in, with how often the habit was ticked off.

import { Field } from "@base-ui/react/field";
import { addDays, todayIso } from "@bt/shared/core/dates";
import { selectLevers } from "@bt/shared/core/evidence";
import type { Weekday } from "@bt/shared/core/plans";
import { type ProtocolCategory, safetyLabels, safetyNotes, validateProtocol } from "@bt/shared/core/protocols";
import { type Flag, flagLatest, groupByBiomarker, isCritical } from "@bt/shared/core/trends";
import { trialAfterFrom, trialReadiness, trialRetestDays } from "@bt/shared/core/trial";
import type { BiomarkerDef, EvidenceClaim, Measurement, SafetyId } from "@bt/shared/core/types";
import { useState } from "react";
import { createHabit, db } from "../../db/db";
import { ChoiceGroup } from "../components/ChoiceGroup";
import { CriticalBanner } from "../components/CriticalBanner";
import { GradeBadge } from "../components/evidence";
import { DaysPicker } from "../components/PlanWhen";
import { SafetyNotices } from "../components/SafetyNotices";
import { Button, Card, cardStyles, cx, errorStyles, eyebrowStyles, helpStyles, inputStyles, labelStyles, Notice, PageTitle } from "../components/ui";
import { CATEGORY_LABEL, displayUnitFor, FLAG_LABEL, formatDate, showMeasurement, valueUnit } from "../format";
import { useAllMeasurements, useDisplayUnits, useProfile, useProtocols } from "../hooks";
import { BIOMARKER_MAP, EVIDENCE, isBodyMarker, LIFESTYLE, nameInSentence, shortName, WHOLE_FOODS } from "../knowledge";
import { href, navigate } from "../router";

const KIND_CATEGORY: Record<EvidenceClaim["kind"], ProtocolCategory> = { food: "diet", diet: "diet", supplement: "supplement", habit: "lifestyle" };
const KIND_LABEL: Record<EvidenceClaim["kind"], string> = { food: "Food", diet: "Diet", supplement: "Supplement", habit: "Habit" };

interface Choice {
  label: string;
  category: ProtocolCategory;
}

export function TryChangePage({ marker }: { marker?: string }) {
  const all = useAllMeasurements();
  const protocols = useProtocols();
  const profile = useProfile();
  const [picked, setPicked] = useState<string | undefined>(marker && BIOMARKER_MAP.has(marker) ? marker : undefined);
  const [choice, setChoice] = useState<Choice>();
  if (!all || !protocols) return <p className="text-ink-2">Loading…</p>;

  const byMarker = groupByBiomarker(all);
  const flags = new Map<string, Flag>(
    [...byMarker].map(([id, ms]) => [id, BIOMARKER_MAP.get(id) ? flagLatest(BIOMARKER_MAP.get(id)!, ms, profile) : "unknown"]),
  );
  const critical = [...byMarker].flatMap(([id, ms]) => {
    const def = BIOMARKER_MAP.get(id);
    const flag = flags.get(id)!;
    return def && isCritical(flag) ? [{ def, measurement: ms.at(-1)!, low: flag === "critical-low" }] : [];
  });
  const def = picked ? BIOMARKER_MAP.get(picked) : undefined;

  return (
    <>
      <PageTitle sub="Pick one result to improve, try one change for a few weeks, and see what happened in you, compared with your normal test-to-test variation.">
        Try one change
      </PageTitle>
      <div className="flex flex-col gap-5">
        <CriticalBanner items={critical} />
        {!def ? (
          <PickMarker byMarker={byMarker} flags={flags} onPick={setPicked} />
        ) : isCritical(flags.get(def.id) ?? "unknown") ? (
          <Notice tone="warn" title={`Talk to a doctor about your ${nameInSentence(def)} first`}>
            Your latest result is far outside the usual range. That needs a doctor, not a self-test.{" "}
            <button type="button" className="font-medium text-accent underline" onClick={() => setPicked(undefined)}>
              Choose another result
            </button>
          </Notice>
        ) : !choice ? (
          <ChooseChange
            def={def}
            flag={flags.get(def.id)}
            ms={byMarker.get(def.id) ?? []}
            safety={safetyNotes(safetyLabels(protocols, profile)).map((n) => n.id)}
            onBack={() => setPicked(undefined)}
            onChoose={setChoice}
          />
        ) : (
          <PlanChange def={def} all={all} choice={choice} onBack={() => setChoice(undefined)} />
        )}
      </div>
    </>
  );
}

function PickMarker({ byMarker, flags, onPick }: { byMarker: Map<string, Measurement[]>; flags: Map<string, Flag>; onPick: (id: string) => void }) {
  const units = useDisplayUnits();
  const today = todayIso();
  const defs = [...byMarker.keys()].flatMap((id) => {
    const d = BIOMARKER_MAP.get(id);
    return d && !isCritical(flags.get(id) ?? "unknown") ? [d] : [];
  });
  const out = defs.filter((d) => ["low", "high"].includes(flags.get(d.id) ?? ""));
  const often = defs.filter((d) => !out.includes(d) && isBodyMarker(d) && (byMarker.get(d.id) ?? []).filter((m) => m.date > addDays(today, -30)).length >= 20);
  const rest = defs.filter((d) => !out.includes(d) && !often.includes(d)).sort((a, b) => a.name.localeCompare(b.name));
  const group = (title: string, help: string, list: BiomarkerDef[]) =>
    list.length > 0 && (
      <section aria-label={title}>
        <h2 className={eyebrowStyles}>{title}</h2>
        <p className={cx(helpStyles, "mt-1")}>{help}</p>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((d) => {
            const latest = byMarker.get(d.id)!.at(-1)!;
            const unit = displayUnitFor(d, units[d.id]);
            const flag = flags.get(d.id) ?? "unknown";
            return (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => onPick(d.id)}
                  className={cx(cardStyles, "flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left hover:border-line-strong")}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{shortName(d)}</span>
                    <span className="block text-sm text-ink-2">
                      {showMeasurement(d, latest, unit)} {valueUnit(d, unit)} · {formatDate(latest.date)}
                    </span>
                  </span>
                  {flag === "low" || flag === "high" ? <span className="shrink-0 text-sm font-medium text-warn">{FLAG_LABEL[flag]}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    );
  if (defs.length === 0)
    return (
      <Card className="text-ink-2">
        <p>
          Add a result first: the change is judged against your own numbers.{" "}
          <a href={href({ name: "add" })} className="font-medium text-accent">
            Add data
          </a>
        </p>
      </Card>
    );
  return (
    <div className="flex flex-col gap-6">
      {group("Outside the range", "Latest result above or below the usual range.", out)}
      {group("Measured most days", "From a device or typed in often: you'll see a result within weeks.", often)}
      {group("Your other results", "Blood tests need a test before and after.", rest)}
    </div>
  );
}

function ChooseChange({
  def,
  flag,
  ms,
  safety,
  onBack,
  onChoose,
}: {
  def: BiomarkerDef;
  flag: Flag | undefined;
  ms: Measurement[];
  safety: SafetyId[];
  onBack: () => void;
  onChoose: (c: Choice) => void;
}) {
  const profile = useProfile();
  const protocols = useProtocols() ?? [];
  const notes = safetyNotes(safetyLabels(protocols, profile));
  const sel = selectLevers(def.id, flag, EVIDENCE, safety);
  const lifestyle = LIFESTYLE.filter((l) => l.markers.includes(def.id) && l.asHabit !== false);
  const foods = WHOLE_FOODS.filter((f) => f.markers.includes(def.id));
  const [own, setOwn] = useState("");
  const latest = ms.at(-1);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-serif text-2xl font-normal">
          {sel.focus ? `What can ${sel.focus === "low" ? "raise" : "lower"} ${nameInSentence(def)}` : `What can change ${nameInSentence(def)}`}
        </h2>
        <button type="button" onClick={onBack} className="text-sm font-medium text-accent hover:underline">
          Choose another result
        </button>
      </div>
      {latest && (
        <p className="text-ink-2">
          Latest {formatDate(latest.date)}. Pick one change: trying several at once makes it impossible to tell what did it. These are options from research to
          discuss with your doctor, not instructions.
        </p>
      )}
      <SafetyNotices notes={notes} />
      {sel.claims.length > 0 && (
        <section aria-label="From research">
          <h3 className={eyebrowStyles}>From research, strongest evidence first</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {sel.claims.map((c) => (
              <li key={c.id} className={cx(cardStyles, "flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between")}>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {c.lever}
                    <span className="rounded-full bg-sunken px-2 py-0.5 text-xs font-normal text-ink-2">{KIND_LABEL[c.kind]}</span>
                    <GradeBadge grade={c.grade} short />
                  </p>
                  <p className="mt-1 text-sm text-ink-2">{c.summary}</p>
                  {c.caution && <p className="mt-1 text-sm text-ink-2">Caution: {c.caution}</p>}
                </div>
                <Button variant="secondary" className="shrink-0" onClick={() => onChoose({ label: c.lever.slice(0, 80), category: KIND_CATEGORY[c.kind] })}>
                  Try this
                </Button>
              </li>
            ))}
          </ul>
          {sel.hidden.length > 0 && (
            <p className="mt-2 text-sm text-ink-2">
              {sel.hidden.length} more {sel.hidden.length === 1 ? "isn't" : "aren't"} shown because of your medicines or conditions. Ask your doctor.
            </p>
          )}
        </section>
      )}
      {(lifestyle.length > 0 || foods.length > 0) && (
        <section aria-label="Also researched">
          <h3 className={eyebrowStyles}>Also researched for {nameInSentence(def)}</h3>
          <p className={cx(helpStyles, "mt-1")}>
            Some of these raise it and some lower it, or the evidence is mixed: read the page first, then write the change below if it fits.
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {[
              ...lifestyle.map((l) => ({ id: l.id, name: l.name, to: href({ name: "lifestyle-item", id: l.id }) })),
              ...foods.map((f) => ({ id: f.id, name: f.name, to: href({ name: "wholefood", id: f.id }) })),
            ].map((x) => (
              <li key={x.id}>
                <a href={x.to} className={cx(cardStyles, "flex min-h-11 items-center px-3 text-sm font-medium text-ink no-underline hover:border-line-strong")}>
                  {x.name}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-label="Your own change" className={cx(cardStyles, "flex flex-col gap-3 p-4")}>
        <Field.Root className="flex flex-col gap-1.5">
          <Field.Label className={labelStyles}>Or your own change</Field.Label>
          <Field.Control value={own} onValueChange={setOwn} placeholder="e.g. Walk 30 minutes after dinner" maxLength={80} className={inputStyles} />
        </Field.Root>
        <Button className="self-start" disabled={!own.trim()} onClick={() => onChoose({ label: own.trim(), category: "lifestyle" })}>
          Plan it
        </Button>
      </section>
    </div>
  );
}

function PlanChange({ def, all, choice, onBack }: { def: BiomarkerDef; all: Measurement[]; choice: Choice; onBack: () => void }) {
  const today = todayIso();
  const [label, setLabel] = useState(choice.label);
  const [category, setCategory] = useState<ProtocolCategory>(choice.category);
  const [schedule, setSchedule] = useState<{ days: Weekday[]; everyOther: boolean }>({ days: [], everyOther: false });
  const ready0 = trialReadiness(def, all, today, today);
  const [start, setStart] = useState(ready0.ready ? today : addDays(today, 14));
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const readiness = trialReadiness(def, all, start || today, today);
  const retest = trialRetestDays(def, readiness);
  const afterFrom = trialAfterFrom(start || today, retest);
  const name = nameInSentence(def);

  async function begin() {
    setError(undefined);
    const r = validateProtocol({ label, category, start, ...schedule }, today);
    if (!r.ok) return setError(Object.values(r.errors)[0]);
    setSaving(true);
    try {
      const habitId = await createHabit(r.entry, { markerIds: [def.id], retestAfterDays: retest, today });
      const watch = await db.experiments.filter((e) => e.protocolId === habitId).first();
      navigate(watch ? { name: "experiment", id: watch.id } : { name: "habits" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "It couldn't be saved. Please try again.");
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-serif text-2xl font-normal">Plan it</h2>
        <button type="button" onClick={onBack} className="text-sm font-medium text-accent hover:underline">
          Choose another change
        </button>
      </div>
      <Card className="flex flex-col gap-5">
        <Field.Root className="flex flex-col gap-1.5">
          <Field.Label className={labelStyles}>What you'll do</Field.Label>
          <Field.Control value={label} onValueChange={setLabel} maxLength={80} className={inputStyles} />
          <Field.Description className={helpStyles}>In your own words, with your own amount if it has one. The app never suggests a dose.</Field.Description>
        </Field.Root>
        <ChoiceGroup<ProtocolCategory>
          label="Type"
          value={category}
          onChange={setCategory}
          options={(Object.keys(CATEGORY_LABEL) as ProtocolCategory[]).map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))}
        />
        {category === "medication" && <Notice>This is only for your own record. Don't start, stop or change a medicine without talking to your doctor.</Notice>}
        <DaysPicker value={schedule} onChange={setSchedule} />
        <Field.Root className="flex flex-col gap-1.5 sm:max-w-xs">
          <Field.Label className={labelStyles}>Start</Field.Label>
          <Field.Control type="date" value={start} min={today} onValueChange={setStart} className={inputStyles} />
        </Field.Root>
      </Card>

      <section aria-label="Before and after" className="grid gap-3 sm:grid-cols-2">
        <div className={cx(cardStyles, "p-4", !readiness.ready && "border-warn/50 bg-warn-soft")}>
          <p className={eyebrowStyles}>Before</p>
          <p className="mt-1">
            {readiness.ready
              ? `You have ${readiness.before} ${readiness.before === 1 ? "result" : "results"} of ${name} from the 4 months before the start. Enough to compare.`
              : `The comparison needs ${readiness.need} ${name} ${readiness.need === 1 ? "result" : "results"} from the 4 months before the start; you have ${readiness.before}. Measure ${readiness.need - readiness.before === 1 ? "once more" : `${readiness.need - readiness.before} more times`} before ${formatDate(start || today)}, or start later.`}
          </p>
        </div>
        <div className={cx(cardStyles, "p-4")}>
          <p className={eyebrowStyles}>After</p>
          <p className="mt-1">
            From {formatDate(afterFrom)}, add {readiness.need === 1 ? "a result" : `at least ${readiness.need} results`} of {name}. Keep the change going until
            then, and tick it off on the dashboard each day.
          </p>
        </div>
      </section>
      {readiness.need > 1 && (
        <p className="text-sm text-ink-2">
          Why {readiness.need}: there's no published test-to-test variation for {name} in the app yet, so normal variation is worked out from your own results,
          which needs at least {readiness.need} on each side.
        </p>
      )}
      <p className="text-sm text-ink-2">
        A change beyond normal variation shows what happened in you; it doesn't prove the change caused it, and it may not happen in someone else.
      </p>
      {error && <p className={errorStyles}>{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void begin()} disabled={saving || !label.trim() || !start}>
          {start > today ? `Plan it from ${formatDate(start)}` : "Start today"}
        </Button>
      </div>
    </div>
  );
}
