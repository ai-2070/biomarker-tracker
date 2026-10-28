import { describe, expect, it } from 'vitest';
import { craftApp, craftColor, craftIcon } from '../../web/crafticons.ts';

describe('craft app icons', () => {
  it('finds the app in MCP server and connector names', () => {
    expect(craftApp('photocraft')).toBe('photocraft');
    expect(craftApp('VectorCraft')).toBe('vectorcraft');
    expect(craftApp('storytold-figcraft')).toBe('figcraft');
    expect(craftApp('storytoldpdfcraft')).toBe('pdfcraft');
    expect(craftApp('photocraft-mcp')).toBe('photocraft');
  });

  it('leaves other names alone', () => {
    for (const name of ['codegraph', 'figwright', 'minecraft', 'craft', '', null, undefined]) {
      expect(craftApp(name)).toBeNull();
      expect(craftIcon(name)).toBeNull();
      expect(craftColor(name)).toBeNull();
    }
  });

  it('gives an image from the bundled icons and a matching color', () => {
    const img = craftIcon('photocraft', 18)!;
    expect(img.tagName).toBe('IMG');
    expect(img.getAttribute('src')).toBe('/craft-icons/photocraft.png');
    expect(img.width).toBe(18);
    expect(craftColor('photocraft')).toMatch(/^#[0-9a-f]{6}$/);
  });
});
