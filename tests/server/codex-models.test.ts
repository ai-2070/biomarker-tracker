// Codex's models come from Codex itself (`codex debug models`, or the catalog it keeps), not a fixed list.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FALLBACK_MODELS, clearModelsCache, listModels, parseModels } from '../../server/engines/codex.ts';
import { availableModels, clearModelCache, codexModelList } from '../../server/models.ts';
import { clearWhichCache } from '../../server/util.ts';

// the shape Codex 0.163 prints (trimmed)
const catalog = {
  models: [
    { slug: 'gpt-6-astra', display_name: 'GPT-6-Astra', description: 'Frontier intelligence.', visibility: 'list', priority: 2 },
    { slug: 'codex-auto-review', display_name: 'Codex Auto Review', visibility: 'hide', priority: 43 },
    { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1-Sol', description: 'Latest workhorse.', visibility: 'list', priority: 1 },
    { slug: 'gpt-6-luna', visibility: 'list', priority: 5 },
  ],
};
const ids = (ms: { id: string }[]) => ms.map((m) => m.id);

describe('parseModels', () => {
  it("keeps the listed models in Codex's order, without the hidden ones", () => {
    expect(parseModels(JSON.stringify(catalog))).toEqual([
      { id: 'gpt-6.1-sol', name: 'GPT-6.1-Sol', description: 'Latest workhorse.' },
      { id: 'gpt-6-astra', name: 'GPT-6-Astra', description: 'Frontier intelligence.' },
      { id: 'gpt-6-luna', name: 'gpt-6-luna' },
    ]);
  });
  it('gives nothing for output that is not a catalog', () => {
    expect(parseModels('')).toEqual([]);
    expect(parseModels('error: unknown command')).toEqual([]);
    expect(parseModels('{"models": "nope"}')).toEqual([]);
    expect(parseModels('{"models": [null, {"slug": 3}]}')).toEqual([]);
  });
});

describe('listModels', () => {
  let bin = '';
  let codexHome = '';
  let oldPath = '';
  let oldHome: string | undefined;
  beforeEach(() => {
    bin = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-codex-models-'));
    codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-codex-home-'));
    oldPath = process.env.PATH || '';
    oldHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;
    clearModelsCache();
    clearModelCache();
  });
  afterEach(() => {
    process.env.PATH = oldPath;
    if (oldHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = oldHome;
    clearWhichCache();
    clearModelsCache();
    clearModelCache();
    fs.rmSync(bin, { recursive: true, force: true });
    fs.rmSync(codexHome, { recursive: true, force: true });
  });
  // a stand-in codex: `codex debug models` prints the file's contents, or fails (an older Codex)
  const fakeCodex = (out: string | null) => {
    const file = path.join(bin, 'catalog.json');
    if (out !== null) fs.writeFileSync(file, out);
    const sh = out === null ? 'echo "unknown command" >&2; exit 2' : `cat "${file}"`;
    const cmd = out === null ? 'echo unknown command 1>&2\r\nexit /b 2' : `type "${file}"`;
    fs.writeFileSync(path.join(bin, 'codex'), `#!/bin/sh\n${sh}\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'codex.cmd'), `@echo off\r\n${cmd}\r\n`);
    process.env.PATH = `${bin}${path.delimiter}${oldPath}`;
    clearWhichCache();
  };

  it('asks Codex for its catalog', async () => {
    fakeCodex(JSON.stringify(catalog));
    expect(ids(await listModels())).toEqual(['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-luna']);
    // the picker gets Codex's default first
    expect(ids(await codexModelList())).toEqual(['', 'gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-luna']);
    // and the Brain's find_models sees them, with what each is for
    expect(await availableModels('codex')).toContainEqual({ id: 'gpt-6.1-sol', name: 'GPT-6.1-Sol', note: 'Latest workhorse.' });
  });

  it("reads the catalog Codex keeps when it can't print one", async () => {
    fakeCodex(null);
    fs.writeFileSync(path.join(codexHome, 'models_cache.json'), JSON.stringify({ fetched_at: '2026-10-28T06:00:12Z', ...catalog }));
    expect(ids(await listModels())).toEqual(['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-luna']);
  });

  it('falls back to the built-in list when Codex is not installed', async () => {
    process.env.PATH = bin;
    clearWhichCache();
    expect(await listModels()).toEqual(FALLBACK_MODELS);
  });
});
