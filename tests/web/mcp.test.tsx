// Settings > MCP servers (React): the server form in a dialog, Test, Remove, presets; and openModal().
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as mcp from '../../web/views/mcp.tsx';
import { joinArgs, parseHeaders, parseKv, splitArgs } from '../../web/views/mcp.tsx';
import { confirmBox } from '../../web/core.ts';
import { openModal } from '../../web/ui/overlays.tsx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const settle = () => act(() => new Promise((r) => setTimeout(r, 30)));

let servers: Record<string, unknown>;
// GET /api/mcp "suggested" (left out, like an older server sends it, unless a test sets it)
let suggested: unknown[] | undefined;
// more of GET /api/mcp (presets, info) for a test that needs it
let mcpMore: Record<string, unknown>;
let requests: { method: string; url: string; body: unknown }[];
let el: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '<div id="modal-root"></div><div id="toasts"></div><section id="view"></section>';
  el = document.getElementById('view')!;
  servers = { playwright: { type: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp'], env: {}, url: '', headers: {} } };
  requests = [];
  suggested = undefined;
  mcpMore = {};
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : null;
    requests.push({ method, url, body });
    const json = (v: unknown) => new Response(JSON.stringify(v));
    if (url === '/api/mcp' && method === 'GET') return json({ servers, presets: [{ name: 'github', title: 'GitHub', description: 'Repos', ready: true, installed: false, type: 'stdio', command: 'npx', args: ['gh'], env: { TOKEN: 'YOUR_TOKEN' } }], ...(suggested ? { suggested } : {}), importable: [], bridge: { command: 'bun', args: ['bridge.js'], env: {} }, ...mcpMore });
    if (url === '/api/tools') return json({ groups: [{ id: 'files', label: 'Files', description: 'Read and write' }], tools: [{ name: 'read_file', group: 'files', risk: 'none', description: 'Reads' }, { name: 'shell', group: 'files', risk: 'high', description: 'Runs' }] });
    if (url === '/api/mcp/playwright/test') return json({ tools: [{ name: 'click' }, { name: 'type' }] });
    if (url === '/api/mcp' && method === 'POST') {
      servers = { ...servers, [body.name]: body };
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      servers = {};
      return json({ ok: true });
    }
    return json({ ok: true });
  });
});
afterEach(() => {
  act(() => mcp.unmount());
  vi.unstubAllGlobals();
});

const open = async () => {
  await act(async () => mcp.render(el));
  await settle();
};
const btn = (root: ParentNode, text: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text)!;
const type = (input: HTMLInputElement | HTMLTextAreaElement, text: string) =>
  act(async () => {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
const field = (label: string) => [...document.querySelectorAll('#modal-root label.field')].find((f) => f.querySelector('span')?.textContent === label)!.querySelector<HTMLInputElement>('input, textarea')!;

describe('parsing', () => {
  it('reads KEY=value and Name: value lines, skipping the rest', () => {
    expect(parseKv('A=1\n\n B = two=2 \nnot this')).toEqual({ A: '1', B: 'two=2' });
    expect(parseHeaders('Authorization: Bearer x:y\nnope')).toEqual({ Authorization: 'Bearer x:y' });
  });

  it('writes arguments with spaces or quotes in double quotes, and reads them back the same', () => {
    const args = ['-y', 'C:/MCP Servers/server.js', 'say "hi"', '', 'C:\\tools\\x.exe'];
    expect(joinArgs(args)).toBe('-y "C:/MCP Servers/server.js" "say \\"hi\\"" "" C:\\tools\\x.exe');
    expect(splitArgs(joinArgs(args))).toEqual(args);
    expect(splitArgs('  -y   @playwright/mcp  ')).toEqual(['-y', '@playwright/mcp']);
  });
});

describe('the MCP servers tab', () => {
  it('suggests servers for programs on this PC, with why and what they need, and adds one only on a click', async () => {
    suggested = [
      { name: 'blender', title: 'Blender (live)', description: 'Control a running Blender scene.', reason: 'Blender is installed', needs: 'setup: install the add-on in Blender', program: 'blender' },
      { name: 'fetch', title: 'Web fetch', description: 'Fetch any URL.', reason: 'useful to most agents, no key or setup', needs: '', program: null },
    ];
    await open();
    expect(el.textContent).toContain('Suggested for this PC');
    const rows = [...el.querySelectorAll('.mcp-suggest')];
    expect(rows.map((r) => r.querySelector('.mcp-why')!.textContent)).toEqual(['Blender is installed', 'useful to most agents, no key or setup']);
    expect(rows[0].querySelector('.mcp-why')!.classList.contains('on')).toBe(true);
    expect(rows[0].textContent).toContain('First: install the add-on in Blender');
    expect(requests.some((r) => r.url === '/api/mcp-preset')).toBe(false);
    await act(async () => btn(rows[0], 'Add').click());
    await settle();
    expect(requests.find((r) => r.url === '/api/mcp-preset')!.body).toEqual({ name: 'blender' });
  });

  it('shows no suggestions section when there are none (or the server sends none)', async () => {
    await open();
    expect(el.textContent).not.toContain('Suggested for this PC');
  });

  it('lists servers, presets and built-in tools with their risk', async () => {
    await open();
    expect(el.querySelector('.mcp-server .title')!.textContent).toBe('playwright');
    expect(el.textContent).toContain('needs your key');
    expect(el.textContent).toContain('Built-in tools (2)');
    expect([...el.querySelectorAll('.mcp-tool')].map((t) => t.textContent)).toEqual(['read_file', 'shell ●']);
  });

  it('finds a preset by its name or what it does', async () => {
    const preset = (name: string, title: string, description: string) => ({ name, title, description, ready: true, installed: false, type: 'http', url: `https://${name}.example.com/mcp`, headers: {} });
    mcpMore = { presets: [preset('sentry', 'Sentry', 'Errors and stack traces.'), preset('kiwi', 'Flights (Kiwi.com)', 'Search flights.')] };
    await open();
    const titles = () => [...el.querySelectorAll('.card-title')].map((t) => t.textContent);
    expect(titles()).toEqual(['Sentry', 'Flights (Kiwi.com)']);
    const find = el.querySelector<HTMLInputElement>('input[aria-label="Search presets"]')!;
    await type(find, 'STACK');
    expect(titles()).toEqual(['Sentry']);
    await type(find, 'kiwi');
    expect(titles()).toEqual(['Flights (Kiwi.com)']);
    await type(find, 'nothing like it');
    expect(titles()).toEqual([]);
    expect(el.textContent).toContain('No preset matches "nothing like it".');
  });

  it('tests a server and shows its tools', async () => {
    await open();
    await act(async () => btn(el, 'Test').click());
    await settle();
    expect(el.querySelector('.mcp-server .pill.ok')!.textContent).toBe('2 tools');
    expect(el.querySelector('.mcp-tools')!.textContent).toBe('click · type');
  });

  it('adds a remote server from the form, then lists it', async () => {
    await open();
    await act(async () => btn(el, '+ Add server').click());
    expect(document.querySelector('#modal-root .modal h2')!.textContent).toBe('Add MCP server');
    await type(field('Name'), 'notion');
    await act(async () => btn(document.querySelector('#modal-root')!, 'Remote URL').click());
    await type(field('URL'), 'https://mcp.notion.com/mcp');
    await type(field('Headers'), 'Authorization: Bearer abc');
    await act(async () => btn(document.querySelector('#modal-root')!, 'Save').click());
    await settle();
    const post = requests.find((r) => r.method === 'POST' && r.url === '/api/mcp')!;
    expect(post.body).toMatchObject({ name: 'notion', type: 'http', url: 'https://mcp.notion.com/mcp', headers: { Authorization: 'Bearer abc' } });
    expect(document.querySelector('#modal-root .modal')).toBeNull();
    expect([...el.querySelectorAll('.mcp-server .title')].map((t) => t.textContent)).toEqual(['playwright', 'notion']);
  });

  it('edits a server with its name locked and its arguments and environment filled in', async () => {
    await open();
    await act(async () => btn(el, 'Edit').click());
    expect(field('Name').disabled).toBe(true);
    expect(field('Arguments').value).toBe('-y @playwright/mcp');
    await type(field('Environment'), 'DEBUG=1');
    await act(async () => btn(document.querySelector('#modal-root')!, 'Save').click());
    await settle();
    expect(requests.find((r) => r.method === 'POST' && r.url === '/api/mcp')!.body).toMatchObject({ name: 'playwright', args: ['-y', '@playwright/mcp'], env: { DEBUG: '1' } });
  });

  it('changing only the description keeps an argument with a space in it whole', async () => {
    servers = { local: { type: 'stdio', command: 'node', args: ['C:/MCP Servers/server.js'], env: {}, url: '', headers: {} } };
    await open();
    await act(async () => btn(el, 'Edit').click());
    expect(field('Arguments').value).toBe('"C:/MCP Servers/server.js"');
    await act(async () => btn(document.querySelector('#modal-root')!, 'Save').click());
    await settle();
    expect(requests.find((r) => r.method === 'POST' && r.url === '/api/mcp')!.body).toMatchObject({ name: 'local', args: ['C:/MCP Servers/server.js'] });
  });

  it('removes a server only after you confirm', async () => {
    await open();
    await act(async () => btn(el, 'Remove').click());
    await act(async () => btn(document.querySelector('.modal-foot')!, 'Remove').click());
    await settle();
    expect(requests.some((r) => r.method === 'DELETE' && r.url === '/api/mcp/playwright')).toBe(true);
    expect(el.textContent).toContain('None yet. Add a preset below.');
  });
});

describe('openModal()', () => {
  it('draws React content, stacks a confirm on top, and closing it closes the confirm too', async () => {
    let close!: () => void;
    await act(async () => void openModal('Form', (c) => ((close = c), <div className="modal-body"><input aria-label="Name" /></div>)));
    let asked!: Promise<boolean>;
    await act(async () => void (asked = confirmBox('Sure?')));
    expect([...document.querySelectorAll('#modal-root .modal h2')].map((h) => h.textContent)).toEqual(['Form', 'Are you sure?']);
    await act(async () => close());
    expect(await asked).toBe(false);
    expect(document.querySelector('#modal-root .modal')).toBeNull();
  });
});

describe('several accounts of one service', () => {
  const OOMOL = 'https://connector.oomol.com/v1/mcp';
  const oomolPreset = { name: 'oomol', title: 'OOMOL (remote)', service: 'OOMOL', description: 'Your OOMOL apps', ready: true, type: 'http', url: OOMOL, headers: { Authorization: 'Bearer YOUR_MCP_API_KEY' } };
  const info = (name: string, title: string, label: string, useFor: string, copies: number) => ({ title, label, kind: 'oomol', service: 'OOMOL', useFor, copies });

  it('adds another account from an added preset, with labels and what each is for', async () => {
    servers = { oomol: { type: 'http', command: '', args: [], env: {}, url: OOMOL, headers: {} } };
    mcpMore = { presets: [{ ...oomolPreset, installed: true, copies: ['oomol'] }], info: { oomol: info('oomol', 'oomol', '', '', 1) } };
    await open();
    expect(btn(el, 'Add')).toBeUndefined();
    await act(async () => btn(el, 'Add another').click());
    expect(document.querySelector('#modal-root .modal h2')!.textContent).toBe('Add another OOMOL account');
    const modal = document.querySelector('#modal-root')!;
    expect(btn(modal, 'Add').disabled).toBe(true);
    const [newLabel, oldLabel] = [...modal.querySelectorAll<HTMLInputElement>('input')];
    const [newUse, oldUse] = [...modal.querySelectorAll<HTMLTextAreaElement>('textarea')];
    expect(modal.textContent).toContain('The one you have: oomol');
    await type(newLabel, 'Work');
    await type(newUse, 'acme.com mail');
    await type(oldLabel, 'Personal');
    await type(oldUse, 'my own mail');
    await act(async () => btn(modal, 'Add').click());
    await settle();
    expect(requests.find((r) => r.url === '/api/mcp-preset')!.body).toEqual({ name: 'oomol', label: 'Work', useFor: 'acme.com mail', others: { oomol: { label: 'Personal', useFor: 'my own mail' } } });
  });

  it('sends only the accounts already there whose label or "use for" changed', async () => {
    servers = {
      oomol: { type: 'http', command: '', args: [], env: {}, url: OOMOL, headers: {}, label: 'Personal', useFor: 'my own mail' },
      'oomol-work': { type: 'http', command: '', args: [], env: {}, url: OOMOL, headers: {}, label: 'Work', kind: 'oomol', useFor: 'acme.com mail' },
    };
    // (an older server sends no "service": the title stands in)
    const { service: _, ...older } = oomolPreset;
    mcpMore = { presets: [{ ...older, installed: true, copies: ['oomol', 'oomol-work'] }] };
    await open();
    await act(async () => btn(el, 'Add another').click());
    expect(document.querySelector('#modal-root .modal h2')!.textContent).toBe('Add another OOMOL (remote) account');
    const modal = document.querySelector('#modal-root')!;
    const [newLabel, , workLabel] = [...modal.querySelectorAll<HTMLInputElement>('input')];
    await type(newLabel, 'Lab');
    await type(workLabel, 'Acme');
    await act(async () => btn(modal, 'Add').click());
    await settle();
    expect(requests.find((r) => r.url === '/api/mcp-preset')!.body).toEqual({ name: 'oomol', label: 'Lab', useFor: '', others: { 'oomol-work': { label: 'Acme', useFor: 'acme.com mail' } } });
  });

  it('"Its own service" is sent as its own name, so it stays apart from the ready-made one it looks like', async () => {
    servers = { 'my-oomol': { type: 'http', command: '', args: [], env: {}, url: OOMOL, headers: {} } };
    mcpMore = { presets: [{ ...oomolPreset, installed: true, copies: ['my-oomol'] }], info: { 'my-oomol': info('my-oomol', 'my-oomol', '', '', 1) } };
    await open();
    await act(async () => btn(el.querySelector('.mcp-server') as HTMLElement, 'Edit').click());
    const select = document.querySelector<HTMLSelectElement>('#modal-root select')!;
    expect(select.value).toBe('oomol');
    await act(async () => {
      select.value = '';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => btn(document.querySelector('#modal-root')!, 'Save').click());
    await settle();
    expect(requests.find((r) => r.method === 'POST' && r.url === '/api/mcp')!.body).toMatchObject({ name: 'my-oomol', kind: 'my-oomol' });
  });

  it('a new server left alone has its service worked out by the server', async () => {
    await open();
    await act(async () => btn(el, '+ Add server').click());
    await type(field('Name'), 'fresh');
    await type(field('Command'), 'uvx');
    await act(async () => btn(document.querySelector('#modal-root')!, 'Save').click());
    await settle();
    expect(requests.find((r) => r.method === 'POST' && r.url === '/api/mcp')!.body).toMatchObject({ name: 'fresh', kind: '' });
  });

  it('shows each account by its label, with what it is for or that it says nothing yet', async () => {
    servers = {
      'oomol-work': { type: 'http', command: '', args: [], env: {}, url: OOMOL, headers: {}, label: 'Work', kind: 'oomol', useFor: 'acme.com mail' },
      'oomol-home': { type: 'http', command: '', args: [], env: {}, url: OOMOL, headers: {}, label: 'Home', kind: 'oomol' },
    };
    mcpMore = { presets: [{ ...oomolPreset, installed: true, copies: ['oomol-work', 'oomol-home'] }], info: { 'oomol-work': info('oomol-work', 'OOMOL: Work', 'Work', 'acme.com mail', 2), 'oomol-home': info('oomol-home', 'OOMOL: Home', 'Home', '', 2) } };
    await open();
    const rows = [...el.querySelectorAll('.mcp-server')];
    expect(rows[0].querySelector('.title')!.textContent).toBe('OOMOL: Workoomol-workOOMOL account');
    expect(rows[0].querySelector('.mcp-use-for')!.textContent).toBe('Use for: acme.com mail');
    expect(rows[1].querySelector('.mcp-use-for')!.textContent).toContain('No "use for" yet');
    expect(el.textContent).toContain('2 added');
    // its form has the label, the "use for" and the service it is an account of
    await act(async () => btn(rows[1] as HTMLElement, 'Edit').click());
    expect(document.querySelector('#modal-root .modal h2')!.textContent).toBe('Edit OOMOL: Home');
    expect(field('Label').value).toBe('Home');
    expect(document.querySelector<HTMLSelectElement>('#modal-root select')!.value).toBe('oomol');
    await type(field('Use this one for'), 'family calendar');
    await act(async () => btn(document.querySelector('#modal-root')!, 'Save').click());
    await settle();
    expect(requests.find((r) => r.method === 'POST' && r.url === '/api/mcp')!.body).toMatchObject({ name: 'oomol-home', label: 'Home', kind: 'oomol', useFor: 'family calendar' });
  });
});
