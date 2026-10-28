// The History window's line diff, and Recently deleted when a list can't load.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { diffLines, openDeleted } from '../../web/history.ts';

describe('diffLines', () => {
  it('marks lines kept, removed and added', () => {
    expect(diffLines('a\nb\nc', 'a\nc\nd')).toEqual([
      { op: ' ', text: 'a' },
      { op: '-', text: 'b' },
      { op: ' ', text: 'c' },
      { op: '+', text: 'd' },
    ]);
    expect(diffLines('same', 'same')).toEqual([{ op: ' ', text: 'same' }]);
  });
});

describe('Recently deleted', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="toasts"></div><div id="modal-root"></div>';
  });

  it("says a list couldn't load instead of \"Nothing deleted\", and can try again", async () => {
    let skillsFail = true;
    vi.stubGlobal('fetch', async (url: string) => {
      if (String(url).includes('/versions/skill') && skillsFail) return new Response(JSON.stringify({ error: 'disk on fire' }), { status: 500 });
      return new Response('[]', { status: 200 });
    });
    await openDeleted(['skill', 'agent']);
    const modal = document.querySelector('#modal-root')!;
    expect(modal.textContent).toContain("Couldn't load the deleted skills");
    expect(modal.textContent).not.toContain('Nothing deleted.');
    skillsFail = false;
    (Array.from(modal.querySelectorAll('button')).find((b) => b.textContent?.includes('Retry')) as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 10));
    expect(modal.textContent).toContain('Nothing deleted.');
    expect(modal.textContent).not.toContain("Couldn't load");
  });
});
