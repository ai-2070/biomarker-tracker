import { writeFileSync } from "node:fs";
import inventory from "../apps/web/src/app/dataLicenses.json";
import { MCP_PRESETS } from "@bt/shared/core/mcpPresets";

const cell = (value: string) => value.replaceAll("|", "\\|").replaceAll("\n", " ");
const lines = [
  "# Data licences and redistribution inventory", "",
  `Inventory checked: ${inventory.checkedOn}. Generated from apps/web/src/app/dataLicenses.json with bun tools/data-licenses.ts. Settings → About links to the GitHub copy of this document.`, "",
  "**This is not redistribution clearance or legal advice.** A verified-on date means published terms were checked, not that permission was obtained. Missing, restricted, noncommercial or no-derivatives terms must not be relabelled MIT or treated as cleared. Free access, attribution and public hosting do not establish redistribution or adaptation rights.", "",
  "**Release concerns:** EFLM expressly restricts redistribution without written permission. CSEP/ACE and several clinical/fitness tables have restricted or unverified rights. Current ESC terms call for a formal software-use licence. No such permissions are established by this repository. These records are identified, not silently removed or declared safe.", "",
  "The project declares MIT in package.json for original contributions. Input data, articles, dictionary content, translations and external model/code rights remain separate. Each row identifies a bundled data/model family or a separately accessed upstream source; live services are not claimed to be fully bundled databases.", "",
];
for (const group of inventory.groups) {
  lines.push(`## ${group.title}`, "", group.notes, "", "| Dataset / model / source | Bundled use or location | Licence / published terms | Redistribution status | Verified on |", "|---|---|---|---|---|");
  for (const source of group.sources) {
    lines.push(`| [${cell(source.name)}](${source.source}) | ${cell(source.location)} | [${cell(source.licence)}](${source.terms}) | ${cell(source.redistribution)}${source.notes ? ` ${cell(source.notes)}` : ""} | ${source.verifiedOn ?? `Not verified (checked ${source.checkedOn})`} |`);
  }
  lines.push("");
}
lines.push("## Optional MCP software licences", "", "Package-declared licences checked against exact-release metadata. These do not license upstream data. Dependency graphs, native assets and custom programs need their own review.", "", "| Program | Exact package | Software licence | Verified on |", "|---|---|---|---|");
for (const p of MCP_PRESETS) lines.push(`| ${cell(p.name)} | [${p.package}@${p.version}](https://unpkg.com/${p.package}@${p.version}/package.json) | ${p.license} | ${inventory.checkedOn} |`);
lines.push("", "## Scope and maintenance", "", "All bundled knowledge families, reference-table families, country-table authorities and the aggregate mortality model are represented above. Per-publication terms and exact source citations remain in the guides. This is not a rights-clearance audit of every cited paper, every translation, every individual urgent/default boundary or every optional service’s entire database. Unverified rows deliberately say so.", "", "When source material, versions or terms change, update apps/web/src/app/dataLicenses.json with primary evidence and the actual verification date, then run bun tools/data-licenses.ts. Do not move an unknown/restricted row to permitted based only on free access or a software-package licence.", "");
writeFileSync(new URL("../DATA-LICENSES.md", import.meta.url), lines.join("\n"));
console.log(`Wrote DATA-LICENSES.md: ${inventory.groups.reduce((n, g) => n + g.sources.length, 0)} source records and ${MCP_PRESETS.length} MCP packages.`);
