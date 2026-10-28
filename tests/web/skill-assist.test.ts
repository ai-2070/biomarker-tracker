// The skill editor's "in plain words" box: while the Brain works the fields are locked (its answer
// replaces all three), and they open again once it has answered.
import { describe, expect, it, vi } from 'vitest';
import { state } from '../../web/core.ts';
import type { AppState } from '../../shared/types.ts';

const pending: { path: string; body: unknown; answer: (body: unknown, status?: number) => void }[] = [];
vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
  new Promise((resolve) => pending.push({ path: String(url), body: init?.body ? JSON.parse(String(init.body)) : null, answer: (b, status = 200) => resolve(new Response(JSON.stringify(b), { status })) })),
);
const tick = () => new Promise((r) => setTimeout(r, 0));
// answer everything but the Brain
const answerOthers = async () => {
  for (let i = 0; i < 6; i++) {
    for (const p of pending.filter((x) => !x.path.includes('/assist/skill'))) {
      pending.splice(pending.indexOf(p), 1);
      p.answer(p.path.includes('/skills') ? { skills: [], claude: [] } : []);
    }
    await tick();
  }
};

describe('writing a skill in plain words', () => {
  it('locks the fields while the Brain writes, then fills them in', async () => {
    document.body.innerHTML = '<div id="modal-root"></div><div id="toasts"></div>';
    state.data = { agents: [], project: { id: 'p', name: 'P', skills: [] }, settings: { brainSkills: [] } } as unknown as AppState;
    const view = await import('../../web/views/skills.tsx');
    const el = document.createElement('section');
    document.body.append(el);
    const loading = view.render(el, []);
    await answerOthers();
    await loading;
    [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('New skill'))!.click();
    await tick();
    const modal = document.querySelector('.modal')!;
    const ask = modal.querySelector<HTMLTextAreaElement>('.skill-ask-input')!;
    const [name] = modal.querySelectorAll<HTMLInputElement>('label.field input');
    const [desc, body] = modal.querySelectorAll<HTMLTextAreaElement>('label.field textarea');
    const save = [...modal.querySelectorAll<HTMLButtonElement>('.modal-foot button')].find((b) => b.textContent === 'Add skill')!;
    ask.value = 'How we write release notes';
    [...modal.querySelectorAll<HTMLButtonElement>('.skill-ask button')].find((b) => b.textContent?.includes('Write it'))!.click();
    await tick();
    await tick();

    const call = pending.find((p) => p.path.includes('/assist/skill'))!;
    expect(call.body).toMatchObject({ text: 'How we write release notes', current: { name: '', description: '', body: '' } });
    // waiting for the Brain: nothing can be typed over, nor saved half-done
    expect([name.readOnly, desc.readOnly, body.readOnly, save.disabled]).toEqual([true, true, true, true]);

    pending.splice(pending.indexOf(call), 1);
    call.answer({ name: 'Release notes', description: 'Use when writing release notes.', body: '# Steps', note: 'Wrote it.' });
    for (let i = 0; i < 4; i++) await tick();
    expect([name.value, desc.value, body.value]).toEqual(['Release notes', 'Use when writing release notes.', '# Steps']);
    expect([name.readOnly, desc.readOnly, body.readOnly, save.disabled]).toEqual([false, false, false, false]);
  });

  it('opens the fields again when the Brain fails', async () => {
    const modal = document.querySelector('.modal')!;
    const ask = modal.querySelector<HTMLTextAreaElement>('.skill-ask-input')!;
    const [name] = modal.querySelectorAll<HTMLInputElement>('label.field input');
    ask.value = 'shorter';
    [...modal.querySelectorAll<HTMLButtonElement>('.skill-ask button')].find((b) => b.textContent?.includes('Write it'))!.click();
    await tick();
    await tick();
    const call = pending.find((p) => p.path.includes('/assist/skill'))!;
    expect(name.readOnly).toBe(true);
    pending.splice(pending.indexOf(call), 1);
    call.answer({ error: 'Codex is not signed in' }, 500);
    for (let i = 0; i < 4; i++) await tick();
    expect(name.readOnly).toBe(false);
    expect(name.value).toBe('Release notes'); // unchanged
  });
});
