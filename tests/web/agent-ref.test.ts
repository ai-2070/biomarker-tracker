// Naming an agent so ask_agent reaches the one picked, even when two share a name.
import { describe, expect, it } from 'vitest';
import { agentRef, findAgent } from '../../shared/agentref.ts';

const ALL = [
  { id: 'a', name: 'Editor' },
  { id: 'b', name: 'editor' },
  { id: 'c', name: 'Trend Scout' },
  { id: 'd', name: 'Video Editor' },
];
const id = (ref: string) => {
  const r = findAgent(ALL, ref);
  return 'agent' in r ? r.agent.id : r.error;
};

describe('agentRef()', () => {
  it('is the name, with the id only when another agent has the same name', () => {
    expect(agentRef(ALL[2], ALL)).toBe('Trend Scout');
    expect(agentRef(ALL[0], ALL)).toBe('Editor [a]');
    expect(agentRef(ALL[1], ALL)).toBe('editor [b]');
    expect(agentRef(ALL[3], ALL)).toBe('Video Editor');
  });
});

describe('findAgent()', () => {
  it('finds by id, by "Name [id]", by name and by part of a name', () => {
    expect(id('b')).toBe('b');
    expect(id('Editor [b]')).toBe('b');
    expect(id('editor [a]')).toBe('a');
    expect(id('trend scout')).toBe('c');
    expect(id('video')).toBe('d');
    expect(id('Video Editor')).toBe('d');
  });

  it('refuses to guess when more than one fits, and says which', () => {
    expect(id('Editor')).toBe('More than one agent fits "Editor": Editor [a], editor [b]. Use the id.');
    expect(id('o')).toContain('More than one agent fits');
    expect(id('Nobody')).toBe('No agent called "Nobody".');
    expect(id('')).toBe('No agent called "".');
  });
});
