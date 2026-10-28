// world_look asks the open Station tabs for a picture; the first good answer wins, words when none comes.
import { describe, expect, it } from 'vitest';
import { bus } from '../../server/store.ts';
import { deliverLook, requestLook, setOpenPages } from '../../server/voxel/look.ts';
import { callTool } from '../../server/tools.ts';
import { newAgent } from '../../server/library.ts';
import { build } from '../../server/voxel/build.ts';
import type { ServerEvent } from '../../shared/types.ts';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('world_look', () => {
  // asks with this many pages open; returns the answer to come and the request the tabs got
  const askTabs = (pages: number) => {
    setOpenPages(() => pages);
    const seen: ServerEvent[] = [];
    const on = (e: ServerEvent) => seen.push(e);
    bus.on('event', on);
    const p = requestLook('w1', 'p1', { target: 'overview', width: 1024, height: 640 }, 2000);
    bus.off('event', on);
    setOpenPages(() => 1);
    return { p, ask: seen.find((e) => e.type === 'world-look') as ServerEvent & { request: string; view: { target: string } } };
  };

  it('asks the tabs, takes the first picture, ignores bad and late ones', async () => {
    // two tabs: one can't draw it, the other answers
    const { p, ask } = askTabs(2);
    expect(ask.view.target).toBe('overview');
    expect(deliverLook(ask.request, { error: 'not in the voxel look' })).toBe(false);
    expect(deliverLook(ask.request, { image: 'data:text/html;base64,PGI+' })).toBe(false);
    expect(deliverLook(ask.request, { image: PNG })).toBe(true);
    expect(deliverLook(ask.request, { image: PNG })).toBe(false);
    expect(await p).toEqual({ image: PNG });
  });

  it("stops waiting once every open tab says it can't draw it", async () => {
    const { p, ask } = askTabs(2);
    const t = Date.now();
    deliverLook(ask.request, { error: 'not in the voxel look' });
    deliverLook(ask.request, { error: "this tab doesn't show that world in the voxel look" });
    expect(await p).toEqual({ image: null, note: "this tab doesn't show that world in the voxel look" });
    expect(Date.now() - t).toBeLessThan(500);
  });

  it('gives up when nobody answers', async () => {
    expect(await requestLook('w1', 'p1', { target: 'brain', width: 10, height: 10 }, 30)).toEqual({ image: null, note: 'no open Station answered' });
  });

  it('the tool returns the picture, or a map in words for an object', async () => {
    const { saveSettings } = await import('../../server/store.ts');
    saveSettings({ look: { stationLook: 'world' } });
    const a = newAgent({ name: 'Looker', toolGroups: ['world'], autonomy: 'full' });
    expect((await callTool(a, 'world_look', {})).text).toMatch(/no world yet/i);
    build({ by: { kind: 'agent', id: a.id, name: 'Looker' }, object: 'Hut', steps: [{ box: [3, 2, 3], use: 'wood' }] });
    const answer = (e: ServerEvent) => {
      if (e.type === 'world-look') setTimeout(() => deliverLook((e as ServerEvent & { request: string }).request, { image: PNG }), 5);
    };
    bus.on('event', answer);
    const r = await callTool(a, 'world_look', { target: 'object', name: 'hut', azimuth: 120 });
    bus.off('event', answer);
    expect(r.text).toMatch(/"Hut" in ".*" \(station, from 120°\)/);
    expect(r.images).toEqual([PNG]);
    expect((await callTool(a, 'world_look', { target: 'object', name: 'Nope' })).isError).toBe(true);
  }, 20_000);
});

describe('world_look in the classic look', () => {
  it('asks you (once for builders asking together) to turn on the voxel look; no keeps the classic look', async () => {
    const { saveSettings, getSettings } = await import('../../server/store.ts');
    const { listApprovals, decide } = await import('../../server/approvals.ts');
    saveSettings({ look: { stationLook: 'classic' } });
    const a = newAgent({ name: 'Peeker', toolGroups: ['world'], autonomy: 'full' });
    const two = [callTool(a, 'world_look', {}), callTool(a, 'world_look', { target: 'brain' })];
    await new Promise((r) => setTimeout(r, 20));
    const asks = listApprovals().filter((x) => x.kind === 'setting');
    expect(asks).toHaveLength(1);
    expect(asks[0]).toMatchObject({ title: 'Peeker wants to see the voxel world', data: { allow: 'Turn on the voxel look' } });
    decide(asks[0].id, { approved: false });
    for (const r of await Promise.all(two)) expect(r.text).toMatch(/^No picture: the user kept the Station in the classic look/);
    expect(getSettings().look.stationLook).toBe('classic');
  });

  it('yes turns it on, and the picture comes once a Station has switched', async () => {
    const { saveSettings, getSettings } = await import('../../server/store.ts');
    const { listApprovals, decide } = await import('../../server/approvals.ts');
    saveSettings({ look: { stationLook: 'classic' } });
    const a = newAgent({ name: 'Peeker', toolGroups: ['world'], autonomy: 'full' });
    // the tab can't draw it at first (still loading the world), then it can
    let asked = 0;
    const tab = (e: ServerEvent) => {
      if (e.type !== 'world-look') return;
      const req = (e as ServerEvent & { request: string }).request;
      setTimeout(() => deliverLook(req, ++asked === 1 ? { error: 'still loading' } : { image: PNG }), 5);
    };
    bus.on('event', tab);
    const p = callTool(a, 'world_look', {});
    await new Promise((r) => setTimeout(r, 20));
    decide(listApprovals().find((x) => x.kind === 'setting')!.id, { approved: true });
    const r = await p;
    bus.off('event', tab);
    expect(getSettings().look.stationLook).toBe('world');
    expect(r.images).toEqual([PNG]);
    expect(asked).toBe(2);
  }, 20_000);

  it("in the voxel look, a Station that can't draw it says why", async () => {
    const { saveSettings } = await import('../../server/store.ts');
    saveSettings({ look: { stationLook: 'world' } });
    const a = newAgent({ name: 'Peeker', toolGroups: ['world'], autonomy: 'full' });
    const refuse = (e: ServerEvent) => {
      if (e.type === 'world-look') setTimeout(() => deliverLook((e as ServerEvent & { request: string }).request, { error: "this tab doesn't show that world in the voxel look" }), 5);
    };
    bus.on('event', refuse);
    const r = await callTool(a, 'world_look', {});
    bus.off('event', refuse);
    expect(r.text).toMatch(/no open Station could draw it \(this tab doesn't show that world in the voxel look\)\. Ask the user to open the Station with this project open/);
  });
});

describe('world_look with no page open', () => {
  it("doesn't wait when no page is open", async () => {
    const { setOpenPages } = await import('../../server/voxel/look.ts');
    setOpenPages(() => 0);
    const t = Date.now();
    expect(await requestLook('w1', 'p1', { target: 'overview', width: 10, height: 10 })).toEqual({ image: null, note: 'no page is open' });
    expect(Date.now() - t).toBeLessThan(500);
    setOpenPages(() => 1);
  });
});
