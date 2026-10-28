// Long text pasted into a chat box: folded into a marker and a chip, opened on a click, put back when sent.
import { beforeEach, describe, expect, it } from 'vitest';
import { expandPastes, isLongPaste, pasteBox, pasteLabel } from '../../web/pastes.ts';

const paste = (target: HTMLElement, text: string, files: File[] = []) => {
  const data = { types: ['text/plain', ...(files.length ? ['Files'] : [])], items: files.map((f) => ({ kind: 'file', getAsFile: () => f })), files, getData: (t: string) => (t === 'text/plain' ? text : '') } as unknown as DataTransfer;
  const e = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'clipboardData', { value: data });
  target.dispatchEvent(e);
  return e;
};
const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n');

function setup() {
  const box = pasteBox();
  const input = document.createElement('textarea');
  document.body.append(box.el, input);
  box.attach(input);
  return { box, input };
}

beforeEach(() => {
  document.body.innerHTML = '<div id="modal-root"></div>';
  // as in a browser without insertText: the box is changed directly
  Object.defineProperty(document, 'execCommand', { value: () => false, configurable: true });
});

describe('what counts as a long paste', () => {
  it('folds many lines or many characters, not a sentence', () => {
    expect(isLongPaste('a short note')).toBe(false);
    expect(isLongPaste(lines(10))).toBe(false);
    expect(isLongPaste(lines(11))).toBe(true);
    expect(isLongPaste('x'.repeat(801))).toBe(true);
  });
  it('names it by lines, or by characters for one long line', () => {
    expect(pasteLabel(1, lines(52))).toBe('Pasted text #1 · 52 lines');
    expect(pasteLabel(2, 'x'.repeat(1200))).toBe('Pasted text #2 · 1,200 characters');
  });
  it('puts known pastes back and leaves other brackets alone', () => {
    const map = new Map([[1, 'a $& b']]);
    expect(expandPastes('see [Pasted text #1 · 3 lines] and [Pasted text #9 · 2 lines]', map)).toBe('see a $& b and [Pasted text #9 · 2 lines]');
  });
});

describe('pasteBox()', () => {
  it('folds a long paste into a marker and a chip, and sends the full text', () => {
    const { box, input } = setup();
    input.value = 'Fix this: ';
    input.setSelectionRange(10, 10);
    const long = lines(30);
    expect(paste(input, long).defaultPrevented).toBe(true);
    expect(input.value).toBe('Fix this: [Pasted text #1 · 30 lines]');
    expect(box.el.classList.contains('hidden')).toBe(false);
    expect(box.el.textContent).toContain('Pasted text #1 · 30 lines');
    expect(box.text()).toBe(`Fix this: ${long}`);
  });

  it('lets short text and files paste as usual', () => {
    const { input } = setup();
    expect(paste(input, 'hello').defaultPrevented).toBe(false);
    expect(paste(input, lines(30), [new File(['x'], 'a.png', { type: 'image/png' })]).defaultPrevented).toBe(false);
    expect(input.value).toBe('');
  });

  it('takes the whole marker with one Backspace, and the chip goes with it', () => {
    const { box, input } = setup();
    paste(input, lines(20));
    const end = input.value.length;
    input.setSelectionRange(end, end);
    const key = new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true });
    input.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(true);
    expect(input.value).toBe('');
    expect(box.el.classList.contains('hidden')).toBe(true);
  });

  it('opens what was pasted from the chip, and can take it out of the message', () => {
    const { box, input } = setup();
    const long = lines(15);
    paste(input, long);
    box.el.querySelector<HTMLButtonElement>('.paste-open')!.click();
    expect(document.querySelector('.paste-view')?.textContent).toBe(long);
    const remove = [...document.querySelectorAll<HTMLButtonElement>('.modal-foot button')].find((b) => b.textContent?.trim().endsWith('Remove'))!;
    remove.click();
    expect(input.value).toBe('');
    expect(document.querySelector('.paste-view')).toBeNull();
  });

  it('can put the whole text in the box to change it', () => {
    const { box, input } = setup();
    const long = lines(15);
    paste(input, long);
    box.el.querySelector<HTMLButtonElement>('.paste-open')!.click();
    [...document.querySelectorAll<HTMLButtonElement>('.modal-foot button')].find((b) => b.textContent === 'Edit in the box')!.click();
    expect(input.value).toBe(long);
    expect(box.el.classList.contains('hidden')).toBe(true);
  });

  it('opens it on a click inside the marker', () => {
    const { input } = setup();
    paste(input, lines(12));
    input.setSelectionRange(5, 5);
    input.dispatchEvent(new MouseEvent('click'));
    expect(document.querySelector('.paste-view')).not.toBeNull();
  });

  it('folds a message that did not go back into its marker', () => {
    const { box, input } = setup();
    const long = lines(25);
    paste(input, long);
    const sent = `/queue ${box.text()}`;
    input.value = '';
    box.sync();
    expect(box.el.classList.contains('hidden')).toBe(true);
    box.restore(sent);
    expect(input.value).toBe('/queue [Pasted text #1 · 25 lines]');
    expect(box.el.classList.contains('hidden')).toBe(false);
    // a second paste gets its own number
    input.setSelectionRange(input.value.length, input.value.length);
    paste(input, lines(40));
    expect(input.value).toContain('[Pasted text #2 · 40 lines]');
  });
});
