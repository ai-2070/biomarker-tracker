// The MCP servers in the agent and team pickers: accounts of one service by their labels, together.
import { describe, expect, it } from 'vitest';
import { copiesWarning, mcpOptions } from '../../web/mcpcopies.ts';
import type { McpServerInfo } from '../../shared/types.ts';

const copy = (kind: string, service: string, label: string, useFor: string, copies = 2): McpServerInfo => ({ title: `${service}: ${label}`, label, kind, service, useFor, copies });
const info: Record<string, McpServerInfo> = {
  'oomol-work': copy('oomol', 'OOMOL', 'Work', 'acme.com mail'),
  playwright: { title: 'playwright', label: '', kind: 'playwright', service: 'Browser control', useFor: '', copies: 1 },
  'oomol-home': copy('oomol', 'OOMOL', 'Home', ''),
};

describe('MCP chips', () => {
  it('show accounts by label next to each other, with what each is for on hover', () => {
    expect(mcpOptions(['oomol-work', 'playwright', 'oomol-home'], info)).toEqual([
      { value: 'oomol-work', label: 'OOMOL: Work', title: 'Use for: acme.com mail' },
      { value: 'oomol-home', label: 'OOMOL: Home', title: 'One of your 2 OOMOL accounts' },
      { value: 'playwright', label: 'playwright' },
    ]);
    // an older server sends no info: plain names
    expect(mcpOptions(['a', 'b'], undefined)).toEqual([{ value: 'a', label: 'a' }, { value: 'b', label: 'b' }]);
  });

  it('warn only when one holder has several accounts of a service and one says nothing', () => {
    expect(copiesWarning(['oomol-work', 'oomol-home'], info)).toBe('OOMOL: Home has no "use for" line, so it can\'t tell its OOMOL accounts apart. Say what each is for on the MCP servers page.');
    expect(copiesWarning(['oomol-home', 'playwright'], info)).toBe('');
    expect(copiesWarning(['oomol-work', 'oomol-home'], undefined)).toBe('');
  });
});
