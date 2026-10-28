// The attachment tray's upload queue, with fake requests: limits, failures, files added mid-send, retries.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachTray, restoreDraft, MAX_ATTACHMENTS } from '../../web/attach.ts';
import type { PickedFile } from '../../web/attach.ts';

class FakeXHR {
  static all: FakeXHR[] = [];
  upload: { onprogress: ((e: { loaded: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 0;
  responseText = '';
  url = '';
  finished = false;
  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader() {}
  send() {
    FakeXHR.all.push(this);
  }
  get rel() {
    return decodeURIComponent(this.url.split('path=')[1]);
  }
  abort() {
    this.finished = true;
    this.onabort?.();
  }
  ok() {
    const rel = this.rel;
    const folder = rel.includes('/');
    this.finished = true;
    this.status = 200;
    this.responseText = JSON.stringify({ path: `/up/${rel}`, top: folder ? `/up/${rel.split('/')[0]}/` : `/up/${rel}`, kind: folder ? 'folder' : 'file', name: rel, size: 1 });
    this.onload?.();
  }
  fail(error = 'disk full') {
    this.finished = true;
    this.status = 500;
    this.responseText = JSON.stringify({ error });
    this.onload?.();
  }
}
const open = () => FakeXHR.all.filter((x) => !x.finished);
const deleted: string[] = [];
const flush = async (n = 8) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};
const files = (...rels: string[]): PickedFile[] => rels.map((rel) => ({ rel, file: new File(['x'], rel.split('/').pop()!) }));
// finish every request, including ones that start as others end
const finishAll = async () => {
  for (let i = 0, idle = 0; i < 100 && idle < 2; i++) {
    await flush();
    idle = open().length ? 0 : idle + 1;
    open().forEach((x) => x.ok());
  }
};

beforeEach(() => {
  FakeXHR.all = [];
  deleted.length = 0;
  vi.stubGlobal('XMLHttpRequest', FakeXHR);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (init.method === 'DELETE') deleted.push(decodeURIComponent(url.split('path=')[1]));
      return new Response(JSON.stringify(init.method === 'POST' ? { batch: 'b1' } : { ok: true }));
    }),
  );
  document.body.innerHTML = '<div id="toasts"></div>';
});
afterEach(() => vi.unstubAllGlobals());

describe('attachTray()', () => {
  it('uploads at most 4 files at once, across every chip', async () => {
    const tray = attachTray();
    tray.add(files(...Array.from({ length: 10 }, (_, i) => `f${i}.txt`)));
    await flush();
    expect(open()).toHaveLength(4);
    await finishAll();
    expect(await tray.ready()).toHaveLength(10);
  });

  it('stops a folder at its first failure, and only reports once the running uploads end', async () => {
    const tray = attachTray();
    tray.add(files(...Array.from({ length: 8 }, (_, i) => `docs/f${i}.md`)));
    await flush();
    let result: string[] | null | undefined;
    const req = tray.ready().then((r) => (result = r));
    open()[0].ok(); // one arrives: the folder now has a saved path
    open()[0].fail();
    await flush();
    // nothing new started after the failure, and the answer waits for the two still going
    expect(FakeXHR.all).toHaveLength(4);
    expect(open()).toHaveLength(2);
    expect(result).toBeUndefined();
    open().forEach((x) => x.ok());
    await req;
    expect(result).toBeNull();
    expect(FakeXHR.all).toHaveLength(4);
  });

  it('removing a failed folder deletes what did arrive', async () => {
    const tray = attachTray();
    tray.add(files('docs/a.md', 'docs/b.md'));
    await flush();
    FakeXHR.all[0].ok();
    FakeXHR.all[1].fail();
    await flush();
    await new Promise((r) => requestAnimationFrame(r));
    (tray.el.querySelector('.att-chip.error .att-x') as HTMLButtonElement).click();
    expect(deleted).toEqual(['/up/docs/']);
  });

  it('tries failed ones again on the next send', async () => {
    const tray = attachTray();
    tray.add(files('a.txt'));
    await flush();
    FakeXHR.all[0].fail();
    await flush();
    const again = tray.ready();
    await flush();
    expect(FakeXHR.all).toHaveLength(2);
    FakeXHR.all[1].ok();
    expect(await again).toEqual(['/up/a.txt']);
  });

  it('waits for files added while it waits, and take() takes only finished ones', async () => {
    const tray = attachTray();
    tray.add(files('a.txt'));
    await flush();
    const req = tray.ready();
    tray.add(files('b.txt'));
    await flush();
    open().find((x) => x.rel === 'a.txt')!.ok();
    await flush();
    let done = false;
    void req.then(() => (done = true));
    await flush();
    expect(done).toBe(false);
    await finishAll();
    expect(await req).toEqual(['/up/a.txt', '/up/b.txt']);
    tray.add(files('c.txt'));
    expect(tray.take()).toHaveLength(2);
    expect(tray.count()).toBe(1);
  });

  it('a deferred tray uploads on ready(), including files added meanwhile', async () => {
    const tray = attachTray({ deferred: true });
    tray.add(files('a.txt'));
    await flush();
    expect(FakeXHR.all).toHaveLength(0);
    const req = tray.ready();
    tray.add(files('b.txt'));
    await finishAll();
    expect(await req).toEqual(['/up/a.txt', '/up/b.txt']);
  });

  it(`takes at most ${MAX_ATTACHMENTS} files or folders`, async () => {
    const tray = attachTray({ deferred: true });
    tray.add(files(...Array.from({ length: MAX_ATTACHMENTS + 10 }, (_, i) => `f${i}.txt`)));
    expect(tray.count()).toBe(MAX_ATTACHMENTS);
    await flush(); // toasts draw right after the current work
    expect(document.getElementById('toasts')!.textContent).toContain(`${MAX_ATTACHMENTS} files or folders`);
  });
});

describe('pasting into a chat', () => {
  const paste = (target: HTMLElement, data: DataTransfer) => {
    const e = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'clipboardData', { value: data });
    target.dispatchEvent(e);
    return e;
  };
  const clip = (text: Record<string, string>, list: File[]) =>
    ({ types: [...Object.keys(text), ...(list.length ? ['Files'] : [])], items: list.map((f) => ({ kind: 'file', getAsFile: () => f })), files: list, getData: (t: string) => text[t] ?? '' }) as unknown as DataTransfer;

  it('attaches a screenshot pasted into the message box, and stops it pasting as text', async () => {
    const tray = attachTray();
    const zone = document.createElement('div');
    const input = document.createElement('textarea');
    zone.append(input);
    document.body.append(zone);
    const stop = tray.dropZone(zone);
    const e = paste(input, clip({}, [new File(['x'], 'image.png', { type: 'image/png' })]));
    expect(e.defaultPrevented).toBe(true);
    await flush();
    expect(tray.count()).toBe(1);
    expect(open().map((x) => x.rel)).toEqual(['pasted-image.png']);
    // plain text is left alone, and a stopped zone takes nothing
    expect(paste(input, clip({ 'text/plain': 'hi' }, [])).defaultPrevented).toBe(false);
    stop();
    expect(paste(input, clip({}, [new File(['x'], 'b.txt')])).defaultPrevented).toBe(false);
    await flush();
    expect(tray.count()).toBe(1);
  });
});

describe('restoreDraft()', () => {
  it('puts the text back without losing what was typed since', () => {
    const input = document.createElement('textarea');
    restoreDraft(input, 'hello');
    expect(input.value).toBe('hello');
    input.value = 'and more';
    restoreDraft(input, 'hello');
    expect(input.value).toBe('hello\nand more');
    restoreDraft(input, 'hello');
    expect(input.value).toBe('hello\nand more');
  });
});
