// Codex installed with npm (a codex.cmd shim on Windows) starts a chat, and a failed turn is a failure
// even when Codex said something first.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clearWhichCache, shimTarget } from '../../server/util.ts';
import { newAgent } from '../../server/library.ts';
import { chats } from '../../server/store.ts';
import { startRun } from '../../server/engines/index.ts';
import type { Chat } from '../../shared/types.ts';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-codex.js');
// what npm writes for a package's command on Windows (cmd-shim)
const npmShim = (rel: string) =>
  `@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${rel}" %*\r\n`;

let bin = '';
let oldPath = '';
beforeAll(() => {
  bin = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-npm-codex-'));
  const pkg = path.join(bin, 'node_modules', '@openai', 'codex', 'bin');
  fs.mkdirSync(pkg, { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(pkg, 'codex.js'));
  fs.writeFileSync(path.join(bin, 'codex.cmd'), npmShim('node_modules\\@openai\\codex\\bin\\codex.js'));
  fs.writeFileSync(path.join(bin, 'codex'), `#!/bin/sh\nexec "${process.execPath}" "${path.join(pkg, 'codex.js')}" "$@"\n`, { mode: 0o755 });
  oldPath = process.env.PATH || '';
  process.env.PATH = `${bin}${path.delimiter}${oldPath}`;
  clearWhichCache();
});
afterAll(() => {
  process.env.PATH = oldPath;
  delete process.env.FAKE_CODEX_MODE;
  clearWhichCache();
  fs.rmSync(bin, { recursive: true, force: true });
});

const ask = async () => {
  const agent = newAgent({ name: 'Coder', engine: 'codex', toolGroups: [] });
  const chat = chats.create(agent.id, 'Test');
  await startRun(agent, chat, 'Fix it', { depth: 0 }).promise;
  return chats.get(agent.id, chat.id) as Chat;
};

describe('npm-installed Codex', () => {
  it('reads the package script out of the npm shim', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-shim-'));
    try {
      fs.mkdirSync(path.join(dir, 'node_modules', 'x', 'bin'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'node_modules', 'x', 'bin', 'x.js'), '');
      fs.writeFileSync(path.join(dir, 'node.exe'), '');
      fs.writeFileSync(path.join(dir, 'x.cmd'), npmShim('node_modules\\x\\bin\\x.js'));
      expect(shimTarget(path.join(dir, 'x.cmd'))).toEqual({ command: path.join(dir, 'node.exe'), args: [path.join(dir, 'node_modules', 'x', 'bin', 'x.js')] });
      // any other .cmd is no shim
      fs.writeFileSync(path.join(dir, 'y.cmd'), '@echo off\r\necho hi\r\n');
      expect(shimTarget(path.join(dir, 'y.cmd'))).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('starts a chat with its quoted settings whole', async () => {
    delete process.env.FAKE_CODEX_MODE;
    const chat = await ask();
    expect(chat.items.find((i) => i.type === 'error')).toBeUndefined();
    expect(chat.items.findLast((i) => i.type === 'assistant')).toMatchObject({ text: 'quoted:true' });
  });

  it('a turn that failed after saying something is not an answer', async () => {
    process.env.FAKE_CODEX_MODE = 'fail';
    const chat = await ask();
    expect(chat.items.at(-1)).toMatchObject({ type: 'error', text: expect.stringContaining('stream disconnected') });
  });
});
