import { useEffect, useId, useRef, useState } from "react";
import { CLAIM_CATEGORIES, claimCheckLabel, claimGradeChange, claimRunKey, publicClaimTopic, type ClaimCategory, type ClaimCheck, type ClaimDepth, type ClaimResearch, type ClaimRequest } from "@bt/shared/core/claimEvidence";
import type { NutrientDef } from "@bt/shared/core/nutrients";
import { useServerStatus } from "../api";
import { checkClaimEvidence, refreshClaimUpdates, sameClaim, useClaimEvidence, type ClaimRecordUpdate } from "../claimEvidence";
import { formatDate } from "../format";
import { href } from "../router";
import { CitedAnswer } from "./CitedAnswer";
import { GRADE, GradeBadge } from "./evidence";
import { SimpleSelect } from "./UnitSelect";
import { Button, Card, inputStyles } from "./ui";
import { More } from "./disclosure";

const keyFor = (request: ClaimRequest) => JSON.stringify([request.nutrientId, request.claim, request.topic]);
const categoryLabel: Record<ClaimCategory, string> = { health: "Health", longevity: "Longevity", appearance: "Appearance" };
const categoryOptions = CLAIM_CATEGORIES.map((value) => ({ value, label: categoryLabel[value] }));
const gradeName = (check: ClaimCheck) => check.grade ? GRADE[check.grade].label : "Not graded";
const budgetName = (check: ClaimCheck) => check.research?.depth === "deep" ? "Deep" : check.research?.depth === "quick" ? "Quick" : "Unknown";
type CategorizedClaim = ClaimRequest & { category: ClaimCategory; label: string };

/** Claim-by-claim research; neither opening the page nor detecting a new paper calls a model. */
export function ClaimEvidencePanel({ n, guide, critical }: { n: NutrientDef; guide: NonNullable<NutrientDef["simpleGuide"]>; critical: boolean }) {
  const snapshot = useClaimEvidence();
  const server = useServerStatus();
  const [active, setActive] = useState<{ key: string; controller: AbortController } | null>(null);
  const activeRef = useRef<AbortController | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [topic, setTopic] = useState("");
  const [topicError, setTopicError] = useState("");
  const [category, setCategory] = useState<ClaimCategory>("health");
  const [discovering, setDiscovering] = useState<string[]>([]);
  const inputId = useId();
  const staticRequests: CategorizedClaim[] = (n.commonUses ?? []).flatMap((claim) => {
    const topic = guide.claimTopics?.[claim];
    return topic ? [{ nutrientId: n.id, claim, topic, category: guide.claimCategories?.[claim] ?? "health", label: guide.claimLabels?.[claim] ?? claim }] : [];
  });
  const custom = snapshot?.cache.customTopics.filter((r) => r.nutrientId === n.id && !staticRequests.some((s) => sameClaim(s, r)))
    .map((r): CategorizedClaim => ({ ...r, category: r.category ?? "health", label: r.claim })) ?? [];
  const requests = [...staticRequests, ...custom];
  // Depend on successful checks, not record-count writes, to avoid a refresh/render loop.
  const checkedKey = snapshot?.cache.checks.filter((c) => requests.some((r) => sameClaim(r, c))).map((c) => `${keyFor(c)}:${c.checkedAt}`).join("|") ?? "";
  const identityKey = snapshot ? JSON.stringify(snapshot.identity) : "";
  useEffect(() => () => { activeRef.current?.abort(); }, []);
  useEffect(() => { if (critical) activeRef.current?.abort(); }, [critical]);
  useEffect(() => {
    if (!snapshot || snapshot.error || !checkedKey) return;
    const controller = new AbortController();
    const checks = snapshot.cache.checks.filter((c) => requests.some((r) => sameClaim(r, c)));
    void (async () => {
      for (const check of checks) {
        if (controller.signal.aborted) break;
        const key = keyFor(check);
        setDiscovering((previous) => [...previous, key]);
        try { await refreshClaimUpdates(check, { signal: controller.signal, expectedIdentity: snapshot.identity }); }
        catch { /* Stored metadata errors are displayed below; cancellation never changes a grade. */ }
        finally { if (!controller.signal.aborted) setDiscovering((previous) => previous.filter((value) => value !== key)); }
      }
    })();
    return () => { controller.abort(); setDiscovering([]); };
    // The serialized successful checks and profile identity are the intentional effect boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkedKey, identityKey]);

  async function run(request: CategorizedClaim, customTopic = false, depth: ClaimDepth = "quick") {
    if (!snapshot || snapshot.error || critical || activeRef.current) return;
    const key = keyFor(request);
    const controller = new AbortController();
    activeRef.current = controller;
    setActive({ key, controller });
    setErrors((previous) => ({ ...previous, [key]: "" }));
    try {
      await checkClaimEvidence(request, { signal: controller.signal, expectedIdentity: snapshot.identity, custom: customTopic, category: customTopic ? request.category : undefined, depth });
    } catch (error) {
      const message = controller.signal.aborted ? "Check cancelled. Any saved check has been kept." : server === null
        ? "Could not reach the local server. Start it to check evidence; saved checks remain available here."
        : error instanceof Error ? error.message : "The evidence check failed. Any saved check has been kept. Try again.";
      if (customTopic) setTopicError(message);
      else setErrors((previous) => ({ ...previous, [key]: message }));
    } finally {
      if (activeRef.current === controller) { activeRef.current = null; setActive(null); }
    }
  }

  return (
    <Card id="uses" className="scroll-mt-24">
      <h2 className="font-serif text-2xl font-normal">Potential benefits &amp; common claims</h2>
      <p className="mt-2 text-sm text-ink-2">People explore {n.name.toLowerCase()} for several purposes. These are proposed uses, not established benefits; the evidence differs by claim.</p>
      <p className="mt-2 text-sm text-ink-2">Check any statement with Brain. Your saved assessment, confidence and sources appear alongside it; nothing is checked automatically.</p>
      {critical && <p className="mt-3 text-sm font-medium">Contact a doctor about the critical result first. Evidence checks are not available here right now.</p>}
      {!critical && server === null && <p className="mt-3 text-sm text-ink-2">New checks need the local server. Saved results can still be read offline.</p>}
      {!critical && server && !server.ready.ok && <p className="mt-3 text-sm text-ink-2">{server.ready.reason ?? "Set up a model in Settings to check evidence."} <a href={href({ name: "data", tab: "models" })} className="underline underline-offset-2">AI model settings</a></p>}
      {snapshot?.damaged && <p role="status" className="mt-3 text-sm text-ink-2">Some saved evidence data was invalid and is not shown. Check the affected claims again.</p>}
      {snapshot?.error && <p role="alert" className="mt-3 text-sm text-danger">{snapshot.error}</p>}
      {CLAIM_CATEGORIES.map((group) => {
        const groupRequests = requests.filter((request) => request.category === group);
        return (
          <section key={group} aria-labelledby={`${inputId}-${group}`} className="mt-8">
            <header className="rounded-lg bg-sunken px-3 py-3 sm:px-4">
              <div className="flex items-baseline justify-between gap-3">
                <h3 id={`${inputId}-${group}`} className="text-lg font-semibold">{categoryLabel[group]}</h3>
                <span className="shrink-0 text-xs text-ink-2">{groupRequests.length} {groupRequests.length === 1 ? "claim" : "claims"}</span>
              </div>
              {group === "longevity" && <p className="mt-1 text-sm text-ink-2">Proposed aging-related uses do not establish life extension.</p>}
            </header>
            <ul className="divide-y divide-line px-1 sm:px-4">
              {groupRequests.map((request) => {
                const key = keyFor(request);
                const check = snapshot?.cache.checks.find((c) => sameClaim(c, request));
                const failed = snapshot?.cache.attempts?.find((c) => sameClaim(c, request));
                const latest = failed ?? check;
                const history = (snapshot?.cache.history ?? []).filter((entry) => sameClaim(entry, request)).sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt));
                const deepLabel = check?.research?.depth === "deep" || failed?.research?.depth === "deep" || history.some((entry) => entry.research?.depth === "deep") ? "Rerun deeper check" : "Run deeper check";
                const update = snapshot?.cache.updates.find((u) => sameClaim(u.request, request) && u.forCheckedAt === check?.checkedAt);
                const busy = active?.key === key;
                return (
                  <li key={key} className="py-4 last:pb-0">
                    <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:gap-4">
                      <div className="min-w-0">
                        <h4 className="font-medium break-words">{request.label}</h4>
                        {check && <CheckRecency check={check} previous={history[0]} />}
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2" aria-live="polite">
                          {busy ? <span>Searching and screening evidence…</span> : latest ? <><span className="font-medium text-ink">{claimCheckLabel(latest)}</span>{latest.grade && latest.research?.status !== "indirect_only" && <GradeBadge grade={latest.grade} short />}</> : <span>Not checked yet</span>}
                        </div>
                        {latest?.research ? <p className="mt-1 text-xs text-ink-2">{latest.research.retrieved} retrieved · {latest.research.screened} screened · {latest.research.included} included</p> : check ? <p className="mt-1 text-xs text-ink-2">Legacy check · search coverage unverified. Recheck to record searches and screening.</p> : null}
                      </div>
                      {busy ? <Button variant="secondary" onClick={() => active?.controller.abort()}>Cancel check</Button> : <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col sm:items-stretch">
                        <Button variant="secondary" disabled={!!active || !snapshot || !!snapshot.error || critical} aria-label={`${latest ? "Rerun quick check" : "Check evidence"}: ${request.label}`} onClick={() => void run(request)}>{failed ? "Retry search" : check ? "Rerun quick check" : "Check evidence"}</Button>
                        {latest && <Button variant="secondary" className="py-2" disabled={!!active || !snapshot || !!snapshot.error || critical} aria-label={`${deepLabel}: ${request.label}`} onClick={() => void run(request, false, "deep")}>
                          <span className="flex flex-col items-center gap-0.5 whitespace-normal">
                            <span>{deepLabel}</span>
                            <span className="text-xs font-normal text-ink-2">More papers, longer abstracts</span>
                          </span>
                        </Button>}
                      </div>}
                    </div>
                    {failed?.research && <div className="mt-3 text-sm text-ink-2"><p role="status">{failed.research.error}</p><ResearchAudit research={failed.research} /><CheckProvenance check={failed} /></div>}
                    {failed && check && <p className="mt-3 text-sm font-medium">Previous saved assessment</p>}
                    {check && <SavedCheck check={check} update={update} discovering={discovering.includes(key)} />}
                    {history.length > 0 && <CheckHistory history={history} />}
                    {errors[key] && <p role="alert" className="mt-2 text-sm text-ink-2">{errors[key]}</p>}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      <More summary="About deeper checks" className="mt-6 text-sm text-ink-2">
        <p>Quick and deep checks use the provider, model and reasoning effort selected in Settings. Deeper checks retrieve more papers, read longer abstracts, allow more follow-up searches and model turns, and have a longer time limit. They may take longer and cost more.</p>
      </More>
      <form className="mt-8 border-t border-line pt-6" onSubmit={(event) => {
        event.preventDefault();
        const value = publicClaimTopic(topic);
        if (!value) { setTopicError("Use a short public topic, such as sleep, without personal details."); return; }
        setTopicError("");
        const request = { nutrientId: n.id, claim: value, topic: value, category, label: value };
        setTopic("");
        void run(request, true);
      }}>
        <h3 className="font-medium">Check something else</h3>
        <p id={`${inputId}-help`} className="mt-1 text-sm text-ink-2">A public research topic only, such as sleep. Do not include your name, results or medical history. Older topics without a category stay under Health.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-[9rem_minmax(0,1fr)_auto] sm:items-end">
          <SimpleSelect label="Category" options={categoryOptions} value={category} onChange={(value) => setCategory(value as ClaimCategory)} disabled={!!active || !snapshot || !!snapshot.error || critical} className="min-w-0" />
          <label htmlFor={inputId} className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">Public topic
            <input id={inputId} className={inputStyles} value={topic} onChange={(event) => setTopic(event.target.value)} maxLength={100} placeholder="e.g. sleep" aria-describedby={`${inputId}-help${topicError ? ` ${inputId}-error` : ""}`} aria-invalid={!!topicError} disabled={!!active || !snapshot || !!snapshot.error || critical} />
          </label>
          <Button type="submit" variant="secondary" disabled={!!active || !topic.trim() || !snapshot || !!snapshot.error || critical}>Add &amp; check</Button>
        </div>
        {topicError && <p id={`${inputId}-error`} role="alert" className="mt-2 text-sm text-danger">{topicError}</p>}
      </form>
      <More summary={<>About these checks &amp; newer-record signals</>} className="mt-3 text-sm text-ink-2">
        <div className="flex flex-col gap-2 pb-1">
          <p>AI assessments are saved with the date, model, searches and screening decisions. They are not clinician-reviewed. Search failure and incomplete screening are inconclusive. “No evidence found” requires a complete, error-free search ladder and screening; it is not proof of no effect.</p>
          <p>For saved checks, PubMed is checked at most once a day for matching newer review or trial records. Counts are discovery signals, not verified human evidence or changed verdicts. Recheck explicitly to ask Brain again.</p>
          <p>The search starts on the next UTC day after the assessment. It misses additions on the assessment day, records not yet indexed, and studies without matching words or design labels. Only the supplement and public topic are sent; your profile, chat and files are not.</p>
        </div>
      </More>
    </Card>
  );
}

function SavedCheck({ check, update, discovering }: { check: ClaimCheck; update?: ClaimRecordUpdate; discovering: boolean }) {
  const awaitingWindow = update?.result && check.checkedAt.slice(0, 10) === update.result.checkedAt.slice(0, 10);
  return (
    <div className="mt-2 min-w-0 text-sm text-ink-2">
      {awaitingWindow ? <p className="mt-1">New-record checks start after the assessment day (UTC).</p> : update?.result ? (
        <p className="mt-1"><a href={`https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(update.result.query)}`} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{update.result.count === 0 ? "No matching newer records" : `${update.result.count} matching newer ${update.result.count === 1 ? "record" : "records"}`}</a> · checked {formatDate(update.result.checkedAt.slice(0, 10))}{update.result.count > 0 && ". Recheck to reassess the evidence."}</p>
      ) : discovering ? <p className="mt-1" role="status">Looking for matching newer records…</p> : update && <p className="mt-1">New-record signal unknown · {update.error ? "lookup unavailable" : "last lookup did not finish"} ({formatDate(update.attemptedAt.slice(0, 10))}). Your evidence check is unchanged.</p>}
      <More summary={<>Read evidence &amp; sources</>} tone="plain" className="mt-1">
        <div className="pb-2 text-ink">
          <CitedAnswer text={`${check.summary}\n\n**Limits**\n${check.limitations}${check.citations.length ? `\n\n**Retrieved source links**\n${check.citations.map((id) => `[${id}]`).join(" ")}` : "\n\nNo citable sources were returned."}`} allowed={new Set(check.citations)} />
        </div>
      </More>
      {check.research && <ResearchAudit research={check.research} />}
      <CheckProvenance check={check} />
    </div>
  );
}

function CheckRecency({ check, previous }: { check: ClaimCheck; previous?: ClaimCheck }) {
  const change = previous ? claimGradeChange(check, previous) : undefined;
  return <div className="mt-2 flex flex-col gap-1 text-sm">
    <p className="font-medium text-ink">Last checked <time dateTime={check.checkedAt}>{formatDate(check.checkedAt.slice(0, 10))}</time></p>
    {previous && <p className="text-xs text-ink-2">Previous: <time dateTime={previous.checkedAt}>{formatDate(previous.checkedAt.slice(0, 10))}</time> ({budgetName(previous).toLowerCase()}, {gradeName(previous)})</p>}
    {change && <p role="status" className="font-medium text-ink">Was {gradeName(previous!)}, now {gradeName(check)}</p>}
  </div>;
}

function CheckHistory({ history }: { history: ClaimCheck[] }) {
  return <More summary={<>Check history ({history.length})</>} tone="plain" className="mt-3 text-sm">
    <p className="mb-2 text-xs text-ink-2">Earlier assessments are kept in full. Grade changes may reflect new evidence, search coverage or model assessment.</p>
    <ol className="divide-y divide-line">
      {history.map((entry) => <li key={claimRunKey(entry)}>
        <More summary={<><span className="font-medium"><time dateTime={entry.checkedAt}>{formatDate(entry.checkedAt.slice(0, 10))}</time> · {budgetName(entry)} · {gradeName(entry)}</span>
            <span className="mt-1 block text-xs text-ink-2">{entry.research ? `${entry.research.retrieved} retrieved · ${entry.research.screened} screened · ${entry.research.included} included` : "Counts unavailable (legacy check)"}</span></>} className="py-2">
          <SavedCheck check={entry} discovering={false} />
        </More>
      </li>)}
    </ol>
  </More>;
}

function CheckProvenance({ check }: { check: ClaimCheck }) {
  const budget = check.research?.depth === "deep" ? "Deep" : check.research?.depth === "quick" ? "Quick" : "Unknown (legacy check)";
  return <footer className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-line pt-3 text-xs text-ink-2">
    <span className="min-w-0 break-words">Model: {check.model}</span>
    <span className="font-medium text-ink">Budget: {budget}</span>
    <span>Locally saved · <time dateTime={check.checkedAt}>{formatDate(check.checkedAt.slice(0, 10))}</time></span>
  </footer>;
}

function ResearchAudit({ research }: { research: ClaimResearch }) {
  return <More summary={<>Searches &amp; screening ({research.depth} check)</>} tone="plain" className="mt-1 text-sm text-ink-2">
    <ol className="flex list-decimal flex-col gap-3 pl-5">
      {research.queries.map((query, i) => <li key={i}>
        <p className="font-medium text-ink">{query.rung} · {query.resultCount === null ? "count unavailable" : `${query.resultCount} results`} · relevance</p>
        <p className="break-words">{query.query}</p>
        {query.error && <p>Search error: {query.error}</p>}
      </li>)}
    </ol>
    {research.records.length > 0 && <ul className="mt-4 divide-y divide-line">
      {research.records.map((record) => {
        const screen = research.screening.find((item) => item.id === record.id);
        return <li key={record.id} className="py-3">
          <p className="font-medium text-ink">{record.title}</p>
          <p>{record.id} · {screen ? screen.decision === "exclude" ? "Excluded" : screen.decision === "direct" ? "Direct" : "Indirect" : "Not screened"}</p>
          {screen && <><p>{screen.reason}</p><p className="mt-1 text-xs">{screen.route} · {screen.formulation} · {screen.evidence.replace(/_/g, " ")}</p></>}
        </li>;
      })}
    </ul>}
  </More>;
}
