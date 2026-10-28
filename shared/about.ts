// Where Blacksite lives on GitHub. The sidebar, Settings > About and the server use these.
export const REPO = {
  name: 'Blacksite',
  slug: 'ai-2070/blacksite',
  url: 'https://github.com/ai-2070/blacksite',
} as const;

export const repoLink = (sub: '' | 'issues' | 'releases' = ''): string => (sub ? `${REPO.url}/${sub}` : REPO.url);
