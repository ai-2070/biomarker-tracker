// Dialogs and toasts on Base UI, for plain-DOM code: modal(), confirmBox(), promptBox() and toast() in
// core.ts call in here with ready-made DOM nodes. One React root holds them all. A dialog opened while
// another is open nests inside it, so Escape and focus go to the one on top, and closing one closes
// the ones above it.
import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { Dialog } from '@base-ui/react/dialog';
import { Toast } from '@base-ui/react/toast';

/** Ready-made DOM nodes to put inside a part of a dialog or toast. */
export type Nodes = readonly Node[];

export interface DialogSpec {
  title: Nodes;
  body: Nodes;
  /** The buttons at the bottom; none leaves the row out. */
  foot: Nodes | null;
  narrow: boolean;
  /** Called once, however it closes. */
  onClose?: () => void;
  /** What gets focus when it opens: by default its first text box, else the dialog itself. */
  focus?: () => HTMLElement | null | undefined;
  /** React content instead of body and foot: it draws its own .modal-body and .modal-foot. */
  content?: ReactNode;
}

export interface OpenDialog {
  close: () => void;
  /** The backdrop (.modal-back); the dialog is the .modal inside it. */
  el: HTMLDivElement;
}

export type ToastKind = 'info' | 'warn' | 'error';

interface Entry {
  id: number;
  spec: DialogSpec;
  open: boolean;
  view: { current: HTMLDivElement | null };
}

// ---------- the dialog list, outside React ----------
let entries: Entry[] = [];
let nextId = 0;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => (listeners.add(fn), () => void listeners.delete(fn));
const snapshot = () => entries;
// synchronous, so a caller can use the dialog's element right after opening it
function update(next: Entry[]): void {
  entries = next;
  flushSync(() => listeners.forEach((fn) => fn()));
}

function closeEntry(entry: Entry): void {
  if (!entry.open) return;
  // the ones on top of it go first: they live inside it
  for (const above of entries.slice(entries.indexOf(entry) + 1).reverse()) closeEntry(above);
  entry.open = false;
  // gone at once, as before (no closing animation to wait for)
  update(entries.filter((e) => e !== entry));
  entry.spec.onClose?.();
}

// ---------- the host: one React root, re-made when the page's containers change (tests rebuild them) ----------
const toasts = Toast.createToastManager();
let host: { root: Root; el: HTMLElement; modals: HTMLElement | null; toasts: HTMLElement | null } | null = null;

function ensureHost(): void {
  const modals = document.getElementById('modal-root');
  const toastEl = document.getElementById('toasts');
  if (host && host.el.isConnected && host.modals === modals && host.toasts === toastEl) return;
  host?.root.unmount();
  host?.el.remove();
  entries = [];
  const el = document.createElement('div');
  el.style.display = 'contents';
  document.body.append(el);
  host = { root: createRoot(el), el, modals, toasts: toastEl };
  const { root } = host;
  flushSync(() => root.render(<Host modals={modals} toastEl={toastEl} />));
}

function Host({ modals, toastEl }: { modals: HTMLElement | null; toastEl: HTMLElement | null }) {
  const list = useSyncExternalStore(subscribe, snapshot);
  return (
    <Toast.Provider toastManager={toasts} limit={5}>
      <Toasts container={toastEl} />
      {list.length ? <Layer list={list} index={0} container={modals} /> : null}
    </Toast.Provider>
  );
}

// ---------- dialogs ----------
/** A ref that puts ready-made DOM nodes into an element React renders empty, whenever that element
 *  appears (a portal draws its contents a render later, so an effect could run too early). */
const useNodes = (nodes: Nodes | null) =>
  useCallback(
    (el: HTMLElement | null) => {
      if (el && nodes) el.replaceChildren(...nodes);
    },
    [nodes],
  );

function Layer({ list, index, container }: { list: Entry[]; index: number; container: HTMLElement | null }) {
  const entry = list[index];
  return (
    <DialogView key={entry.id} entry={entry} container={container}>
      {index + 1 < list.length ? <Layer list={list} index={index + 1} container={container} /> : null}
    </DialogView>
  );
}

function DialogView({ entry, container, children }: { entry: Entry; container: HTMLElement | null; children: ReactNode }) {
  const { spec } = entry;
  const title = useNodes(spec.title);
  const foot = useNodes(spec.foot);
  const bodyNodes = useNodes(spec.body);
  const body = useRef<HTMLDivElement | null>(null);
  const bodyRef = useCallback((el: HTMLDivElement | null) => ((body.current = el), bodyNodes(el)), [bodyNodes]);
  const popup = useRef<HTMLDivElement>(null);
  const firstFocus = () => spec.focus?.() || popup.current?.querySelector<HTMLElement>('.modal-body input:not([type=checkbox]):not([type=radio]):not([disabled]), .modal-body textarea') || popup.current;
  return (
    <Dialog.Root open={entry.open} onOpenChange={(open) => !open && closeEntry(entry)}>
      <Dialog.Portal container={container}>
        <Dialog.Viewport className="modal-back" ref={(el: HTMLDivElement | null) => void (entry.view.current = el || entry.view.current)}>
          <Dialog.Popup ref={popup} className={`modal${spec.narrow ? ' narrow' : ''}`} initialFocus={firstFocus}>
            <div className="modal-head">
              <Dialog.Title ref={title} />
              <Dialog.Close className="icon-btn" aria-label="Close">
                ✕
              </Dialog.Close>
            </div>
            {spec.content ?? (
              <>
                <div className="modal-body" ref={bodyRef} />
                {spec.foot ? <div className="modal-foot" ref={foot} /> : null}
              </>
            )}
            {children}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Opens a dialog on top of any already open. Its elements exist when this returns. */
export function openDialog(spec: DialogSpec): OpenDialog {
  ensureHost();
  const entry: Entry = { id: ++nextId, spec, open: true, view: { current: null } };
  update([...entries, entry]);
  const el = entry.view.current;
  if (!el) throw new Error('The dialog did not open.');
  return { close: () => closeEntry(entry), el };
}

/** A dialog with React content, for React pages. content gets close(); it draws <div className="modal-body">
 *  and, if it has buttons, <div className="modal-foot">. It stacks with every other dialog. */
export function openModal(title: string, content: (close: () => void) => ReactNode, { narrow = false, onClose }: { narrow?: boolean; onClose?: () => void } = {}): OpenDialog {
  let handle: OpenDialog | null = null;
  const close = () => handle?.close();
  handle = openDialog({ title: [document.createTextNode(title)], body: [], foot: null, narrow, onClose, content: <ModalContent render={() => content(close)} /> });
  return handle;
}
// (a component, so the content's hooks belong to it)
const ModalContent = ({ render }: { render: () => ReactNode }) => <>{render()}</>;

// ---------- toasts ----------
interface ToastData {
  nodes: Nodes;
}

// (the description needs a React child of its own, or it draws nothing)
function ToastText({ nodes }: { nodes: Nodes }) {
  return (
    <Toast.Description render={<span />}>
      <span ref={useNodes(nodes)} />
    </Toast.Description>
  );
}

function Toasts({ container }: { container: HTMLElement | null }) {
  const { toasts: list } = Toast.useToastManager<ToastData>();
  return (
    <Toast.Portal container={container}>
      <Toast.Viewport className="flex flex-col gap-2 outline-none">
        {/* oldest first, newest at the bottom of the stack, as before */}
        {[...list].reverse().map((t) => (
          <Toast.Root key={t.id} toast={t} className={`toast${t.type && t.type !== 'info' ? ` ${t.type}` : ''}`}>
            {t.data ? <ToastText nodes={t.data.nodes} /> : null}
          </Toast.Root>
        ))}
      </Toast.Viewport>
    </Toast.Portal>
  );
}

/** Shows a short note in the corner. Screen readers read it out when it appears. */
export function showToast(nodes: Nodes, kind: ToastKind = 'info', ms = 4200): void {
  ensureHost();
  const add = () => void toasts.add<ToastData>({ type: kind, timeout: ms, data: { nodes } });
  // drawn right after the current work: synchronously, but never in the middle of a React render
  queueMicrotask(() => flushSync(add));
}
