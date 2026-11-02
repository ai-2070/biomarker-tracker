import { useEffect, useId, useRef, useState } from "react";
import { CLAIM_CATEGORIES, publicClaimTopic, type ClaimCategory, type ClaimCheck, type ClaimRequest } from "../../core/claimEvidence";
import type { NutrientDef } from "../../core/nutrients";
import { useServerStatus } from "../api";
import { checkClaimEvidence, refreshClaimUpdates, sameClaim, useClaimEvidence, type ClaimRecordUpdate } from "../claimEvidence";
import { formatDate } from "../format";
import { href } from "../router";
import { CitedAnswer } from "./CitedAnswer";
import { GradeBadge } from "./evidence";
import { SimpleSelect } from "./UnitSelect";
import { Button, Card, inputStyles } from "./ui";

const keyFor = (request: ClaimRequest) => JSON.stringify([request.nutrientId, request.claim, request.topic]);
const verdictLabel = { supported: "Supported", mixed: "Mixed findings", "not supported": "Not supported", "not enough evidence": "Not enough evidence" };
const categoryLabel: Record<ClaimCategory, string> = { health: "Health", longevity: "Longevity", appearance: "Appearance" };
const categoryOptions = CLAIM_CATEGORIES.map((value) => ({ value, label: categoryLabel[value] }));
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

  async function run(request: CategorizedClaim, customTopic = false) {
    if (!snapshot || snapshot.error || critical || activeRef.current) return;
    const key = keyFor(request);
    const controller = new AbortController();
    activeRef.current = controller;
    setActive({ key, controller });
    setErrors((previous) => ({ ...previous, [key]: "" }));
    try {
      await checkClaimEvidence(request, { signal: controller.signal, expectedIdentity: snapshot.identity, custom: customTopic, category: customTopic ? request.category : undefined });
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
      <p className="mt-2 text-sm text-ink-2">People explore astaxanthin for several purposes, including eye comfort and skin appearance. These are proposed uses, not established benefits; the evidence differs by claim.</p>
      <p className="mt-2 text-sm text-ink-2">Check any statement with Brain. Your saved assessment, confidence and sources appear alongside it; nothing is checked automatically.</p>
      {critical && <p className="mt-3 text-sm font-medium">Contact a doctor about the critical result first. Evidence checks are not available here right now.</p>}
      {!critical && server === null && <p className="mt-3 text-sm text-ink-2">New checks need the local server. Saved results can still be read offline.</p>}
      {!critical && server && !server.ready.ok && <p className="mt-3 text-sm text-ink-2">{server.ready.reason ?? "Set up a model in Settings to check evidence."} <a href={href({ name: "data", tab: "models" })} className="underline underline-offset-2">AI model settings</a></p>}
      {snapshot?.damaged && <p role="status" className="mt-3 text-sm text-ink-2">Some saved evidence data was invalid and is not shown. Check the affected claims again.</p>}
      {snapshot?.error && <p role="alert" className="mt-3 text-sm text-danger">{snapshot.error}</p>}
      {CLAIM_CATEGORIES.map((group) => (
        <section key={group} aria-labelledby={`${inputId}-${group}`} className="mt-5 border-t border-line pt-4">
          <h3 id={`${inputId}-${group}`} className="font-semibold">{categoryLabel[group]}</h3>
          {group === "longevity" && <p className="mt-1 text-sm text-ink-2">Proposed aging-related uses do not establish life extension.</p>}
          <ul className="mt-2 divide-y divide-line">
            {requests.filter((request) => request.category === group).map((request) => {
              const key = keyFor(request);
              const check = snapshot?.cache.checks.find((c) => sameClaim(c, request));
              const update = snapshot?.cache.updates.find((u) => sameClaim(u.request, request) && u.forCheckedAt === check?.checkedAt);
              const busy = active?.key === key;
              return (
                <li key={key} className="py-4 first:pt-2 last:pb-0">
                  <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:gap-4">
                    <div className="min-w-0">
                      <h4 className="font-medium break-words">{request.label}</h4>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2" aria-live="polite">
                        {busy ? <span>Checking evidence…</span> : check ? <><span className="font-medium text-ink">{verdictLabel[check.verdict]}</span>{check.grade ? <GradeBadge grade={check.grade} short /> : <span>No evidence grade</span>}</> : <span>Not checked yet</span>}
                      </div>
                    </div>
                    {busy ? <Button variant="secondary" onClick={() => active?.controller.abort()}>Cancel check</Button> : (
                      <Button variant="secondary" className="shrink-0" disabled={!!active || !snapshot || !!snapshot.error || critical} aria-label={`${check ? "Recheck" : "Check evidence"}: ${request.label}`} onClick={() => void run(request)}>{check ? "Recheck" : "Check evidence"}</Button>
                    )}
                  </div>
                  {check && <SavedCheck check={check} update={update} discovering={discovering.includes(key)} />}
                  {errors[key] && <p role="alert" className="mt-2 text-sm text-ink-2">{errors[key]}</p>}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <form className="mt-5 border-t border-line pt-4" onSubmit={(event) => {
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
      <details className="mt-3 text-sm text-ink-2">
        <summary className="min-h-11 cursor-pointer py-3">About these checks &amp; newer-record signals</summary>
        <div className="flex flex-col gap-2 pb-1">
          <p>AI assessments are saved with the date and the model that answered. They are not clinician-reviewed. No grade means the evidence could not be graded, not strong evidence against the claim.</p>
          <p>For saved checks, PubMed is checked at most once a day for matching newer review or trial records. Counts are discovery signals, not verified human evidence or changed verdicts. Recheck explicitly to ask Brain again.</p>
          <p>The search starts on the next UTC day after the assessment. It misses additions on the assessment day, records not yet indexed, and studies without matching words or design labels. Only the supplement and public topic are sent; your profile, chat and files are not.</p>
        </div>
      </details>
    </Card>
  );
}

function SavedCheck({ check, update, discovering }: { check: ClaimCheck; update?: ClaimRecordUpdate; discovering: boolean }) {
  const awaitingWindow = update?.result && check.checkedAt.slice(0, 10) === update.result.checkedAt.slice(0, 10);
  return (
    <div className="mt-2 min-w-0 text-sm text-ink-2">
      <p className="break-words">Locally saved AI check · <time dateTime={check.checkedAt}>{formatDate(check.checkedAt.slice(0, 10))}</time> · Model: {check.model}</p>
      {awaitingWindow ? <p className="mt-1">New-record checks start after the assessment day (UTC).</p> : update?.result ? (
        <p className="mt-1"><a href={`https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(update.result.query)}`} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{update.result.count === 0 ? "No matching newer records" : `${update.result.count} matching newer ${update.result.count === 1 ? "record" : "records"}`}</a> · checked {formatDate(update.result.checkedAt.slice(0, 10))}{update.result.count > 0 && ". Recheck to reassess the evidence."}</p>
      ) : discovering ? <p className="mt-1" role="status">Looking for matching newer records…</p> : update && <p className="mt-1">New-record signal unknown · {update.error ? "lookup unavailable" : "last lookup did not finish"} ({formatDate(update.attemptedAt.slice(0, 10))}). Your evidence check is unchanged.</p>}
      <details className="mt-1">
        <summary className="min-h-11 cursor-pointer py-3 font-medium text-ink">Read evidence &amp; sources</summary>
        <div className="pb-2 text-ink">
          <CitedAnswer text={`${check.summary}\n\n**Limits**\n${check.limitations}${check.citations.length ? `\n\n**Retrieved source links**\n${check.citations.map((id) => `[${id}]`).join(" ")}` : "\n\nNo citable sources were returned."}`} allowed={new Set(check.citations)} />
        </div>
      </details>
    </div>
  );
}
