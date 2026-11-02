/**
 * Ready-made MCP servers, medical and nutrition only. Each was checked on npm and
 * GitHub (2026-10-28): open-source licence, public repo, maintained. Versions are
 * pinned so an update can't change what runs without a deliberate bump here.
 */

export type McpCategory = "Literature" | "Clinical trials" | "Medicines" | "Genes and variants" | "Medical terms" | "Nutrition";

export interface McpEnvVar {
  name: string;
  label: string;
  required: boolean;
  /** Kept with the secrets, never sent to the page. */
  secret: boolean;
  help: string;
}

export interface McpPreset {
  id: string;
  name: string;
  description: string;
  category: McpCategory;
  /** npm package and pinned version, run with npx. */
  package: string;
  version: string;
  license: string;
  repo: string;
  env: McpEnvVar[];
  /** Fixed environment values, e.g. to switch off a server's own telemetry. */
  fixedEnv?: Record<string, string>;
  /** Purpose-level disclosure, not a verified or enforced network-host allowlist. */
  sends: string;
}

export const MCP_PRESETS: readonly McpPreset[] = [
  {
    id: "pubmed",
    name: "PubMed and Europe PMC",
    description: "Search PubMed and Europe PMC, read abstracts and open full text, follow citations, look up MeSH terms.",
    category: "Literature",
    package: "@cyanheads/pubmed-mcp-server",
    version: "2.11.1",
    license: "Apache-2.0",
    repo: "https://github.com/cyanheads/pubmed-mcp-server",
    env: [{ name: "NCBI_API_KEY", label: "NCBI API key (optional)", required: false, secret: true, help: "Raises the limit from 3 to 10 requests a second. Free from your NCBI account." }],
    sends: "Search terms and study identifiers to NCBI, Europe PMC, NIH iCite and OpenAlex. Optional full-text lookup can contact Unpaywall and article publishers or repositories.",
  },
  {
    id: "clinicaltrials",
    name: "ClinicalTrials.gov",
    description: "Search 600,000+ registered studies, read full records and posted results, and find recruiting trials.",
    category: "Clinical trials",
    package: "clinicaltrialsgov-mcp-server",
    version: "2.10.2",
    license: "Apache-2.0",
    repo: "https://github.com/cyanheads/clinicaltrialsgov-mcp-server",
    env: [],
    sends: "Search words (and, for trial matching, the age, sex and country you give it) to ClinicalTrials.gov.",
  },
  {
    id: "openfda",
    name: "openFDA",
    description: "US drug labels (interactions, warnings), adverse event reports, and drug and food recalls.",
    category: "Medicines",
    package: "@cyanheads/openfda-mcp-server",
    version: "0.9.1",
    license: "Apache-2.0",
    repo: "https://github.com/cyanheads/openfda-mcp-server",
    env: [{ name: "OPENFDA_API_KEY", label: "openFDA API key (optional)", required: false, secret: true, help: "Raises the daily request limit. Free from open.fda.gov." }],
    sends: "Search words to the US FDA's open data service.",
  },
  {
    id: "biomcp",
    name: "BioMCP",
    description: "Genes, variants, drugs and their targets, trials and literature across many biomedical databases.",
    category: "Genes and variants",
    package: "biomcp",
    version: "1.6.0",
    license: "Apache-2.0",
    repo: "https://github.com/yeyuan98/biomcp-ts",
    env: [],
    sends: "Tool inputs to multiple biomedical services, including literature, genes, variants, drugs, trials and patent databases. Some tools also download linked files; destinations depend on the tool and configuration.",
  },
  {
    id: "terminologies",
    name: "Medical terminologies",
    description: "Look up and translate codes: ICD-11, LOINC, RxNorm, MeSH, ATC.",
    category: "Medical terms",
    package: "medical-terminologies-mcp",
    version: "2.4.0",
    license: "MIT",
    repo: "https://github.com/SidneyBissoli/medical-terminologies-mcp",
    env: [
      { name: "WHO_CLIENT_ID", label: "WHO ICD API client ID (for ICD-11)", required: false, secret: false, help: "Only the ICD-11 tools need it. Free from icd.who.int/icdapi." },
      { name: "WHO_CLIENT_SECRET", label: "WHO ICD API client secret", required: false, secret: true, help: "Goes with the client ID." },
    ],
    sends: "Terms and codes to WHO ICD-11 and NLM terminology services, including Clinical Tables, RxNav and MeSH. Dictionary licences remain separate from the server's MIT licence.",
  },
  {
    id: "nutrition",
    name: "Food and nutrition lookup",
    description: "Search foods and their nutrients beyond the app's own food table.",
    category: "Nutrition",
    package: "wellness-nourish",
    version: "0.8.3",
    license: "MIT",
    repo: "https://github.com/davidmosiah/wellness-nourish",
    env: [],
    sends: "Food names, search terms or barcodes to USDA FoodData Central and Open Food Facts. Local food tables and upstream databases have separate reuse terms.",
  },
];

export const mcpPreset = (id: string): McpPreset | undefined => MCP_PRESETS.find((p) => p.id === id);

/** npx arguments for a preset, pinned to its version. */
export function presetArgs(p: Pick<McpPreset, "package" | "version">): string[] {
  return ["-y", `${p.package}@${p.version}`];
}

/** Tool names from several servers, kept apart and safe for every provider ("pubmed__search"). */
export function toolName(serverId: string, tool: string): string {
  return `${serverId}__${tool}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}
