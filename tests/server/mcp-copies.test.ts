// One service added more than once (several accounts: OOMOL Work and OOMOL Personal). Each copy has a label
// and a "use for" line; an agent or team may hold several, the team's copy wins during team work, and the
// agent and the approvals say which account is which.
import { describe, expect, it } from 'vitest';
import * as mcp from '../../server/mcp.ts';
import { mcpToolName } from '../../server/engines/openai.ts';
import type { McpServerConfig, McpServers } from '../../server/mcp.ts';

const http = (url: string, extra: Partial<McpServerConfig> = {}): McpServerConfig => ({ type: 'http', command: '', args: [], env: {}, url, headers: {}, description: '', enabled: true, ...extra });
const OOMOL = 'https://connector.oomol.com/v1/mcp';

describe('which service a server is', () => {
  it('a ready-made one by its name, its command or link, or the host of a service with a link per account', () => {
    expect(mcp.kindOf('oomol', http('https://elsewhere.example/mcp'))).toBe('oomol');
    expect(mcp.kindOf('oomol-work', http(OOMOL))).toBe('oomol');
    expect(mcp.kindOf('my-composio', http('https://mcp.composio.dev/session/abc123'))).toBe('composio');
    expect(mcp.kindOf('browser2', { ...http(''), type: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@latest'] })).toBe('playwright');
  });

  it('the one it was set to, or its own name when it is like no other', () => {
    expect(mcp.kindOf('gmail-home', http('https://gmail.example/mcp', { kind: 'gmail-work' }))).toBe('gmail-work');
    expect(mcp.kindOf('weather', http('https://weather.example/mcp'))).toBe('weather');
    expect(mcp.kindOf('ghost', undefined)).toBe('ghost');
  });

  it('shows a copy as "OOMOL: Work", and anything else by its name', () => {
    expect(mcp.serviceTitle('oomol')).toBe('OOMOL');
    expect(mcp.copyTitle('oomol-work', http(OOMOL, { label: 'Work' }))).toBe('OOMOL: Work');
    expect(mcp.copyTitle('oomol', http(OOMOL))).toBe('oomol');
  });
});

describe('adding another account of a ready-made server', () => {
  it('needs a label the second time, and keeps the first one as it was', () => {
    expect(mcp.addPreset('oomol').name).toBe('oomol');
    expect(() => mcp.addPreset('oomol')).toThrow(/added already.*label/);
    const made = mcp.addPreset('oomol', { label: 'Client A', useFor: 'everything for Client A' });
    expect(made.name).toBe('oomol-client-a');
    expect(mcp.listServers()['oomol-client-a']).toMatchObject({ url: OOMOL, label: 'Client A', kind: 'oomol', useFor: 'everything for Client A' });
    expect(mcp.listServers().oomol.label).toBeUndefined();
    // the same label again gets a number, a label with no letters it can use gets the service's name
    expect(mcp.addPreset('oomol', { label: 'Client A' }).name).toBe('oomol-client-a-2');
    expect(mcp.addPreset('oomol', { label: 'Ärger' }).name).toBe('oomol-rger');
    expect(mcp.addPreset('oomol', { label: '工作' }).name).toBe('oomol-2');
  });

  it('gives a second account of a browser sign-in service its own login', () => {
    expect(mcp.addPreset('sentry').server.env.MCP_REMOTE_CONFIG_DIR).toBeUndefined();
    const dir = mcp.addPreset('sentry', { label: 'Client' }).server.env.MCP_REMOTE_CONFIG_DIR;
    expect(dir).toMatch(/[\\/]\.mcp-auth[\\/]dashboard-sentry-client-[0-9a-f]{8}$/);
    // a key-based service has nothing to keep apart
    expect(mcp.listServers()['oomol-client-a'].env.MCP_REMOTE_CONFIG_DIR).toBeUndefined();
  });

  it('a renamed copy keeps its login, and a new copy given its old name gets one of its own', () => {
    const first = mcp.addPreset('sentry', { label: 'Work' }).server.env.MCP_REMOTE_CONFIG_DIR;
    expect(mcp.renameServer('sentry-work', 'sentry-archived')).toBe('sentry-archived');
    expect(mcp.listServers()['sentry-archived'].env.MCP_REMOTE_CONFIG_DIR).toBe(first);
    const again = mcp.addPreset('sentry', { label: 'Work' });
    expect(again.name).toBe('sentry-work');
    expect(again.server.env.MCP_REMOTE_CONFIG_DIR).toMatch(/dashboard-sentry-work-[0-9a-f]{8}$/);
    expect(again.server.env.MCP_REMOTE_CONFIG_DIR).not.toBe(first);
    // a copy made before keeps the folder it signed in with
    const old = { args: ['-y', 'mcp-remote', 'https://mcp.sentry.dev/mcp'], env: { MCP_REMOTE_CONFIG_DIR: '/home/x/.mcp-auth/dashboard-sentry-old' } };
    expect(mcp.withOwnLogin('sentry-old', old)).toBe(old);
  });

  it('lists every copy on the ready-made one, and stops suggesting it', () => {
    const p = mcp.presetAvailability().find((x) => x.name === 'oomol')!;
    expect(p.installed).toBe(true);
    expect(p.copies).toEqual(expect.arrayContaining(['oomol', 'oomol-client-a']));
    // a copy saved under any name counts as added
    expect(mcp.suggestPresets([], { 'my-context': { ...http(''), type: 'stdio', command: 'x', kind: 'context7' } }).map((s) => s.name)).not.toContain('context7');
  });

  it('changes only the label and "use for" of one already there, and they survive a rename', () => {
    mcp.describeCopy('oomol', { label: 'Personal', useFor: 'my own mail' });
    expect(mcp.listServers().oomol).toMatchObject({ url: OOMOL, label: 'Personal', useFor: 'my own mail' });
    mcp.describeCopy('oomol', { useFor: 'my own mail and calendar' });
    expect(mcp.listServers().oomol.label).toBe('Personal');
    expect(mcp.renameServer('oomol', 'oomol-personal')).toBe('oomol-personal');
    expect(mcp.listServers()['oomol-personal']).toMatchObject({ label: 'Personal', useFor: 'my own mail and calendar' });
    expect(mcp.kindOf('oomol-personal', mcp.listServers()['oomol-personal'])).toBe('oomol');
  });

  it("asks for Composio's own link and key", () => {
    const composio = mcp.PRESETS.find((p) => p.name === 'composio')!;
    expect(mcp.presetNeeds(composio)).toBe('needs its own link in the URL and a key in the x-api-key header');
  });
});

describe('agents with several accounts', () => {
  const servers: McpServers = {
    'oomol-work': http(OOMOL, { label: 'Work', kind: 'oomol', useFor: 'acme.com mail and calendar' }),
    'oomol-personal': http(OOMOL, { label: 'Personal', kind: 'oomol' }),
    playwright: { ...http(''), type: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@latest'] },
  };

  it('finds the copies that share a service and have no "use for"', () => {
    expect([...mcp.copiesByKind(servers).entries()]).toEqual([['oomol', ['oomol-work', 'oomol-personal']]]);
    expect(mcp.copiesWithoutUseFor(['oomol-work', 'oomol-personal', 'playwright'], servers)).toEqual(['oomol-personal']);
    // one copy alone needs none
    expect(mcp.copiesWithoutUseFor(['oomol-personal', 'playwright'], servers)).toEqual([]);
    expect(mcp.serverInfo(servers)['oomol-work']).toEqual({ title: 'OOMOL: Work', label: 'Work', kind: 'oomol', service: 'OOMOL', useFor: 'acme.com mail and calendar', copies: 2 });
    expect(mcp.serverInfo(servers).playwright).toMatchObject({ title: 'playwright', copies: 1 });
  });

  it("uses the team's account during team work, in place of the agent's own of that service", () => {
    expect(mcp.teamWorkServers(['oomol-personal', 'playwright'], ['oomol-work'], servers)).toEqual(['playwright', 'oomol-work']);
    expect(mcp.teamWorkServers(['oomol-personal', 'oomol-work'], ['oomol-work'], servers)).toEqual(['oomol-work']);
    // a team with both gives both; a team without the service leaves the agent's own
    expect(mcp.teamWorkServers(['oomol-personal'], ['oomol-work', 'oomol-personal'], servers).sort()).toEqual(['oomol-personal', 'oomol-work']);
    expect(mcp.teamWorkServers(['oomol-personal'], ['playwright'], servers)).toEqual(['oomol-personal', 'playwright']);
  });

  it('tells the agent which account is which and to ask when unsure', () => {
    const both = mcp.accountsPrompt(['oomol-work', 'oomol-personal', 'playwright'], servers);
    expect(both).toContain('# Accounts');
    expect(both).toContain('separate accounts of the same service');
    expect(both).toContain('- OOMOL: Work (the MCP server "oomol-work": its tools have "oomol-work" in their names). Use it for: acme.com mail and calendar');
    expect(both).toContain('- OOMOL: Personal (the MCP server "oomol-personal"');
    expect(both).not.toContain('playwright');
    expect(mcp.accountsPrompt(['oomol-work'], servers)).toContain('These MCP servers are accounts');
    expect(mcp.accountsPrompt(['playwright'], servers)).toBe('');
    // a server that is off isn't there for the agent
    expect(mcp.accountsPrompt(['oomol-work'], { 'oomol-work': { ...servers['oomol-work'], enabled: false } })).toBe('');
  });

  it('names the account in an approval, for Claude Code and API-model tool names', () => {
    expect(mcp.accountOfTool('mcp__oomol-work__send_mail', servers)).toBe('OOMOL: Work');
    // an API-model agent's call names its server
    expect(mcp.accountOf('oomol-personal', servers)).toBe('OOMOL: Personal');
    expect(mcp.accountOf('playwright', servers)).toBe('');
    expect(mcp.accountOfTool('mcp__playwright__click', servers)).toBe('');
    expect(mcp.accountOfTool('write_file', servers)).toBe('');
    // only Claude Code's own form: "oomol-work__send" is no Claude Code tool name
    expect(mcp.accountOfTool('oomol-work__send_mail', servers)).toBe('');
    // copies without labels are still told apart, by name
    const bare = { 'oomol': http(OOMOL), 'oomol-2': http(OOMOL) };
    expect(mcp.accountOfTool('mcp__oomol-2__send', bare)).toBe('oomol-2');
    // a server named "mcp" doesn't take the tools of a server named "a"
    const odd = { mcp: http(OOMOL, { label: 'Wrong' }), a: http(OOMOL, { label: 'Right' }) };
    expect(mcp.accountOfTool('mcp__a__send', odd)).toBe('OOMOL: Right');
  });

  it('lists every copy of a service the agent holds, the ones with no label or "use for" too', () => {
    const two = { oomol: http(OOMOL), 'oomol-work': http(OOMOL, { label: 'Work', kind: 'oomol', useFor: 'acme.com mail' }) };
    const text = mcp.accountsPrompt(['oomol', 'oomol-work'], two);
    expect(text).toContain('separate accounts of the same service');
    expect(text).toContain('- OOMOL (no label) (the MCP server "oomol": its tools have "oomol" in their names). Nobody said what it is for: ask before you use it');
    expect(text).toContain('- OOMOL: Work (the MCP server "oomol-work"');
  });

  it('lists copies for the Brain with their label and "use for", other servers by name', () => {
    expect(mcp.serversForPrompt(servers)).toBe('oomol-work (OOMOL: Work; use for: acme.com mail and calendar), oomol-personal (OOMOL: Personal), playwright');
  });
});

describe('the service of a server, as people name it and as it changes', () => {
  it('keeps the case of a service added by hand, so its accounts stay together', () => {
    mcp.saveServer('MyMail', http('https://mail.example/mcp'));
    // the page sends the service as it lists it; the Brain may write it in any case
    mcp.saveServer('mymail-work', http('https://mail.example/work', { label: 'Work', kind: 'MyMail' }));
    mcp.saveServer('mymail-home', http('https://mail.example/home', { label: 'Home', kind: 'mymail' }));
    expect(mcp.resolveKind('OOMOL')).toBe('oomol');
    expect(mcp.resolveKind('mymail')).toBe('MyMail');
    expect(mcp.resolveKind('')).toBe('');
    expect(mcp.copiesByKind().get('MyMail')).toEqual(['MyMail', 'mymail-work', 'mymail-home']);
  });

  it('a renamed server stays the service it was, and the accounts of a renamed service follow it', () => {
    // the first GitHub, with arguments of its own: GitHub only by its name
    mcp.saveServer('github', { type: 'stdio', command: 'npx', args: ['-y', 'my-github-fork'] });
    mcp.saveServer('github-work', { type: 'stdio', command: 'npx', args: ['-y', 'my-github-fork'], label: 'Work', kind: 'github' });
    mcp.renameServer('github', 'github-personal');
    expect(mcp.kindOf('github-personal', mcp.listServers()['github-personal'])).toBe('github');
    expect(mcp.copiesByKind().get('github')).toEqual(['github-work', 'github-personal']);
    // a service added by hand is named after its first server: its accounts follow the new name
    mcp.renameServer('MyMail', 'mail-main');
    expect(mcp.copiesByKind().get('mail-main')).toEqual(['mymail-work', 'mymail-home', 'mail-main']);
    expect(mcp.copiesByKind().has('MyMail')).toBe(false);
  });

  it('"Its own service" sticks for a server that looks like a ready-made one', () => {
    const pw = { type: 'stdio' as const, command: 'npx', args: ['-y', '@playwright/mcp@latest'] };
    mcp.saveServer('my-browser', pw);
    expect(mcp.kindOf('my-browser', mcp.listServers()['my-browser'])).toBe('playwright');
    mcp.saveServer('my-browser', { ...pw, kind: 'my-browser' });
    expect(mcp.listServers()['my-browser'].kind).toBe('my-browser');
    expect(mcp.kindOf('my-browser', mcp.listServers()['my-browser'])).toBe('my-browser');
    // its own name isn't stored when it would be that anyway
    mcp.saveServer('weather', { ...http('https://weather.example/mcp'), kind: 'weather' });
    expect(mcp.listServers().weather.kind).toBeUndefined();
  });

  it('gives a copy a short name, so its tool names fit in 64 characters', () => {
    const name = mcp.copyName('sequential-thinking', 'Client A marketing department Europe', {});
    expect(name).toBe('sequential-thinking-client-a-mar');
    expect(name.length).toBeLessThanOrEqual(32);
    expect(mcp.copyName('oomol', 'Client A marketing department Europe', {})).toBe('oomol-client-a-marketing-departm');
    // a cut that ends on a dash drops it
    expect(mcp.copyName('oomol', 'Client A marketing departm ok', {})).toBe('oomol-client-a-marketing-departm');
    expect(mcp.copyName('oomol', 'Client A marketing depart ok', {})).toBe('oomol-client-a-marketing-depart');
  });

  it("gives two MCP tools whose names meet when cut to 64 different names for an API-model agent", () => {
    const taken = new Set<string>();
    const server = 'oomol-client-a-marketing-departm';
    const a = mcpToolName(server, 'send_email_with_attachment_and_tracking', taken);
    taken.add(a);
    const b = mcpToolName(server, 'send_email_with_attachment_and_template', taken);
    expect(a).toHaveLength(64);
    expect(b).toHaveLength(64);
    expect(b).not.toBe(a);
    expect(b.endsWith('_2')).toBe(true);
    expect(mcpToolName('oomol', 'send', taken)).toBe('oomol__send');
  });

  it('places a new server: its own name the first time, "<service>-<label>" next to other accounts, or the name asked for', () => {
    const servers: McpServers = { linear: http('https://mcp.linear.app/mcp') };
    expect(mcp.placeNew('notion', {}, servers)).toEqual({ name: 'notion', others: [] });
    expect(mcp.placeNew('linear', { label: 'Client' }, servers)).toEqual({ name: 'linear-client', others: ['linear'] });
    expect(mcp.placeNew('linear', { name: 'issues', label: 'Client' }, servers)).toEqual({ name: 'issues', others: ['linear'] });
  });

  it('changes a label or "use for" without touching the rest, and clears one given empty', () => {
    mcp.saveServer('notes', { ...http('https://notes.example/mcp'), label: 'Mine', useFor: 'my notes', description: 'Notes' });
    expect(mcp.describeCopy('notes', { label: 'Mine', useFor: 'my notes' })).toMatchObject({ label: 'Mine', useFor: 'my notes', description: 'Notes' });
    mcp.describeCopy('notes', { useFor: '' });
    expect(mcp.listServers().notes).toEqual({ ...http('https://notes.example/mcp'), label: 'Mine', description: 'Notes' });
    expect(() => mcp.describeCopy('nope', { label: 'x' })).toThrow(/No MCP server/);
  });
});
