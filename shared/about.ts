// Where Biomarker Tracker lives on GitHub. The sidebar, Settings > About and the server use these.
export const REPO = {
  name: 'Biomarker Tracker',
  slug: 'ai-2070/biomarker-tracker',
  url: 'https://github.com/ai-2070/biomarker-tracker',
} as const;

export const repoLink = (sub: '' | 'issues' | 'releases' = ''): string => (sub ? `${REPO.url}/${sub}` : REPO.url);
