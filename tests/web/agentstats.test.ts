// The Agents page's overview: an agent's category and model, and counting them into chart slices.
import { describe, expect, it } from 'vitest';
import { CATEGORY_COLORS, OTHER_COLOR, agentCategory, agentModel, categorySlices, divisionLabel, engineKey, inSlice, slices } from '../../web/agentstats.ts';
import type { Agent } from '../../shared/types.ts';

const src = (source: Agent['source']) => ({ source });

describe('agent categories', () => {
  it("a Library agent's division, else where it came from", () => {
    expect(divisionLabel('game-development')).toBe('Game Development');
    expect(divisionLabel('gis')).toBe('GIS');
    expect(agentCategory(src({ type: 'agency', division: 'paid-media' }))).toEqual({ id: 'division:paid-media', label: 'Paid Media' });
    expect(agentCategory(src({ type: 'brain' })).label).toBe('Made by the Brain');
    expect(agentCategory(src({ type: 'custom' })).label).toBe('Your own');
    expect(agentCategory(src({ type: 'something-new' })).label).toBe('Your own');
  });

  it('colours the six biggest in a fixed order and folds the rest into a grey Other', () => {
    const agents = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].flatMap((d, i) => Array.from({ length: 10 - i }, () => src({ type: 'agency', division: d })));
    const s = categorySlices(agents);
    expect(s.map((x) => x.label)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'Other']);
    expect(s.map((x) => x.color)).toEqual([...CATEGORY_COLORS, OTHER_COLOR]);
    expect(s[6]).toMatchObject({ count: 4 + 3, rest: [{ label: 'G' }, { label: 'H' }] });
    expect(inSlice(s[6], 'division:h')).toBe(true);
    expect(inSlice(s[0], 'division:h')).toBe(false);
  });

  it("doesn't make an Other of just one", () => {
    const agents = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((d) => src({ type: 'agency', division: d }));
    expect(categorySlices(agents).map((x) => x.label)).not.toContain('Other');
    expect(slices([1, 2, 3], (n) => ({ id: String(n), label: String(n) }), 1).map((x) => x.label)).toEqual(['1', 'Other']);
  });
});

describe('agent models', () => {
  it('names the model as you would: aliases capitalised, no provider part, the default when none is set', () => {
    expect(agentModel({ engine: 'claude-code', model: '' }, { claudeModel: 'opus' })).toEqual({ id: 'claude-code|opus', label: 'Opus', sub: 'Claude Code' });
    expect(agentModel({ engine: 'claude-code', model: 'sonnet' }).label).toBe('Sonnet');
    expect(agentModel({ engine: 'openai', model: 'google/gemini-3-pro' }).label).toBe('gemini-3-pro');
    expect(agentModel({ engine: 'codex', model: '' }).label).toBe("Codex's default");
    expect(agentModel({ engine: 'hermes', model: '' }).label).toBe("its profile's model");
  });

  it('knows which engine tile an agent is under (an API model: LM Studio or OpenRouter)', () => {
    expect(engineKey({ engine: 'openai', provider: 'lmstudio' })).toBe('lmstudio');
    expect(engineKey({ engine: 'openai', provider: 'openrouter' })).toBe('openrouter');
    expect(engineKey({ engine: 'codex', provider: '' })).toBe('codex');
  });
});
