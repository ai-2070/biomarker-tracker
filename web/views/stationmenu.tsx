// The Station's right-click menu, on Base UI: it opens where you clicked, arrow keys move through it,
// Esc or a click elsewhere closes it. The map (station.ts) decides what is in it.
import { StrictMode, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { Menu } from '@base-ui/react/menu';
import { Icon } from '../ui/react.tsx';

/** One line of the menu: a heading, a divider, or something to do. */
export type MenuEntry = { kind: 'head'; text: string } | { kind: 'sep' } | { kind: 'item'; label: string; icon?: string; danger?: boolean; run: () => unknown };

export interface StationMenu {
  /** Open at this point on the screen (clientX / clientY) with these lines. */
  open(x: number, y: number, entries: MenuEntry[]): void;
  close(): void;
  /** Open now. (After Esc or a pick it still says yes until that event is over, so the map doesn't also act on it.) */
  isOpen(): boolean;
  contains(node: Node | null): boolean;
  unmount(): void;
}

interface MenuState {
  open: boolean;
  x: number;
  y: number;
  entries: MenuEntry[];
}

export function mountStationMenu(host: HTMLElement): StationMenu {
  let s: MenuState = { open: false, x: 0, y: 0, entries: [] };
  let shown = false;
  let popup: HTMLElement | null = null;
  const listeners = new Set<() => void>();
  const set = (next: Partial<MenuState>) => {
    s = { ...s, ...next };
    if (s.open) shown = true;
    // (closed: the map sees it closed once this event is done)
    else queueMicrotask(() => (shown = s.open));
    for (const l of listeners) l();
  };
  const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
  function View() {
    const m = useSyncExternalStore(subscribe, () => s);
    // where you clicked, as something to place the menu against
    const anchor = { getBoundingClientRect: () => DOMRect.fromRect({ x: m.x, y: m.y, width: 0, height: 0 }) };
    // split at the dividers: each part is a group, named by its heading
    const groups: MenuEntry[][] = [[]];
    for (const e of m.entries) e.kind === 'sep' ? groups.push([]) : groups[groups.length - 1].push(e);
    return (
      <Menu.Root open={m.open} onOpenChange={(open) => !open && set({ open: false })} modal={false}>
        <Menu.Portal>
          <Menu.Positioner className="z-96 outline-none" anchor={anchor} side="bottom" align="start" sideOffset={2} collisionPadding={8}>
            <Menu.Popup className="st-menu static" ref={(el: HTMLDivElement | null) => void (popup = el)}>
              {groups.map((g, i) => (
                <Group key={i} entries={g} divider={i > 0} />
              ))}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    );
  }
  const root = createRoot(host);
  root.render(
    <StrictMode>
      <View />
    </StrictMode>,
  );
  return {
    open: (x, y, entries) => set({ open: true, x, y, entries }),
    close: () => s.open && set({ open: false }),
    isOpen: () => s.open || shown,
    contains: (node) => !!node && !!popup?.contains(node),
    unmount: () => root.unmount(),
  };
}

function Group({ entries, divider }: { entries: MenuEntry[]; divider: boolean }) {
  const head = entries.find((e): e is Extract<MenuEntry, { kind: 'head' }> => e.kind === 'head');
  return (
    <>
      {divider ? <Menu.Separator className="st-menu-sep" /> : null}
      <Menu.Group>
        {head ? <Menu.GroupLabel className="st-menu-head">{head.text}</Menu.GroupLabel> : null}
        {entries.map((e, i) =>
          e.kind === 'item' ? (
            <Menu.Item key={i} className={`st-menu-item${e.danger ? ' danger' : ''}`} onClick={() => void e.run()}>
              {e.icon ? <Icon name={e.icon} size={15} /> : <span style={{ width: '15px' }} />}
              {e.label}
            </Menu.Item>
          ) : null,
        )}
      </Menu.Group>
    </>
  );
}
