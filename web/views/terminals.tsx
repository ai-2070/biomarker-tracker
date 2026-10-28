// Live terminals: PowerShell, Claude Code, Hermes, Orca, or any Claude Code / Hermes agent.
// The page is React; each terminal is xterm, talking to the server over a WebSocket.
import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { GET, POST, DEL, attempt, navigate } from '../core.ts';
import { openSocket } from '../client/connection.ts';
import { reactPage, useAppState } from '../ui/react.tsx';
import type { Terminal as TerminalInfo } from '../../shared/types.ts';

/** What POST /api/terminals takes. */
interface OpenTerminal {
  kind: 'shell' | 'command' | 'agent';
  command?: string;
  args?: string[];
  title?: string;
  agentId?: string;
}

const THEME = { background: '#070807', foreground: '#e6e8e0', cursor: '#c4ff3d', selectionBackground: '#c4ff3d55', green: '#c4ff3d', brightGreen: '#d4ff6e', yellow: '#f0b04a', cyan: '#a9d3e2' };

async function open(body: OpenTerminal): Promise<void> {
  const t = await attempt(() => POST<TerminalInfo>('/terminals', body));
  if (t) navigate(`#/terminals/${t.id}`);
}

/** Which terminal to show: the one asked for if it exists, the launcher for "new", else the first one. */
export function pickTerminal(asked: string | undefined, list: readonly Pick<TerminalInfo, 'id'>[]): string | null {
  if (asked === 'new') return null;
  if (asked && list.some((t) => t.id === asked)) return asked;
  return list[0]?.id || null;
}

// a tab; the open one is lighter, with a line in the accent on top
const TAB = 'flex items-center gap-2 py-2.25 px-3.5 border-r border-line cursor-pointer font-mono text-[12px] leading-[normal] font-normal whitespace-nowrap text-dim';
const TAB_ON = 'flex items-center gap-2 py-2.25 px-3.5 border-r border-line cursor-pointer font-mono text-[12px] leading-[normal] font-normal whitespace-nowrap text-ink bg-bg shadow-[inset_0_2px_0_var(--color-accent)]';
/** Where a terminal (or the launcher) sits, under the tabs. */
const HOST = 'flex-1 min-h-0 py-2 px-2.5 bg-[#070807]';

function TerminalsPage({ asked }: { asked?: string }) {
  const data = useAppState();
  // the app state as it was when the page opened: it may not have a terminal just opened yet
  const [opened] = useState(() => data);
  const [first, setFirst] = useState<TerminalInfo[] | null>(null);
  useEffect(() => void GET<TerminalInfo[]>('/terminals').then(setFirst).catch(() => setFirst([])), []);
  if (!first) return null;
  // the live list once the app state has it (terminals opening and closing elsewhere)
  const list = data?.terminals || first;
  // which one shows: by the live list once the app state has changed since the page opened (a
  // terminal closed here goes), by the first list until then
  const live = data !== opened && data?.terminals ? data.terminals : null;
  const current = pickTerminal(asked, live || (first.length ? first : list));
  const close = async (id: string) => {
    await attempt(() => DEL(`/terminals/${id}`));
    if (current === id) navigate('#/terminals');
  };
  return (
    <div className="flex flex-col h-[calc(100vh-61px)]">
      <nav className="flex gap-0 border-b border-line bg-panel overflow-x-auto flex-none" aria-label="Terminals">
        {list.map((t) => (
          <div key={t.id} className={t.id === current ? TAB_ON : TAB}>
            <a className="flex items-center gap-2 text-inherit" href={`#/terminals/${t.id}`} aria-current={t.id === current ? 'page' : undefined}>
              <span className={`dot${t.exited ? '' : ' on'}`} />
              {t.title}
            </a>
            <button className="text-faint cursor-pointer px-0.5 hover:text-red" title="Close" aria-label={`Close ${t.title}`} onClick={() => void close(t.id)}>
              ✕
            </button>
          </div>
        ))}
        <div className={!current ? TAB_ON : TAB}>
          <a className="flex items-center gap-2 text-inherit" href="#/terminals/new" aria-current={!current ? 'page' : undefined}>+ New</a>
        </div>
      </nav>
      {current ? <XTerm key={current} id={current} /> : <Launcher />}
    </div>
  );
}

function Launcher() {
  const data = useAppState();
  const agents = (data?.agents || []).filter((a) => a.engine !== 'openai');
  const [agentId, setAgentId] = useState(agents[0]?.id || '');
  if (!data) return null;
  const e = data.engines;
  const card = (title: string, about: string, body: OpenTerminal) => (
    <button key={title} type="button" className="card clickable term-card text-left [font:inherit] text-inherit w-full" onClick={() => void open(body)}>
      <div className="card-title">{title}</div>
      <div className="card-sub">{about}</div>
    </button>
  );
  return (
    <div className={`${HOST} overflow-y-auto`}>
      <div className="py-5 px-4.5 max-w-190">
        <p className="lede">Open a real terminal right here. Everything keeps running when you switch pages; come back any time.</p>
        <div className="cards">
          {card('PowerShell', 'A normal shell in your user folder.', { kind: 'shell' })}
          {e['claude-code'].installed ? card('Claude Code', 'Plain interactive Claude Code session.', { kind: 'command', command: 'claude', title: 'Claude Code' }) : null}
          {e.hermes.installed ? card('Hermes', 'Interactive Hermes (default profile).', { kind: 'command', command: 'hermes', title: 'Hermes' }) : null}
          {e.pi?.installed ? card('pi', 'Interactive pi coding agent.', { kind: 'command', command: 'pi', title: 'pi' }) : null}
          {e.omp?.installed ? card('oh-my-pi', 'Interactive oh-my-pi (omp).', { kind: 'command', command: 'omp', title: 'oh-my-pi' }) : null}
          {e.openclaw?.installed ? card('OpenClaw', "OpenClaw's chat screen (through its Gateway).", { kind: 'command', command: 'openclaw', args: ['tui'], title: 'OpenClaw' }) : null}
          {card('Orca', 'Orca CLI: status, worktrees, agent sessions.', { kind: 'command', command: 'orca', args: ['status'], title: 'Orca' })}
        </div>
        {agents.length ? (
          <div className="panel mt-7">
            <div className="panel-head">
              <h2>Open an agent in a terminal</h2>
            </div>
            <p className="hint">Runs the agent interactively with its instructions, model, tools and MCP servers. Great for long hands-on sessions.</p>
            <div className="flex flex-wrap items-center gap-2.5 mt-3.5">
              <div className="w-75">
                <select aria-label="Agent" value={agentId} onChange={(ev) => setAgentId(ev.target.value)}>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>{`${a.emoji || ''} ${a.name}`}</option>
                  ))}
                </select>
              </div>
              <button className="btn" onClick={() => void open({ kind: 'agent', agentId })}>Open</button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** One live terminal: xterm in the page, its keystrokes to the server and its output back. */
function XTerm({ id }: { id: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current!;
    const term = new Terminal({ fontFamily: "'JetBrains Mono', Consolas, monospace", fontSize: 13, cursorBlink: true, allowProposedApi: true, scrollback: 10000, theme: THEME });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    const ws = openSocket('/ws/term', { id });
    const sendSize = () => {
      try {
        fit.fit();
      } catch {
        return;
      }
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    };
    ws.onopen = () => {
      sendSize();
      term.focus();
    };
    ws.onmessage = (m: MessageEvent<string | ArrayBuffer>) => term.write(typeof m.data === 'string' ? m.data : new Uint8Array(m.data));
    ws.onclose = (e) => {
      if (e.code === 4004) term.write('\r\n\x1b[90m[this terminal is gone]\x1b[0m\r\n');
    };
    const input = term.onData((d) => ws.readyState === 1 && ws.send(JSON.stringify({ type: 'input', data: d })));
    const ro = new ResizeObserver(() => sendSize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      input.dispose();
      ws.close();
      term.dispose();
    };
  }, [id]);
  return <div className={`${HOST} [&_.xterm]:h-full`} ref={host} />;
}

export const flush = true;
export const title = () => 'Terminals';
export const { render, unmount } = reactPage((params) => <TerminalsPage asked={params[0]} />);
