// Settings > Look: UI scale, accent colour, animations, chat font, Station quality. Changes apply right away and are saved a moment later.
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import { Slider } from '@base-ui/react/slider';
import { PUT, attempt, state } from '../core.ts';
import { ACCENTS, CHAT_FONTS, DEFAULT_LOOK, STATION_QUALITY, applyLook, stationLevel } from '../look.ts';
import { Segmented } from '../ui/controls.tsx';
import { reactPage } from '../ui/react.tsx';
import type { LookSetting } from '../../shared/types.ts';

const SCALES = [80, 90, 100, 110, 125, 150];
const SAVE_AFTER = 350;
// an accent colour to pick, in its own colour (--sw); on: the picked one
const SWATCH = 'flex cursor-pointer items-center gap-2.25 rounded-box border border-line bg-none px-3 py-2.5 text-ink transition-[border-color,background] duration-150 ease-[ease] hover:border-(--sw) [&.on]:border-(--sw) [&.on]:bg-[color-mix(in_srgb,var(--sw)_12%,transparent)]';
// a chat font to pick: its name in that font, and whose look it matches
const FONT = 'look-font flex cursor-pointer flex-col items-start gap-0.5 rounded-box border border-line bg-none px-3 py-2.5 text-left text-ink transition-[border-color,background] duration-150 ease-[ease] hover:border-line-2 [&.on]:border-accent [&.on]:bg-accent/8';

export function LookTab() {
  const [look, setLook] = useState<LookSetting>(() => ({ ...DEFAULT_LOOK, ...(state.data?.settings?.look || {}) }));
  // the scale while dragging: shown and applied live, saved when let go
  const [dragging, setDragging] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // the change waiting to be saved: leaving the tab saves it now rather than dropping it
  const unsaved = useRef<LookSetting | null>(null);
  const save = () => {
    clearTimeout(timer.current ?? undefined);
    timer.current = null;
    const next = unsaved.current;
    unsaved.current = null;
    if (!next) return;
    void attempt(() => PUT('/settings', { look: next })).then((r) => {
      if (r && state.data?.settings) state.data.settings.look = { ...next };
    });
  };
  useEffect(() => save, []);

  const set = (patch: Partial<LookSetting>) => {
    const next = { ...look, ...patch };
    setLook(next);
    setDragging(null);
    applyLook(next);
    unsaved.current = next;
    clearTimeout(timer.current ?? undefined);
    timer.current = setTimeout(save, SAVE_AFTER);
  };
  const scale = dragging ?? look.scale;

  return (
    <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] items-start gap-4 max-lg:grid-cols-1">
      <div className="flex flex-col gap-2.5">
        <div className="panel">
          <div className="panel-head">
            <h2>UI scale</h2>
          </div>
          <p className="hint">Makes everything bigger or smaller: text, buttons, panels and the Station. Your browser zoom (Ctrl + / Ctrl −) still works on top of this.</p>
          <div className="mt-3.5 flex items-center gap-3">
            <span className="hint" aria-hidden="true">A</span>
            <Slider.Root
              className="flex-1"
              min={70}
              max={160}
              step={5}
              value={scale}
              format={{ style: 'unit', unit: 'percent', maximumFractionDigits: 0 }}
              onValueChange={(v) => {
                const n = Array.isArray(v) ? v[0] : v;
                setDragging(n);
                applyLook({ ...look, scale: n });
              }}
              onValueCommitted={(v) => set({ scale: Array.isArray(v) ? v[0] : v })}
            >
              <Slider.Control className="flex h-5.5 cursor-pointer touch-none items-center">
                <Slider.Track className="relative h-1 flex-1 rounded-[2px] bg-line-2">
                  <Slider.Indicator className="rounded-[2px] bg-accent" />
                  <Slider.Thumb className="size-4 rounded-full bg-accent shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_25%,transparent)] has-focus-visible:outline has-focus-visible:outline-offset-3 has-focus-visible:outline-accent" aria-label="UI scale" />
                </Slider.Track>
              </Slider.Control>
            </Slider.Root>
            <span className="text-[20px] text-dim" aria-hidden="true">A</span>
            <b className="look-pct min-w-13 text-right font-mono text-[15px] leading-[normal] font-semibold text-accent">{`${scale}%`}</b>
          </div>
          <div className="look-presets mt-3.5 flex flex-wrap items-center gap-1.5">
            {SCALES.map((v) => (
              <button key={v} className={`btn tiny${look.scale === v ? '' : ' ghost'}`} aria-pressed={look.scale === v} onClick={() => set({ scale: v })}>
                {v === 100 ? '100% (default)' : `${v}%`}
              </button>
            ))}
          </div>
        </div>
        <div className="panel">
          <div className="panel-head">
            <h2>Animations</h2>
          </div>
          <p className="hint">Panels sliding in, glows and pulses. Reduced keeps the Station moving but turns off most interface motion.</p>
          <div className="field mt-3.5">
            <span id="look-motion">Motion</span>
            <Segmented
              label="Motion"
              options={[
                { value: 'full', label: 'Full' },
                { value: 'reduced', label: 'Reduced' },
              ]}
              value={look.motion}
              onChange={(v) => set({ motion: v })}
            />
          </div>
        </div>
        <div className="panel">
          <div className="panel-head">
            <h2 id="look-chat-font">Chat font</h2>
          </div>
          <p className="hint">What the messages in chats are written in: yours, your agents’ and the Brain’s. Names, buttons and code keep their own fonts.</p>
          <RadioGroup className="mt-3.5 grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2" aria-labelledby="look-chat-font" value={look.chatFont} onValueChange={(v) => set({ chatFont: String(v) })}>
            {CHAT_FONTS.map((f) => (
              <Radio.Root key={f.id} value={f.id} nativeButton render={<button type="button" />} className={(s) => (s.checked ? `${FONT} on` : FONT)}>
                <span className="text-[15px] leading-[1.4]" style={{ fontFamily: f.stack }}>{f.label}</span>
                <span className="text-[12px] leading-[1.4] text-dim">{f.like}</span>
              </Radio.Root>
            ))}
          </RadioGroup>
        </div>
        <div className="panel">
          <div className="panel-head">
            <h2>Station look</h2>
          </div>
          <p className="hint">Voxel world lights the Station like the world your agents will build: a sky, a sun with soft shadows, glow around bright things and a miniature blur at the edges. Classic is the dark map.</p>
          <div className="field mt-3.5">
            <span>Look</span>
            <Segmented
              label="Station look"
              options={[
                { value: 'classic', label: 'Classic' },
                { value: 'world', label: 'Voxel world' },
              ]}
              value={look.stationLook}
              onChange={(v) => set({ stationLook: v })}
            />
          </div>
          {look.stationLook === 'world' ? (
            <div className="field mt-3">
              <span>Quality</span>
              <Segmented
                label="Voxel world quality"
                options={[
                  { value: 'low', label: 'Low' },
                  { value: 'medium', label: 'Medium' },
                  { value: 'high', label: 'High' },
                ]}
                value={look.worldQuality}
                onChange={(v) => set({ worldQuality: v })}
              />
              <p className="hint mt-1.5">Low has no shadows or glow, for older computers. High adds softer creases and smoother edges.</p>
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex flex-col gap-2.5">
        <div className="panel">
          <div className="panel-head">
            <h2 id="look-accent">Accent colour</h2>
          </div>
          <p className="hint">The highlight colour for buttons, active tabs, the status dots and focus rings.</p>
          <RadioGroup className="mt-3.5 grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-2" aria-labelledby="look-accent" value={look.accent} onValueChange={(v) => set({ accent: v as LookSetting['accent'] })}>
            {ACCENTS.map((a) => (
              <Radio.Root
                key={a.id}
                value={a.id}
                nativeButton
                render={<button type="button" />}
                className={(s) => (s.checked ? `${SWATCH} on` : SWATCH)}
                style={{ '--sw': a.c } as CSSProperties}
                title={a.label}
              >
                <span className="size-4 rounded-full bg-(--sw) shadow-[0_0_10px_var(--sw)]" aria-hidden="true" />
                <span>{a.label}</span>
              </Radio.Root>
            ))}
          </RadioGroup>
        </div>
        <div className="panel">
          <div className="panel-head">
            <h2>Station quality</h2>
          </div>
          <p className="hint">How hard the 3D map works. Lower it if your fans spin up, your battery drains or the map stutters with many agents.</p>
          <div className="field mt-3.5">
            <span id="look-station">Quality</span>
            <Segmented label="Station quality" options={STATION_QUALITY.map((q) => ({ value: q.id, label: q.label }))} value={look.station} onChange={(v) => set({ station: v })} />
          </div>
          <p className="look-station-hint hint mt-2 mb-0">{stationLevel(look.station).hint}</p>
        </div>
        <div className="panel">
          <div className="panel-head">
            <h2>Sidebar</h2>
          </div>
          <p className="hint">What the bottom of the menu shows: what’s set up, or how much of your Claude and Codex plans you’ve used, with Codex’s free limit resets. The Status / Limits switch there does the same.</p>
          <div className="field mt-3.5">
            <span id="look-sidebar">Shows</span>
            <Segmented
              label="Sidebar shows"
              options={[
                { value: 'status', label: 'Status' },
                { value: 'limits', label: 'Usage limits' },
              ]}
              value={look.sidebar}
              onChange={(v) => {
                // the menu reads it from here, so it switches now rather than after the save
                if (state.data?.settings) state.data.settings.look = { ...state.data.settings.look, sidebar: v };
                set({ sidebar: v });
              }}
            />
          </div>
        </div>
        <div className="panel">
          <div className="panel-head">
            <h2>Preview</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn small">Button</button>
            <button className="btn ghost small">Ghost</button>
            <span className="pill ok">ready</span>
            <span>
              <span className="dot on" /> running
            </span>
          </div>
          <p className="look-sample mt-3.5 mb-0 rounded-box border border-line bg-panel-2 px-3 py-2.5 font-chat text-[14px] leading-[1.55]">
            Done. I read the three reports and put a one-page summary in <code>notes/summary.md</code>.
          </p>
          <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
            <button className="btn ghost small" onClick={() => set({ ...DEFAULT_LOOK })}>Reset to default</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export const title = () => 'Look';
export const { render, unmount } = reactPage(() => <LookTab />);
