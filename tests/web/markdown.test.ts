// @vitest-environment jsdom
// DOMPurify (the sanitizer) officially supports jsdom, so the real sanitizing path runs here.
import { describe, expect, it } from 'vitest';
import { md } from '../../web/core.ts';

describe('md() on agent output', () => {
  it('renders markdown', () => {
    const el = md('**bold** and `code`');
    expect(el.querySelector('strong')?.textContent).toBe('bold');
    expect(el.querySelector('code')?.textContent).toBe('code');
  });

  it('removes scripts and inline event handlers', () => {
    const el = md('hello <script>alert(1)</script><img src="x" onerror="alert(2)">');
    expect(el.querySelector('script')).toBeNull();
    expect(el.innerHTML).not.toContain('onerror');
    expect(el.textContent).toContain('hello');
  });

  it('opens links in a new tab without giving the page access to the dashboard', () => {
    const a = md('[site](https://example.com)').querySelector('a')!;
    expect(a.target).toBe('_blank');
    expect(a.rel).toBe('noopener');
  });

  it('drops javascript: links', () => {
    const a = md('[x](javascript:alert(1))').querySelector('a');
    expect(a?.getAttribute('href') ?? '').not.toMatch(/javascript:/i);
  });
});
