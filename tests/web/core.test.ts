import { describe, expect, it } from 'vitest';
import { ago, approvalCard, freshElement, h, mount, toggleRow } from '../../web/core.ts';
import type { Approval } from '../../shared/types.ts';

describe('h()', () => {
  it('builds elements from tag.class#id notation', () => {
    const el = h('div.card.big#main', 'hi');
    expect(el.tagName).toBe('DIV');
    expect(el.id).toBe('main');
    expect([...el.classList]).toEqual(['card', 'big']);
    expect(el.textContent).toBe('hi');
  });

  it('sets attributes, handlers and nested children (skipping null/false)', () => {
    let clicked = 0;
    const el = h('button', { title: 'Go', onclick: () => clicked++ }, 'A', null, false, ['B', ['C']], 2);
    el.click();
    expect(clicked).toBe(1);
    expect(el.title).toBe('Go');
    expect(el.textContent).toBe('ABC2');
  });

  it('applies style objects, including CSS variables like --c', () => {
    const el = h('div', { style: { fontSize: '12px', '--c': '#ff0000' } });
    expect(el.style.fontSize).toBe('12px');
    // CSS variables need setProperty; this used to be dropped silently
    expect(el.style.getPropertyValue('--c')).toBe('#ff0000');
  });

  it('gives typed elements for inputs', () => {
    const input = h('input', { value: 'abc' });
    expect(input.value).toBe('abc');
  });

  it('mount replaces the children', () => {
    const box = h('div', 'old');
    mount(box, h('span', 'new'), 'text');
    expect(box.innerHTML).toBe('<span>new</span>text');
  });
});

// md() is tested in markdown.test.ts (in jsdom, where the sanitizer runs for real)

describe('ago()', () => {
  it('says how long ago, in short words', () => {
    expect(ago(Date.now())).toMatch(/now|s ago/);
    expect(ago(Date.now() - 5 * 60_000)).toMatch(/5m/);
    expect(ago(Date.now() - 3 * 3600_000)).toMatch(/3h/);
    expect(ago(null)).toBe('');
  });
});

describe('toggleRow()', () => {
  it('clicking its text flips the switch, and no label sits inside another', () => {
    const seen: boolean[] = [];
    const row = toggleRow(false, (on) => seen.push(on), 'Compact long chats automatically');
    document.body.append(row);
    const input = row.querySelector('input')!;
    const text = row.querySelector('label.toggle-text') as HTMLLabelElement;
    expect(text.htmlFor).toBe(input.id);
    expect(row.querySelector('label label')).toBeNull();
    text.click();
    expect(input.checked).toBe(true);
    expect(seen).toEqual([true]);
    // two rows never share an id
    expect(toggleRow(true, () => {}, 'Other').querySelector('input')!.id).not.toBe(input.id);
    row.remove();
  });
});

describe('freshElement()', () => {
  it('swaps in an empty copy, so a page that loads late draws out of sight', () => {
    const shell = h('main', h('section#view.flush', h('p', 'Station')));
    document.body.append(shell);
    const old = shell.querySelector('#view')!;
    const fresh = freshElement(old);
    expect(fresh).not.toBe(old);
    expect(document.getElementById('view')).toBe(fresh);
    expect(fresh.className).toBe('flush');
    expect(fresh.childNodes.length).toBe(0);
    // the page you left finishes loading: it draws into the old element, not the one on screen
    mount(old, h('p', 'Library'));
    expect(shell.textContent).toBe('');
    mount(fresh, h('p', 'Agents'));
    expect(shell.textContent).toBe('Agents');
    shell.remove();
  });
});

describe('approvalCard', () => {
  const card = (a: Partial<Approval>) => approvalCard({ id: 'ap1', kind: 'tool', title: 'T', detail: '', agentId: 'a1', agentName: 'Mira', data: {}, editable: null, createdAt: 0, ...a });
  const buttons = (el: HTMLElement) => [...el.querySelectorAll('button')].map((b) => b.textContent);
  it('a tool call: Allow, Always allow, Deny', () => {
    expect(buttons(card({}))).toEqual(['Allow', 'Always allow', 'Deny']);
  });
  it('a setting says what yes does, and is never always allowed', () => {
    const el = card({ kind: 'setting', data: { allow: 'Turn on the voxel look' } });
    expect(el.querySelector('.label')!.textContent).toBe('A setting');
    expect(buttons(el)).toEqual(['Turn on the voxel look', 'Not now']);
  });
});
