// Logos for programs that Simple Icons doesn't have and that aren't Craft apps (public/app-icons,
// see its README). appLogo in views/stationdata.ts falls back to them.
const APP_ICONS: Record<string, string> = {
  comfyui: '/app-icons/comfyui.png',
  lmstudio: '/app-icons/lmstudio.png',
};

// The icon for a program, MCP server or connector name ("comfyui", "ComfyUI", "comfyui-mcp"), or null.
export function appIconUrl(name: string | null | undefined): string | null {
  const n = String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const key = Object.keys(APP_ICONS).find((k) => n.includes(k));
  return key ? APP_ICONS[key] : null;
}

// The icon as an <img>, or null when there isn't one.
export function appIcon(name: string | null | undefined, size = 16): HTMLImageElement | null {
  const src = appIconUrl(name);
  if (!src) return null;
  const img = document.createElement('img');
  img.src = src;
  img.width = size;
  img.height = size;
  img.alt = '';
  img.className = 'app-icon';
  img.draggable = false;
  return img;
}

// The same icon as a loaded image for drawing on a canvas (the Station's desk monitors). Null until it
// has loaded; `onLoad` runs once when it arrives, so the caller can draw again.
const loaded = new Map<string, HTMLImageElement>();
export function appIconImage(name: string | null | undefined, onLoad?: () => void): HTMLImageElement | null {
  const src = appIconUrl(name);
  if (!src) return null;
  let img = loaded.get(src);
  if (!img) {
    img = new Image();
    img.src = src;
    loaded.set(src, img);
  }
  if (img.complete && img.naturalWidth) return img;
  if (onLoad) img.addEventListener('load', onLoad, { once: true });
  return null;
}
