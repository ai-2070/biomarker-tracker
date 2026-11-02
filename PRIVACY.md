# Privacy and network disclosure

Checked: **2026-11-02**. This describes the implementation, configured defaults and a bounded synthetic-data network smoke—not an exhaustive egress audit or a promise about third-party retention. See [DATA-LICENSES.md](DATA-LICENSES.md) for reuse rights and [MEDICAL-DISCLOSURE.md](MEDICAL-DISCLOSURE.md) for purpose and risk-feature limits. Settings → About links to these Markdown files on GitHub.

## What stays local

- Profiles, measurements, habits, protocols, meals, settings, saved evidence checks and imported report files are stored on this computer: in profile folders with the local server, or IndexedDB in browser-only use. There is no app account, cloud database, analytics or app telemetry service.
- The browser working copy synchronises to the selected local profile folder. Backups, doctor reports and shared protocol files leave only through the export/share action the person chooses. The receiving application/location is outside this app’s control.
- PDF extraction, OCR and device-export parsing run on this computer. OCR engines/languages ship locally rather than loading from a CDN. Recognised lab-report text becomes a local review card, not an AI attachment.
- API keys are stored by the local server, not returned to the page or included in profile backups. Local storage is not a promise of encryption or protection from other software/users with access to the computer.
- Opening an ordinary tracking page does not ask an AI model a question. Saved claim checks can trigger at-most-daily public PubMed newer-record metadata queries, but not automatic AI reassessment.

**Local storage does not mean personal chat never sends health information.** When you ask personal Brain, the chosen model can receive conversation text, relevant health-tool results and calculated summaries: measurements, habits, medicines, conditions, protocols, meals and other permitted profile facts. The server strips the profile name/private profile notes and turns birth month into age before supplying profile context to the model. Free text you type can still identify you; this is not a general-purpose de-identification guarantee.

Non-lab document attachments can send text with the question. The app replaces the configured profile name in that attachment text and shortens it to fit; it does not prove that every name/identifier was removed. A photo is sent only after its explicit “Send the photo itself” choice, only to supported API/local models, after browser resizing/JPEG re-encoding that removes EXIF location metadata. Agent programs are not accepted for photo sending.

Research-only Brain excludes profile, results, prior personal conversation, attachments and photos. Astaxanthin claim evidence requests contain only public supplement/claim/topic fields. The configured model and enabled research tools still handle that public research request.

## Research sources, switches and defaults

The footer’s **see research sources in Settings** link goes directly to `#/settings?tab=mcp`, the tab containing the on/off controls.

- On the local server’s first initialisation, all six ready-made MCP presets are added once. Each is switched on if `npx` is available and it has no required secret. All six current presets have no required secret, so they start **on when npx is available**; WHO credentials are optional and only needed for some terminology tools.
- Without npx they start off. Existing settings, disabled choices and removed sources are preserved rather than re-seeded every launch.
- Switched-on servers are warmed in the background. First use/start can download programs and dependencies before any question. Turning a source off removes its availability; it is not a firewall rule for other programs.
- These switches govern **extra MCP tools**, not the built-in Europe PMC/PubMed study-search clients or saved-check newer-record metadata signals. A local AI model does not make external research local.
- The default model choice, until a choice is saved, is Claude Code with `opus`. No AI question is sent just because that is the default. It must be installed/signed in and the person must ask or explicitly run a check.
- MCP child processes are not OS-sandboxed or constrained by the page’s Content Security Policy. They receive a minimal environment plus their configured values/secrets. The app has no enforced per-source network-host allowlist. Arbitrary/custom programs, changed settings, redirects, linked files and dependencies can add destinations.

Implementation: `server/mcp.ts` (`ensureDefaultServers`, `warmUp`, `serverEnv`, `researchTools`), `src/core/mcpPresets.ts`, `src/app/components/settings/McpSettings.tsx`.

## Rule for research queries

**The assistant must never put the person’s lab values, medications or other personal details into research queries or MCP tool inputs. It must use neutral public topics instead.** Do not turn a profile’s medicine list, a measured value, a date of birth or a clinical narrative into a search string.

This rule is explicit in both personal and research-only system prompts in `server/assistant.ts`. It is a model instruction, **not a demonstrated guarantee that arbitrary third-party tool schemas are de-identified**. The generic MCP bridge forwards selected tool inputs and does not perform a comprehensive personal-data redaction/allowlist check. Do not describe it as technically impossible to send personal information. Direct source tools can accept more than search words; the app must not claim all downstream payloads are limited to words or that every source receives identical fields.

## Observed outbound MCP traffic

Actual isolated smoke completed **2026-11-02 00:01 UTC**, starting 2026-11-01 23:59 UTC. All six pinned packages completed one read-only public synthetic query. No profile, lab value, medication, credential or AI provider was used. Evidence: [minimised hostname-only receipt](tools/privacy/network-proof.json).

| Source and exact package | Actual exercised query | Query host observed |
|---|---|---|
| PubMed / Europe PMC: `@cyanheads/pubmed-mcp-server@2.11.1` | `pubmed_search_articles`, public topic `walking`, one result | `eutils.ncbi.nlm.nih.gov` |
| ClinicalTrials.gov: `clinicaltrialsgov-mcp-server@2.10.2` | `clinicaltrials_get_study_count`, `walking` | `clinicaltrials.gov` |
| openFDA: `@cyanheads/openfda-mcp-server@0.9.1` | `openfda_search_recalls`, food category, `product_description:apple` | `api.fda.gov` |
| BioMCP: `biomcp@1.6.0` | `article_search`, `walking`, explicitly restricted to Europe PMC | `www.ebi.ac.uk` |
| Terminology: `medical-terminologies-mcp@2.4.0` | `mesh_search`, `walking` | `id.nlm.nih.gov` |
| Food lookup: `wellness-nourish@0.8.3` | `nourish_search_food`, `apple`, default USDA provider | `api.nal.usda.gov` |

Method: exact package manifests; fresh per-package HOME/config/cache/cwd; explicit credential-free environment; Bun 1.4.4 installation with lifecycle scripts disabled; Node v24.19.0 execution. MCP initialise → tools/list → tools/call used the discovered schemas. A Node preload captured `undici:request:create`, Node HTTP(S) requests and TLS hostnames. Only hostname/timestamp/method observations are retained in the checked-in receipt; no request headers, keys, personal paths, abstracts or patient data are committed.

All owned process trees were terminated and disposable installations/scripts removed. openFDA initially required an empty `skills/` directory in its disposable working directory before successful startup. The three cyanheads programs reported handshake version `0.13.18` although installed package manifests matched their requested release versions; both observations are preserved.

### What this test does not establish

- **This was not a browser Network-tab capture.** A browser sees requests to the local server but not the server’s or child process’s independent outbound connections. The built-in browser research clients can contact `www.ebi.ac.uk` and `eutils.ncbi.nlm.nih.gov`; those browser-client paths were inspected statically, not exercised by the MCP smoke.
- Only one tool per source was exercised, not every tool/default federation/full-text path. BioMCP’s broad default federation was not used. A successful query is not an exclusive-host guarantee.
- No distinct redirect host was observed; unexercised redirects/downloads remain possible. Native libraries/processes, raw sockets and other runtimes can bypass the Node instrumentation. This was not OS packet/firewall capture.
- No startup/discovery hostname was recorded in this bounded trace. That is not proof of no startup egress.
- **Installation hosts were not observed.** Bun’s native downloader bypassed the preload. `registry.npmjs.org` was configured, not witnessed. Production npx/dependency installation, lifecycle scripts, binary assets and alternate registry settings were not tested.
- Isolated `CI=true`, `DO_NOT_TRACK=1`, empty configs and absent keys differ from some production deployments. No claims about provider retention or every dependency follow from this test.

## Additional destinations found in exact-release source

The following are **static request destinations/capabilities**, not additional runtime observations. They are not an enforced allowlist. Returned document links alone were not counted as fetched hosts.

### PubMed / Europe PMC preset

[Published release](https://unpkg.com/@cyanheads/pubmed-mcp-server@2.11.1/package.json): `eutils.ncbi.nlm.nih.gov`, `pmc.ncbi.nlm.nih.gov`, `www.ebi.ac.uk`, `icite.od.nih.gov`, `api.openalex.org`; optional Unpaywall lookup at `api.unpaywall.org`. The [Unpaywall service](https://unpkg.com/@cyanheads/pubmed-mcp-server@2.11.1/dist/services/unpaywall/unpaywall-service.js) can fetch response-selected publisher/repository URLs and follow redirects. Therefore “only PubMed and Europe PMC” is incomplete.

### ClinicalTrials.gov preset

[Configuration](https://unpkg.com/clinicaltrialsgov-mcp-server@2.10.2/dist/config/server-config.js) defaults to `clinicaltrials.gov`; `CT_API_BASE_URL` can replace the origin. Native fetch can follow redirects. The package constructs `cdn.clinicaltrials.gov` document links, but inspected code returns them rather than demonstrating PDF downloads; that CDN was **not** runtime-observed here.

### openFDA preset

[Configuration](https://unpkg.com/@cyanheads/openfda-mcp-server@0.9.1/dist/config/server-config.js) defaults to `api.fda.gov`. `OPENFDA_BASE_URL` and `OPENFDA_MIRROR_BASE_URL` are overrides. Optional bulk-mirror code follows manifest-provided `partition.file` URLs. Mirror harvesting is off by default and is a separate explicit operation; HTTP-only scheduled refresh is not the app’s ordinary stdio path. Neither overrides nor bulk-download destinations were exercised.

The three cyanheads packages document optional OpenTelemetry, default off in inspected framework 0.13.18, with configurable exporter destinations. Their dependency is a version range; the exact production dependency graph/configuration is not frozen by top-level package pins. This is not a claim that every possible telemetry path was audited or disabled by an OS boundary.

### BioMCP preset

The [registry at the npm metadata’s exact source commit](https://github.com/yeyuan98/biomcp-ts/blob/6195da8bd5f231c4faee3316930709bae42ee777/src/connections/registry.ts) contains:

- Genomics: `mygene.info`, `myvariant.info`, `gtexportal.org`, `rest.ensembl.org`, `version-12-0.string-db.org`.
- Proteins/pathways: `rest.uniprot.org`, `reactome.org`.
- Drugs/diseases: `mychem.info`, `api.fda.gov`, `mydisease.info`, `api-v3.monarchinitiative.org`, `www.oncokb.org`, `api.disgenet.com`.
- Literature/NCBI: `eutils.ncbi.nlm.nih.gov`, `www.ncbi.nlm.nih.gov`, `pmc.ncbi.nlm.nih.gov`, `www.ebi.ac.uk`, `api.semanticscholar.org`, `api.crossref.org`, `api.opencitations.net`, `api.biorxiv.org`, `export.arxiv.org`, `api.openalex.org`.
- Trials/funding: `clinicaltrials.gov`, `api.reporter.nih.gov`.
- Structures: `data.rcsb.org`, `search.rcsb.org`, `files.rcsb.org`.
- Patents: `patents.google.com`, `api.uspto.gov`.
- GraphQL: `gnomad.broadinstitute.org`, `civicdb.org`, `dgidb.org`, `api.platform.opentargets.org`.

Other exact-commit callsites contact `www.proteinatlas.org`, `extranet.who.int`, `ops.epo.org`, `ppubs.uspto.gov`, `archive.org` and `web.archive.org`. GEO files can use response-selected NCBI-family hosts; preprint full text can use bioRxiv/medRxiv subdomains and redirects. Optional analysis assets use `biowasm.com`, `api.github.com`, release download URLs or configured mirrors. Optional proxies and a configured MySQL host add further endpoints. These capabilities were not exercised by the bounded article smoke. Readable source was tied to the registry gitHead; compiled-source equivalence and all native/transitive dependencies were not independently established.

### Terminology preset

[Published executable](https://unpkg.com/medical-terminologies-mcp@2.4.0/dist/index.js): `id.who.int`, `icdaccessmanagement.who.int`, `clinicaltables.nlm.nih.gov`, `rxnav.nlm.nih.gov`, `id.nlm.nih.gov`. Some clients process returned references/absolute URLs; dependency and redirect behaviour is not a strict origin allowlist. Bundled ICD mappings/Brazilian CID-10 do not imply requests to their attribution sites. Hosted-service telemetry descriptions are not evidence that the app’s npm stdio program sends data to that hosted service.

### Food lookup preset

[Published constants](https://unpkg.com/wellness-nourish@0.8.3/dist/constants.js) name `api.nal.usda.gov` and `world.openfoodfacts.org`. USDA can use a demo key, so absence of a personal key does not mean no network use. Open Food Facts can be disabled; local/fixture/TACO paths differ. Native fetch redirects are not restricted to the initial origins. Only the USDA search was exercised here.

### Custom sources

No fixed host list can be stated for a user-added command. Inspect its program, configuration, dependencies and actual traffic before relying on a destination or retention claim.

## Which AI provider receives what

Personal Brain sends the selected provider or agent the question/conversation plus permitted health context/tool results as needed. Research-only conversations and claim checks use the public question/claim instead. Enabled skills and retrieved research can also be included. The page calls the local server; it does not call model APIs directly.

| Choice | Model-request destination | Data and retention boundary |
|---|---|---|
| Anthropic API | `api.anthropic.com` | Conversation/context to Anthropic; user must confirm appropriate EU/US zero-retention account arrangements. The app cannot prove the provider’s actual retention. |
| OpenAI API | `api.openai.com` | Conversation/context to OpenAI; Chat Completions requests set `store: false`. This does not itself establish every retention/deletion promise; zero-retention account confirmation remains required. |
| Mistral API | `api.mistral.ai` | Conversation/context to Mistral; user-confirmed region/zero-retention account setup required. |
| OpenRouter | Default `openrouter.ai`, then the selected upstream model endpoint | Conversation/context traverses OpenRouter and its routed provider. Every model request sets `provider.zdr=true` and `data_collection="deny"`. The upstream host is routing/configuration-dependent, not a fixed app-controlled list. Public model/ZDR lists are fetched separately without a health snapshot. |
| OpenAI-compatible cloud endpoint | User-configured HTTPS host | Conversation/context goes to that endpoint; region and retention depend on the configured provider/account. |
| Ollama / LM Studio | Configured loopback endpoint, defaults localhost:11434 / localhost:1234 | Model requests stay on this computer when using the validated local endpoint. Enabled external research still makes network requests. Local-model download/update behaviour is not audited here. |
| Claude Code / Codex / Hermes / OpenClaw | Installed program’s login/profile/agent configuration | **Depends on your login.** These are not necessarily local models. Conversation and permitted tool context—or OpenClaw’s data summary—go to that program and its configured provider(s). Destinations and retention are not established by API-provider flags in this app. |

Provider endpoint/control evidence: `server/models.ts`, `server/openrouter.ts`, `src/core/aiProviders.ts`, `server/agents.ts`. No actual AI-provider request was made or traffic/retention claim verified during this audit.

## Other traffic and user actions

- Developer-only CoFID/life-table/NHANES/model-building tools fetch public reference data. They do not send app profiles; the shipped app does not make those developer data-download calls.
- Explicitly opening external papers, licence/source pages, installation/sign-in documentation or GitHub visits those services, whose privacy/cookie policies apply. They are not app telemetry endpoints.
- No browser CSP statement should be read as constraining server-side MCP programs, installed agent programs, provider routing or custom research tools.

## Updating this disclosure

When a pinned program, dependency/configuration, provider, endpoint or data flow changes, repeat a bounded synthetic-data observation and update static callsite evidence separately. Record exact versions, date, tool arguments, capture method, failures and blind spots. Never turn a one-query host list into an exclusive-host guarantee, never label installation configuration as observed traffic, and never describe a system-prompt privacy instruction as an enforced redaction boundary.
