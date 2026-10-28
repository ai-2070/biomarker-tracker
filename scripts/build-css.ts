// The page's stylesheet: Tailwind reads web/styles/app.css, finds the class names used in web/ and
// public/index.html, and writes only what they need. Used by build-web.ts (and its test); plain Node.
import fs from 'node:fs';
import path from 'node:path';
import { compile, optimize } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';

export const CSS_ENTRY = path.resolve(import.meta.dirname, '..', 'web', 'styles', 'app.css');

export async function buildCss({ minify = true }: { minify?: boolean } = {}): Promise<string> {
  const compiler = await compile(fs.readFileSync(CSS_ENTRY, 'utf8'), { base: path.dirname(CSS_ENTRY), onDependency: () => {} });
  const sources = compiler.sources.map((s) => ({ base: s.base, pattern: s.pattern, negated: s.negated }));
  const css = compiler.build(new Scanner({ sources }).scan());
  return optimize(css, { file: CSS_ENTRY, minify }).code;
}
