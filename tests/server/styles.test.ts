// The page's Tailwind stylesheet builds, class names in web/ are written so Tailwind can see them, and the
// fonts come with the page.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCss, CSS_ENTRY } from '../../scripts/build-css.ts';
import { buildFonts, FONTS } from '../../scripts/build-fonts.ts';
import { CHAT_FONTS } from '../../shared/look.ts';

const WEB = path.resolve(import.meta.dirname, '../../web');
const sources = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.tsx?$/.test(e.name) ? [p] : [];
  });

describe('the stylesheet', () => {
  it('builds with the theme, the shared pieces and the utilities the page uses', async () => {
    const css = await buildCss({ minify: false });
    // tokens look.ts swaps at runtime
    expect(css).toContain('--color-accent:');
    expect(css).toContain('--color-on-accent:');
    // a shared piece, Markdown defaults, a utility found in web/
    expect(css).toMatch(/\.btn\s*\{/);
    expect(css).toContain(':where(.md)');
    expect(css).toMatch(/\.text-dim\s*\{/);
    // the hidden class beats display utilities
    expect(css).toMatch(/\.hidden\s*\{[^}]*display:\s*none\s*!important/);
  }, 60_000);

  it('has no class names built from pieces (Tailwind reads the source text)', () => {
    // e.g. `bg-${color}`: the finished name never appears in the source, so no CSS is made for it
    const piece = /['"`\s](bg|text|border|ring|fill|stroke|shadow|from|to|via|w|h|min-w|max-w|min-h|max-h|p[xytrbl]|m[xytrbl]|gap|grid-cols|col-span|row-span|rounded|opacity|z|top|left|right|bottom|inset|translate-[xy]|font|leading|tracking)-\$\{/;
    const found: string[] = [];
    for (const file of sources(WEB)) {
      fs.readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/^\s*(\/\/|\*)/.test(line)) return;
          if (piece.test(line)) found.push(`${path.relative(WEB, file)}:${i + 1}`);
        });
    }
    expect(found).toEqual([]);
  });

  it('has no utilities glued to a following ${…} (Tailwind would skip them)', async () => {
    // `flex${on ? ' x' : ''}` reads as one word with the expression, so "flex" gets no CSS: put a space before ${
    const { __unstable__loadDesignSystem } = await import('@tailwindcss/node');
    const theme = fs.readFileSync(CSS_ENTRY, 'utf8').replace(/@import '\.\/(base|components)[^;]*;/g, '');
    const ds = await __unstable__loadDesignSystem(theme, { base: path.dirname(CSS_ENTRY) });
    const found: string[] = [];
    for (const file of sources(WEB)) {
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(/([^\s`'"{}]+)\$\{/g)) {
        if (ds.candidatesToCss([m[1]])[0]) found.push(`${path.relative(WEB, file)}:${src.slice(0, m.index).split('\n').length} ${m[1]}`);
      }
    }
    expect(found).toEqual([]);
  }, 60_000);
});

describe('the fonts', () => {
  it('come with the page: every file the rules name is copied next to them', () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'fonts-'));
    try {
      const css = buildFonts(out);
      for (const f of FONTS) expect(css).toContain(`font-family: '${f.family}'`);
      expect(css).toContain('font-style: italic');
      expect(css).not.toMatch(/https?:/);
      const urls = [...css.matchAll(/url\(\.\/(fonts\/[\w.-]+)\)/g)].map((m) => m[1] ?? '');
      expect(urls.length).toBeGreaterThan(0);
      for (const u of urls) expect(fs.existsSync(path.join(out, u))).toBe(true);
      expect(fs.existsSync(path.join(out, 'fonts', 'archivo-LICENSE.txt'))).toBe(true);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  it('include every chat font Settings > Look offers (other than ones on the computer)', () => {
    const onComputer = new Set(['Segoe UI', 'SF Pro Text', 'Georgia', 'Times New Roman', 'Helvetica', 'Arial', 'Menlo', 'Consolas']);
    const shipped = new Set(FONTS.map((f) => f.family));
    const named = CHAT_FONTS.flatMap((f) => [...f.stack.matchAll(/'([^']+)'/g)].map((m) => m[1] ?? ''));
    expect(named.filter((n) => !onComputer.has(n) && !shipped.has(n))).toEqual([]);
    for (const n of ['Google Sans', 'Roboto', 'Inter']) expect(shipped).toContain(n);
  });

  it('are not fetched from outside', () => {
    const html = fs.readFileSync(path.resolve(import.meta.dirname, '../../public/index.html'), 'utf8');
    expect(html).not.toContain('fonts.googleapis.com');
  });
});
