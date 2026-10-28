// The schedule editor (Manual / Every… / Daily) used by workflows and routines.
import { h, mount, field, seg, toggle } from './core.ts';
import { scheduleText, DAY_NAMES as DAYS } from '../shared/routines.ts';
import type { Schedule } from '../shared/types.ts';

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const MIN_MINUTES = 5;

export { scheduleText };

/** Edits item.schedule and item.enabled in place; onChange runs after every edit. */
export function scheduleEditor(item: { schedule?: Schedule; enabled?: boolean }, onChange: () => void, { inputLabel = 'Input for scheduled runs' }: { inputLabel?: string } = {}): HTMLDivElement {
  item.schedule ||= { type: 'none' };
  const box = h('div', { class: 'flex flex-col gap-2.5' });
  const draw = () => {
    const s = item.schedule!;
    const mark = () => onChange();
    mount(
      box,
      seg([{ value: 'none', label: 'Manual' }, { value: 'interval', label: 'Every…' }, { value: 'daily', label: 'Daily' }], s.type, (v) => ((s.type = v), mark(), draw())),
      s.type === 'interval'
        ? field(
            'Every (minutes)',
            h('input', {
              type: 'number',
              min: MIN_MINUTES,
              value: s.minutes || 60,
              // kept at the minimum the scheduler uses, so what you see is how often it runs
              oninput: (e) => ((s.minutes = Math.max(MIN_MINUTES, Number(e.target.value) || 60)), mark()),
              onchange: (e) => (e.target.value = String(s.minutes)),
            }),
            `At least ${MIN_MINUTES} minutes.`,
          )
        : null,
      s.type === 'daily'
        ? h(
            'div',
            { class: 'flex flex-col gap-2.5' },
            field('Time', h('input', { type: 'time', value: s.time || '09:00', oninput: (e) => ((s.time = e.target.value), mark()) })),
            h(
              'div.chips',
              DAYS.map((d, i) => {
                const days = s.days?.length ? s.days : EVERY_DAY;
                return h(`button.chip${days.includes(i) ? '.on' : ''}`, {
                  onclick: () => {
                    const cur = new Set(s.days?.length ? s.days : EVERY_DAY);
                    cur.has(i) ? cur.delete(i) : cur.add(i);
                    s.days = [...cur].sort();
                    mark();
                    draw();
                  },
                }, d);
              }),
            ),
          )
        : null,
      s.type !== 'none' ? field(inputLabel, h('input', { value: s.input || '', oninput: (e) => ((s.input = e.target.value), mark()) })) : null,
      s.type !== 'none' ? h('label', { class: 'flex flex-wrap items-center gap-2.5' }, toggle(!!item.enabled, (v) => ((item.enabled = v), mark())), h('span', 'Schedule on (runs while the dashboard is open)')) : null,
    );
  };
  draw();
  return box;
}
