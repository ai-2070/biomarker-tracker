import { buttonStyles, Card, cx } from "../ui";

export const REPO_URL = "https://github.com/ai-2070/biomarker-tracker";

function StarIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor">
      <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor">
      <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
    </svg>
  );
}

/** Name, version, source code. */
export function AboutSettings() {
  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-col gap-5 p-5 sm:p-8">
        <div className="flex items-center gap-4">
          <img src="./favicon.svg" alt="" width={56} height={56} className="shrink-0" />
          <div>
            <h2 className="font-serif text-3xl font-normal tracking-tight sm:text-4xl">Biomarker Tracker</h2>
            <p className="font-mono text-sm text-ink-2">
              Version <span className="text-ink">{__APP_VERSION__}</span>
            </p>
          </div>
        </div>
        <p className="text-ink-2">
          A free, open-source app to track blood tests over the years, understand them in plain language, see biological age, and explore what research
          says about each marker. Everything is kept on this computer.
        </p>
        <div className="flex flex-wrap gap-2">
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className={cx(buttonStyles.primary, "no-underline")}>
            <StarIcon />
            Star on GitHub
          </a>
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className={cx(buttonStyles.secondary, "no-underline")}>
            <GitHubIcon />
            Source code
          </a>
        </div>
        <p className="font-mono text-xs break-all text-ink-2">{REPO_URL.replace("https://", "")}</p>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="font-serif text-2xl font-normal">Good to know</h2>
        <dl className="grid gap-x-4 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="font-medium">Licence</dt>
          <dd className="text-ink-2">MIT. Free to use, change and share.</dd>
          <dt className="font-medium">Your data</dt>
          <dd className="text-ink-2">Kept in profile folders on this computer. No account, no tracking, no analytics.</dd>
          <dt className="font-medium">Data sources</dt>
          <dd className="text-ink-2">
            Research from Europe PMC and PubMed. Food values from McCance and Widdowson's CoFID 2021 (Open Government Licence). Test-to-test variation from
            the EFLM Biological Variation Database. Biological age: PhenoAge (Levine et al., 2018).
          </dd>
          <dt className="font-medium">Not medical advice</dt>
          <dd className="text-ink-2">Not a medical device. It explains; it doesn't diagnose or prescribe. Talk to your doctor about your results.</dd>
        </dl>
      </Card>
    </div>
  );
}
