// Images a tool call returned: read from each engine's tool results, saved next to the chat as files
// (the chat keeps their links), shown by /api/file, and gone with the chat.
import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { keepToolImages, splitContent, toolImagesDir } from '../../server/toolimages.ts';
import { chats } from '../../server/store.ts';
import { viewable } from '../../server/files.ts';
import { newAgent } from '../../server/library.ts';
import { startRun } from '../../server/engines/index.ts';
import type { ChatItem } from '../../shared/types.ts';

// a fake Claude Code that reads a picture
vi.mock('../../server/engines/claude.ts', async (orig) => ({
  ...(await orig<typeof import('../../server/engines/claude.ts')>()),
  run: async ({ onEvent }: { onEvent: (e: unknown) => void }) => {
    onEvent({ kind: 'tool', id: 't1', name: 'Read', args: { file_path: 'shots/a.png' } });
    onEvent({ kind: 'tool_result', id: 't1', text: '', images: [`data:image/png;base64,${PNG}`] });
    onEvent({ kind: 'text', text: 'Looks fine.' });
    return { text: 'Looks fine.' };
  },
}));

// a 1×1 PNG
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const pathOf = (url: string) => decodeURIComponent(url.replace('/api/file?path=', ''));

describe('splitContent', () => {
  it("reads MCP's and pi's images, Claude's base64 sources, and the text around them", () => {
    const r = splitContent([
      { type: 'text', text: 'Read image file [image/png]' },
      { type: 'image', data: PNG, mimeType: 'image/png' },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: PNG } },
      { type: 'image', source: { type: 'url', url: 'https://x' } },
      { type: 'image', data: 'abc', mimeType: 'image/svg+xml' },
      { type: 'resource', uri: 'file:///a' },
    ]);
    expect(r.text).toBe('Read image file [image/png]\n[image]\n[image]\n[resource]');
    expect(r.images).toEqual([`data:image/png;base64,${PNG}`, `data:image/jpeg;base64,${PNG}`]);
    expect(splitContent('plain')).toEqual({ text: 'plain', images: [] });
  });
});

describe('keepToolImages', () => {
  it('saves data: images next to the chat, once per picture, and keeps other links as they are', () => {
    const urls = keepToolImages('agent-1', 'chat-1', [`data:image/png;base64,${PNG}`, `data:image/png;base64,${PNG}`, '/api/comfyui/view?f=1', 'data:text/html;base64,PGI+', 'data:image/png;base64,']);
    expect(urls).toHaveLength(3);
    expect(urls[0]).toBe(urls[1]);
    expect(urls[2]).toBe('/api/comfyui/view?f=1');
    const file = pathOf(urls[0]);
    expect(file.startsWith(toolImagesDir('agent-1', 'chat-1'))).toBe(true);
    expect(fs.readFileSync(file).equals(Buffer.from(PNG, 'base64'))).toBe(true);
    expect(fs.readdirSync(toolImagesDir('agent-1', 'chat-1'))).toHaveLength(1);
    // the browser may show it
    expect(viewable(file)).toBeTruthy();
  });

  it('an unsafe id saves nothing', () => {
    expect(keepToolImages('../x', 'c', [`data:image/png;base64,${PNG}`, 'https://a/b.png'])).toEqual(['https://a/b.png']);
  });

  it('deleting the chat deletes its images', () => {
    const chat = chats.create('agent-2');
    const [url] = keepToolImages('agent-2', chat.id, [`data:image/png;base64,${PNG}`]);
    expect(fs.existsSync(pathOf(url))).toBe(true);
    chats.remove('agent-2', chat.id);
    expect(fs.existsSync(toolImagesDir('agent-2', chat.id))).toBe(false);
  });
});

describe('during a run', () => {
  it("a tool call's picture is saved as a file and the chat keeps its link", async () => {
    const a = newAgent({ name: 'Viewer', engine: 'claude-code', toolGroups: [] });
    const chat = chats.create(a.id);
    await startRun(a, chat, 'check the screenshot').promise;
    const tool = chats.get(a.id, chat.id)!.items.find((i): i is Extract<ChatItem, { type: 'tool' }> => i.type === 'tool')!;
    expect(tool.images).toHaveLength(1);
    expect(tool.images![0]).toMatch(/^\/api\/file\?path=/);
    expect(fs.readFileSync(pathOf(tool.images![0])).equals(Buffer.from(PNG, 'base64'))).toBe(true);
  });
});
