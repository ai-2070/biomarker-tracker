# App icons

Logos for programs that Simple Icons doesn't have and that aren't Craft apps (those are in
`public/craft-icons`). `web/appicons.ts` picks them, and `appLogo` in `web/views/stationdata.ts`
falls back to them after the Simple Icons logos and the Craft app icons.

| File | Source |
|---|---|
| `comfyui.png` | The ComfyUI Desktop app's icon (`assets/Comfy_Logo_x256.png` in its `resources/app.asar`): the yellow mark cut out of its dark square onto a clear background, 96 × 96. |
| `lmstudio.png` | LM Studio's own one-colour tray mark (`resources/trayIconDarkTemplate@3x.png` in its install folder), filled with the light end of its app icon's purple (`#6a72ed`), 66 × 66. |

The ComfyUI name and logo belong to Comfy Org, and the LM Studio name and logo to Element Labs; they
are shown here only to say which program is meant. Refresh from the same files; never redraw them.
