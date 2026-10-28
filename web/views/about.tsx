// Settings > About: which Blacksite this is, where it lives on GitHub (with a star button), and this PC's
// address and data folder.
import { useEffect, useState } from 'react';
import { GET } from '../core.ts';
import { logo } from '../icons.ts';
import { DomNode, Icon, useAppState } from '../ui/react.tsx';
import { REPO, repoLink } from '../../shared/about.ts';
import type { AboutInfo } from '../../shared/types.ts';
import { AI_VERSION } from './settings.tsx';

/** The Blacksite mark (public/icon.svg): a lime wedge. */
export const BrandMark = ({ size = 48 }: { size?: number }) => (
  <svg className="flex-none rounded-box border border-line bg-bg p-2 text-accent" viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
    <path d="M14 50 L50 14 L50 50 Z" fill="currentColor" />
  </svg>
);

/** "Star on GitHub", with the count when GitHub gave one. */
export function StarButton({ stars, small = false }: { stars: number | null; small?: boolean }) {
  return (
    <a className={`btn${small ? ' tiny' : ' small'} star-btn`} href={REPO.url} target="_blank" rel="noopener" title={`Star ${REPO.slug} on GitHub`}>
      <Icon name="star" size={small ? 12 : 14} />
      <span>{small ? 'Star' : 'Star on GitHub'}</span>
      {stars != null ? <span className="ml-0.5 border-l border-[color-mix(in_srgb,currentColor_35%,transparent)] pl-2 tabular-nums">{stars.toLocaleString()}</span> : null}
    </a>
  );
}

export function AboutTab() {
  const data = useAppState();
  const [about, setAbout] = useState<AboutInfo | null>(null);
  useEffect(() => {
    let live = true;
    GET<AboutInfo>('/about?stars=1').then(
      (a) => live && setAbout(a),
      () => {},
    );
    return () => void (live = false);
  }, []);
  const version = about ? `v${about.version}` : '…';
  return (
    <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] items-start gap-4 max-lg:grid-cols-1">
      <div className="flex flex-col gap-4.5">
        <div className="panel">
          <div className="flex items-center gap-4">
            <BrandMark size={52} />
            <div className="about-title flex flex-wrap items-baseline gap-2.5">
              <h2 className="m-0 font-sans text-[26px] leading-[1.1] font-bold tracking-[-0.01em]">{REPO.name}</h2>
              <span className={`${AI_VERSION} text-[13px]`}>{version}</span>
            </div>
          </div>
          <p className="mt-3.5 mb-0 max-w-[62ch] text-[14px] leading-[1.55] text-dim">Run AI agents and teams from one local workspace. A live 3D map, team chats, Claude Code, Codex and local models, MCP tools, an approval Outbox and Artifacts. No account, runs on your computer.</p>
          <div className="mt-4 flex flex-wrap gap-2 [&_.btn]:gap-1.75">
            <StarButton stars={about?.stars ?? null} />
            <a className="btn ghost small font-mono tracking-normal normal-case" href={REPO.url} target="_blank" rel="noopener">
              <DomNode as="span" className="inline-flex" make={() => logo('github', 14, '#e6e8e0')} deps={[]} />
              <span>{REPO.slug}</span>
            </a>
          </div>
          <div className="kv mt-7">
            <span>Version</span>
            <span className="font-mono">{version}</span>
            <span>GitHub</span>
            <span>
              <a className="font-mono wrap-anywhere" href={REPO.url} target="_blank" rel="noopener">
                {REPO.url.replace(/^https:\/\//, '')}
              </a>
            </span>
            <span>Licence</span>
            <span>{about?.license ? about.license.replace(/ OR /g, ' or ') : '…'}</span>
            <span>Help</span>
            <span>
              <a href={repoLink('issues')} target="_blank" rel="noopener">Report a problem</a> · <a href={repoLink('releases')} target="_blank" rel="noopener">What's new</a>
            </span>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-4.5">
        {data ? (
          <div className="panel">
            <div className="panel-head">
              <h2>This PC</h2>
            </div>
            <div className="kv">
              <span>Address</span>
              <span className="font-mono">{`http://localhost:${data.port}`}</span>
              <span>Login</span>
              <span>None. Only this PC can open it (it listens on 127.0.0.1).</span>
              <span>Data</span>
              <span className="font-mono wrap-anywhere">{data.dataDir}</span>
            </div>
            <p className="hint mt-3.5">Keys and account tokens are stored in that data folder on this PC and never sent to the browser.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
