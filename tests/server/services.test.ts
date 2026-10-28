// A message nobody is named in goes to the only member with the service it needs (services.ts, teams.ts).
import { describe, expect, it } from 'vitest';
import { newAgent } from '../../server/library.ts';
import { bus, workflows } from '../../server/store.ts';
import { postUserMessage } from '../../server/teams.ts';
import { servicesOf, soleHolder } from '../../server/services.ts';
import type { Agent, ServerEvent, Team } from '../../shared/types.ts';

const a = (name: string, toolGroups: string[] = [], mcpServers: string[] = []) => ({ ...newAgent({ name, engine: 'openai', toolGroups }), mcpServers }) as Agent;

describe('soleHolder', () => {
  const lead = a('Lead', ['files']);
  const artist = a('Artist', ['blender', 'comfyui']);
  const poster = a('Poster', ['social']);
  const dev = a('Dev', ['files'], ['github', 'memory']);
  const team = [lead, artist, poster, dev];

  it('the only member with what the message names', () => {
    expect(soleHolder('Render the logo in Blender', team)).toEqual({ id: artist.id, service: 'Blender' });
    expect(soleHolder('tweet the launch', team)).toEqual({ id: poster.id, service: 'social posts' });
    expect(soleHolder('post it on X tonight', team)?.id).toBe(poster.id);
    expect(soleHolder('open an issue on GitHub', team)).toEqual({ id: dev.id, service: 'github' });
    // two services, same member
    expect(soleHolder('ComfyUI first, then Blender', team)?.id).toBe(artist.id);
  });

  it('nothing when no one has it alone, when it takes two members, or when the word is too common', () => {
    expect(soleHolder('summarize the notes', team)).toBeNull();
    expect(soleHolder('render in Blender and tweet it', team)).toBeNull();
    expect(soleHolder('from memory, what did we decide?', team)).toBeNull();
    expect(soleHolder('render in Blender', [artist, a('Artist 2', ['blender'])])).toBeNull();
    expect(soleHolder('the x axis is wrong', team)).toBeNull();
  });

  it("an agent's services, for the team roster", () => {
    expect(servicesOf(artist)).toEqual(['ComfyUI', 'Blender']);
    expect(servicesOf(dev)).toEqual(['github']);
    expect(servicesOf(lead)).toEqual([]);
  });
});

describe('in a team chat', () => {
  it('goes to the only member with the service, before the lead', async () => {
    const lead = a('Lead', ['files']);
    const artist = a('Artist', ['blender']);
    const team = workflows.save({ name: 'Studio', description: 'Make things', members: [lead.id, artist.id], lead: lead.id, steps: [] } as Partial<Team>);
    const routed: unknown[] = [];
    const listen = (ev: ServerEvent) => {
      const e = (ev as unknown as { type: string; teamId?: string; event?: { kind: string } }).event;
      if ((ev as unknown as { teamId?: string }).teamId === team.id && e?.kind === 'routed') routed.push(e);
    };
    bus.on('event', listen);
    try {
      await postUserMessage(team.id, 'Render the logo in Blender');
      await postUserMessage(team.id, 'What is next?');
    } finally {
      bus.off('event', listen);
    }
    expect(routed).toEqual([
      { kind: 'routed', to: [artist.id], why: 'the only one with Blender' },
      { kind: 'routed', to: [lead.id], why: 'the lead' },
    ]);
  });
});
