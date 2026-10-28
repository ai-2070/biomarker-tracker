// GET /api/mcp shows saved keys as dots, and saving the form back keeps the real keys.
import { describe, expect, it } from 'vitest';
import * as mcp from '../../server/mcp.ts';

describe('MCP keys in listings', () => {
  it('hides keys, header values and keys in links', () => {
    const shown = mcp.hideSecrets({ env: { API_KEY: 'sk-1', DEBUG: '1', GITHUB_TOKEN: 'ghp' }, headers: { Authorization: 'Bearer x', 'x-team': 'acme' }, url: 'https://h.example/mcp?api_key=abc&mode=fast' });
    expect(shown.env).toEqual({ API_KEY: mcp.HIDDEN, DEBUG: '1', GITHUB_TOKEN: mcp.HIDDEN });
    expect(shown.headers).toEqual({ Authorization: mcp.HIDDEN, 'x-team': mcp.HIDDEN });
    expect(shown.url).toBe(`https://h.example/mcp?api_key=${mcp.HIDDEN}&mode=fast`);
    // a ready-made one's own link part (Composio's session) is hidden too
    expect(mcp.hideSecrets({ url: 'https://mcp.composio.dev/session/s3cr3t' }, 'composio').url).toBe(`https://mcp.composio.dev/session/${mcp.HIDDEN}`);
    // placeholders stay, so the page can still say a key is missing
    expect(mcp.hideSecrets({ env: { API_KEY: 'YOUR_API_KEY' } }).env).toEqual({ API_KEY: 'YOUR_API_KEY' });
  });

  it('keeps the saved keys when the hidden form is saved back', () => {
    mcp.saveServer('svc', { type: 'http', url: 'https://h.example/mcp?token=abc', headers: { Authorization: 'Bearer real' }, env: { API_KEY: 'sk-real' } });
    const listed = mcp.hiddenServers(mcp.listServers()).svc;
    expect(JSON.stringify(listed)).not.toMatch(/real|abc/);
    mcp.saveServer('svc', { ...listed, description: 'changed', headers: { ...listed.headers, 'x-more': 'new' } });
    const saved = mcp.listServers().svc;
    expect(saved).toMatchObject({ description: 'changed', url: 'https://h.example/mcp?token=abc', headers: { Authorization: 'Bearer real', 'x-more': 'new' }, env: { API_KEY: 'sk-real' } });
    // a key typed over the dots replaces it
    mcp.saveServer('svc', { ...listed, headers: { Authorization: 'Bearer newer' } });
    expect(mcp.listServers().svc.headers).toEqual({ Authorization: 'Bearer newer' });
  });
});
