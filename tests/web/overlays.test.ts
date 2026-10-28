// Dialogs and toasts on Base UI, opened the plain-DOM way (modal, confirmBox, promptBox, toast).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { confirmBox, h, modal, promptBox, toast } from '../../web/core.ts';

const tick = () => new Promise((r) => setTimeout(r, 0));
const dialogs = () => [...document.querySelectorAll<HTMLElement>('#modal-root .modal')];
const escape = (on: Element) => on.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

beforeEach(() => {
  document.body.innerHTML = '<div id="modal-root"></div><div id="toasts"></div>';
});

describe('modal()', () => {
  it('draws the same parts as before, at once, and labels the dialog with its title', () => {
    const m = modal({ title: 'Rename', body: h('p.x', 'Body text'), foot: [h('button.btn', 'Save')], narrow: true });
    expect(m.el.classList.contains('modal-back')).toBe(true);
    const d = m.el.querySelector<HTMLElement>('.modal.narrow')!;
    expect(d.querySelector('.modal-head h2')!.textContent).toBe('Rename');
    expect(d.querySelector('.modal-body p.x')!.textContent).toBe('Body text');
    expect(d.querySelector('.modal-foot button')!.textContent).toBe('Save');
    expect(d.getAttribute('role')).toBe('dialog');
    expect(d.getAttribute('aria-labelledby')).toBe(d.querySelector('h2')!.id);
    m.close();
  });

  it('leaves the button row out when there are no buttons', () => {
    const m = modal({ title: 'Note', body: 'x' });
    expect(m.el.querySelector('.modal-foot')).toBeNull();
    m.close();
  });

  it('closes with its ✕ and calls onClose once, however often close() is called', () => {
    const onClose = vi.fn();
    const m = modal({ title: 'A', body: 'x', onClose });
    m.el.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click();
    m.close();
    expect(dialogs()).toHaveLength(0);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps what the caller does with the element (a wider window, its own listeners)', () => {
    const m = modal({ title: 'History', body: 'x' });
    m.el.classList.add('wide');
    const seen = vi.fn();
    m.el.addEventListener('dragover', seen);
    m.el.querySelector('.modal')!.dispatchEvent(new Event('dragover', { bubbles: true }));
    expect(m.el.classList.contains('wide')).toBe(true);
    expect(seen).toHaveBeenCalled();
    m.close();
  });

  it('a dialog opened from another sits on top; closing the lower one closes it too', async () => {
    const first = modal({ title: 'Editor', body: 'x' });
    const asked = confirmBox('Delete it?', { ok: 'Delete', danger: true });
    expect(dialogs()).toHaveLength(2);
    first.close();
    expect(dialogs()).toHaveLength(0);
    expect(await asked).toBe(false);
  });

  it('Escape closes only the dialog on top', async () => {
    const first = modal({ title: 'Editor', body: 'x' });
    const asked = confirmBox('Sure?');
    await tick();
    escape(document.activeElement && document.activeElement !== document.body ? document.activeElement : dialogs()[1]);
    expect(await asked).toBe(false);
    expect(dialogs()).toHaveLength(1);
    expect(dialogs()[0].querySelector('h2')!.textContent).toBe('Editor');
    first.close();
  });
});

describe('confirmBox() and promptBox()', () => {
  it('confirmBox gives true for its button and false for Cancel', async () => {
    const yes = confirmBox('Go?', { ok: 'Go' });
    [...document.querySelectorAll<HTMLButtonElement>('.modal-foot button')].find((b) => b.textContent === 'Go')!.click();
    expect(await yes).toBe(true);
    const no = confirmBox('Go?');
    [...document.querySelectorAll<HTMLButtonElement>('.modal-foot button')].find((b) => b.textContent === 'Cancel')!.click();
    expect(await no).toBe(false);
    expect(dialogs()).toHaveLength(0);
  });

  it('promptBox puts focus in its text box and gives back what was typed', async () => {
    const answer = promptBox('Name', { value: 'Ada' });
    await tick();
    const input = document.querySelector<HTMLInputElement>('.modal-body input')!;
    expect(document.activeElement).toBe(input);
    input.value = 'Grace';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(await answer).toBe('Grace');
  });
});

describe('toast()', () => {
  it('shows text and DOM, marks warnings and errors, in a region screen readers read out', async () => {
    toast('Saved');
    toast(h('b', 'Disk full'), 'error');
    toast('Careful', 'warn');
    await tick();
    const items = [...document.querySelectorAll<HTMLElement>('#toasts .toast')];
    expect(items.map((t) => t.textContent)).toEqual(['Saved', 'Disk full', 'Careful']);
    expect(items[1].classList.contains('error')).toBe(true);
    expect(items[1].querySelector('b')).not.toBeNull();
    expect(items[2].classList.contains('warn')).toBe(true);
    expect(document.querySelector('#toasts [aria-live="polite"]')).not.toBeNull();
  });

  it('draws into fresh containers when the page puts in new ones', async () => {
    toast('one');
    await tick();
    document.body.innerHTML = '<div id="modal-root"></div><div id="toasts"></div>';
    toast('two');
    await tick();
    expect(document.getElementById('toasts')!.textContent).toBe('two');
  });
});
