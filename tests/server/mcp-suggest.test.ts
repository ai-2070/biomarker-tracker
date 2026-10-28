// "Suggested for this PC": ready-made MCP servers for the programs found here, plus a few basics.
// Suggested only, never added: these run other people's code.
import { describe, expect, it } from 'vitest';
import { PRESETS, PRESET_PROGRAMS, BASIC_PRESETS, suggestPresets, listServers } from '../../server/mcp.ts';
import { discoverPrograms } from '../../server/programs.ts';
import type { McpServers } from '../../server/mcp.ts';

const prog = (id: string, name: string, installed = true, exe: string | null = null) => ({ id, name, installed, exe });

describe('MCP suggestions', () => {
  it("point at ready-made servers and at programs the Programs page knows", async () => {
    const presets = new Set(PRESETS.map((p) => p.name));
    for (const name of [...Object.keys(PRESET_PROGRAMS), ...BASIC_PRESETS]) expect(presets, name).toContain(name);
    const ids = new Set((await discoverPrograms(true)).map((p) => p.id));
    // (optional programs only show when installed, so check the ones every PC lists)
    for (const id of ['blender', 'maya', 'houdini', 'gimp', 'obs', 'chrome', 'unity', 'unreal', 'godot', 'freecad']) expect(ids, id).toContain(id);
  });

  it("suggest a program's own server when it is installed, then the basics", () => {
    const s = suggestPresets([prog('blender', 'Blender'), prog('obs', 'OBS Studio'), prog('maya', 'Maya', false)], {});
    expect(s.map((x) => x.name)).toEqual(['blender', 'obs', ...BASIC_PRESETS]);
    expect(s[0]).toMatchObject({ reason: 'Blender is installed', program: 'blender' });
    expect(s[0].needs).toMatch(/^setup: install the add-on/);
    expect(s.find((x) => x.name === 'obs')!.needs).toMatch(/^needs OBS_WEBSOCKET_PASSWORD/);
    expect(s.find((x) => x.name === 'fetch')).toMatchObject({ program: null, needs: '' });
  });

  it('leave out what is already added, under its own name or another', () => {
    const blender = PRESETS.find((p) => p.name === 'blender')!;
    const servers: McpServers = {
      fetch: { type: 'stdio', command: 'uvx', args: ['mcp-server-fetch'], env: {}, url: '', headers: {}, description: '', enabled: true },
      'my-blender': { type: 'stdio', command: blender.type === 'stdio' ? blender.command : '', args: blender.type === 'stdio' ? blender.args : [], env: {}, url: '', headers: {}, description: '', enabled: true },
    };
    expect(suggestPresets([prog('blender', 'Blender')], servers).map((x) => x.name)).toEqual(['context7']);
  });

  it("skip Audacity 4, which its server can't drive", () => {
    expect(suggestPresets([prog('audacity', 'Audacity', true, 'C:\\Program Files\\Audacity 4\\bin\\Audacity4.exe')], {}).map((x) => x.name)).not.toContain('audacity');
    expect(suggestPresets([prog('audacity', 'Audacity', true, 'C:\\Program Files\\Audacity\\Audacity.exe')], {}).map((x) => x.name)).toContain('audacity');
  });

  it('never add anything by themselves', () => {
    const before = JSON.stringify(listServers());
    suggestPresets([prog('blender', 'Blender'), prog('gimp', 'GIMP')]);
    expect(JSON.stringify(listServers())).toBe(before);
  });
});
