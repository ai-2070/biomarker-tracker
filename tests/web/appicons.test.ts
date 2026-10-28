import { describe, expect, it } from 'vitest';
import { appIcon, appIconUrl } from '../../web/appicons.ts';
import { appLogo, mark } from '../../web/views/stationdata.ts';

describe('program icons', () => {
  it('finds ComfyUI in program, MCP server and connector names', () => {
    for (const name of ['comfyui', 'ComfyUI', 'comfyui-mcp', 'mcp_ComfyUI']) expect(appIconUrl(name)).toBe('/app-icons/comfyui.png');
  });

  it('leaves other names alone', () => {
    for (const name of ['comfy', 'blender', 'photocraft', '', null, undefined]) {
      expect(appIconUrl(name)).toBeNull();
      expect(appIcon(name)).toBeNull();
    }
  });

  it('gives an image from the bundled icons', () => {
    const img = appIcon('comfyui', 14)!;
    expect(img.tagName).toBe('IMG');
    expect(img.getAttribute('src')).toBe('/app-icons/comfyui.png');
    expect(img.width).toBe(14);
    expect(img.className).toBe('app-icon');
  });

  it('is what the Station shows for ComfyUI instead of the glyph', () => {
    expect((appLogo('comfyui', 14) as HTMLImageElement).getAttribute('src')).toBe('/app-icons/comfyui.png');
    const m = mark('comfyui', 11);
    expect(typeof m).not.toBe('string');
    expect((m as HTMLImageElement).getAttribute('src')).toBe('/app-icons/comfyui.png');
  });

  it('finds LM Studio by its program id and its name, and the Station uses it', () => {
    for (const name of ['lmstudio', 'LM Studio', 'lm-studio']) expect(appIconUrl(name)).toBe('/app-icons/lmstudio.png');
    expect((mark('lmstudio', 15) as HTMLImageElement).getAttribute('src')).toBe('/app-icons/lmstudio.png');
  });

  it('still prefers a brand logo when there is one', () => {
    expect((appLogo('blender', 14) as Element).tagName.toLowerCase()).toBe('svg');
  });
});
