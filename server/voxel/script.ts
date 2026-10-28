// world_script: an agent builds with a JavaScript program instead of a list of steps (loops, maths,
// procedural shapes). It runs in QuickJS compiled to WebAssembly: no files, no network, no timers, nothing of
// this computer, with a time and memory limit. The program only hands build steps over (BuildApi): they run
// through the same build as world_build, so its limits, all-or-nothing and undo apply.
import { newQuickJSWASMModuleFromVariant, shouldInterruptAfterDeadline } from 'quickjs-emscripten-core';
import type { QuickJSContext, QuickJSHandle, QuickJSWASMModule } from 'quickjs-emscripten-core';
import variant from '@jitl/quickjs-singlefile-mjs-release-sync';
import { valueNoise } from './noise.ts';
import { BuildError, LIMITS } from './ops.ts';
import type { BuildApi } from './ops.ts';

export const SCRIPT_LIMITS = { ms: 20_000, memoryBytes: 256 * 1024 * 1024, stackBytes: 1024 * 1024, codeChars: 40_000, logChars: 4000 };

let loading: Promise<QuickJSWASMModule> | null = null;
/** The sandbox, loaded the first time a script runs. */
export const loadSandbox = (): Promise<QuickJSWASMModule> => (loading ??= newQuickJSWASMModuleFromVariant(variant));

// The functions a script sees. Positions and sizes are map units from the cursor, like world_build with
// "units": "map"; opts takes any of a step's own fields ("use", "erase", "hollow", "keep", "turn"…).
// set() voxels are gathered and handed over 5,000 at a time (one "set" step each).
const PRELUDE = `
const __sets = { key: '', pts: [], opts: null };
function __send(s) { const e = __host_step(JSON.stringify(s)); if (e) throw new Error(e); }
function __flushSets() {
  if (!__sets.pts.length) return;
  const s = Object.assign({}, __sets.opts, { set: __sets.pts });
  __sets.pts = [];
  __send(s);
}
function step(s) { __flushSets(); if (!s || typeof s !== 'object') throw new Error('step() takes a step object, like {box: [4, 2, 4]}'); __send(s); }
const __o = (opts) => (opts && typeof opts === 'object' ? opts : {});
const __v = (v, what) => { if (!Array.isArray(v) || v.length !== 3 || v.some((n) => typeof n !== 'number' || !isFinite(n))) throw new Error(what + ' must be [x, y, z] numbers'); return v; };
function use(material) { step({ use: material }); }
function material(name, opts) { step(Object.assign({}, __o(opts), { material: name })); }
function voxelSize(size) { step({ voxel_size: size }); }
function at(x, y, z) { step({ at: [x, y, z] }); }
function move(x, y, z) { step({ move: [x, y, z] }); }
function mirror(axes) { step({ mirror: axes === undefined ? 'none' : axes }); }
function box(p, size, opts) { step(Object.assign({}, __o(opts), { box: size, at: __v(p, 'box position') })); }
function sphere(p, r, opts) { step(Object.assign({}, __o(opts), { sphere: r, at: __v(p, 'sphere position') })); }
function ellipsoid(p, radii, opts) { step(Object.assign({}, __o(opts), { ellipsoid: radii, at: __v(p, 'ellipsoid position') })); }
function blob(p, radii, opts) { step(Object.assign({}, __o(opts), { blob: radii, at: __v(p, 'blob position') })); }
function cylinder(p, r, height, opts) { step(Object.assign({}, __o(opts), { cylinder: r, height: height, at: __v(p, 'cylinder position') })); }
function cone(p, r, height, opts) { step(Object.assign({}, __o(opts), { cone: r, height: height, at: __v(p, 'cone position') })); }
function line(a, b, opts) { __v(a, 'line start'); __v(b, 'line end'); step(Object.assign({}, __o(opts), { at: a, line: [b[0] - a[0], b[1] - a[1], b[2] - a[2]] })); }
function path(points, width, opts) { step(Object.assign({}, __o(opts), { path: points, width: width })); }
function extrude(points, height, opts) { const o = __o(opts); step(Object.assign({}, o, { extrude: { points: points, wall: o.wall }, height: height })); }
function revolve(p, profile, opts) { step(Object.assign({}, __o(opts), { revolve: profile, at: __v(p, 'revolve position') })); }
function place(prefab, p, opts) { step(Object.assign({}, __o(opts), { place: prefab, at: __v(p, 'place position') })); }
function stamp(prefab, p, opts) { step(Object.assign({}, __o(opts), { stamp: prefab, at: __v(p, 'stamp position') })); }
function set(x, y, z, opts) {
  const o = typeof opts === 'string' ? { use: opts } : __o(opts);
  const key = JSON.stringify(o);
  if (key !== __sets.key || __sets.pts.length >= ${LIMITS.setPoints}) { __flushSets(); __sets.key = key; __sets.opts = o; }
  __sets.pts.push([x, y, z]);
}
function erase(x, y, z) { set(x, y, z, { erase: true }); }
function solid(x, y, z) { __flushSets(); return __host_solid(x, y, z); }
function materialAt(x, y, z) { __flushSets(); return __host_material(x, y, z); }
function top(x, z, fromY) { __flushSets(); return __host_top(x, z, fromY === undefined ? 64 : fromY); }
function noise(x, z, cell) { return __host_noise(x, z, cell === undefined ? 8 : cell); }
let __seed = __SEED >>> 0 || 1;
function random() { let t = (__seed += 0x6d2b79f5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
function log() { __host_log(Array.prototype.map.call(arguments, (a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); }
`;

export interface ScriptResult {
  log: string[];
}

/** Runs a script against a build. Throws a BuildError saying where it went wrong (line and what). */
export function runScript(qjs: QuickJSWASMModule, code: string, api: BuildApi, seed = 1): ScriptResult {
  if (typeof code !== 'string' || !code.trim()) throw new BuildError('Give the script as "code": JavaScript that builds with box(), sphere(), path(), place(), set()…');
  if (code.length > SCRIPT_LIMITS.codeChars) throw new BuildError(`A script is at most ${SCRIPT_LIMITS.codeChars.toLocaleString('en-US')} characters; split the build`);
  const rt = qjs.newRuntime();
  rt.setMemoryLimit(SCRIPT_LIMITS.memoryBytes);
  rt.setMaxStackSize(SCRIPT_LIMITS.stackBytes);
  rt.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + SCRIPT_LIMITS.ms));
  const vm = rt.newContext();
  const log: string[] = [];
  let logged = 0;
  // the build's own error (a step that failed): kept whole, so its message reaches the agent as it is
  let failed: BuildError | null = null;
  try {
    const fn = (name: string, f: (...args: QuickJSHandle[]) => QuickJSHandle | undefined) => {
      const h = vm.newFunction(name, f);
      vm.setProp(vm.global, name, h);
      h.dispose();
    };
    const n = (h: QuickJSHandle) => vm.getNumber(h);
    fn('__host_step', (s) => {
      try {
        api.step(JSON.parse(vm.getString(s)));
        return vm.newString('');
      } catch (e) {
        if (e instanceof BuildError) failed = e;
        return vm.newString(e instanceof Error ? e.message : String(e));
      }
    });
    fn('__host_solid', (x, y, z) => (api.solid(n(x), n(y), n(z)) ? vm.true : vm.false));
    fn('__host_material', (x, y, z) => {
      const m = api.materialAt(n(x), n(y), n(z));
      return m === null ? vm.null : vm.newString(m);
    });
    fn('__host_top', (x, z, y) => {
      const t = api.top(n(x), n(z), n(y));
      return t === null ? vm.null : vm.newNumber(t);
    });
    fn('__host_noise', (x, z, cell) => vm.newNumber(valueNoise(n(x), n(z), Math.max(0.01, n(cell)), seed)));
    fn('__host_log', (t) => {
      const line = vm.getString(t);
      if (logged < SCRIPT_LIMITS.logChars) log.push(line.slice(0, SCRIPT_LIMITS.logChars - logged));
      logged += line.length;
      return undefined;
    });
    const seedHandle = vm.newNumber(seed);
    vm.setProp(vm.global, '__SEED', seedHandle);
    seedHandle.dispose();
    unwrap(vm, vm.evalCode(PRELUDE, 'prelude.js'), code);
    // the program, then whatever set() still holds
    unwrap(vm, vm.evalCode(code, 'script.js'), code);
    unwrap(vm, vm.evalCode('__flushSets();', 'end.js'), code);
    // a step that failed fails the build, even when the script caught it and went on (it may be half done)
    const f = failed as BuildError | null;
    if (f) throw new BuildError(`A step failed: ${f.message} (the script caught it, but nothing was built: fix the step)`);
  } finally {
    vm.dispose();
    rt.dispose();
  }
  if (logged > SCRIPT_LIMITS.logChars) log.push(`… (${(logged - SCRIPT_LIMITS.logChars).toLocaleString('en-US')} more characters of log)`);
  return { log };
}

/** A result's value, or a BuildError naming the script's line and the problem. */
function unwrap(vm: QuickJSContext, r: ReturnType<QuickJSContext['evalCode']>, code: string): void {
  if (!r.error) {
    r.value.dispose();
    return;
  }
  const err = vm.dump(r.error) as { name?: string; message?: string; stack?: string } | string;
  r.error.dispose();
  const e = typeof err === 'object' && err ? err : { message: String(err) };
  if (e.message === 'interrupted') throw new BuildError(`The script ran longer than ${SCRIPT_LIMITS.ms / 1000} seconds and was stopped. Nothing was built.`);
  if (/out of memory/i.test(e.message || '')) throw new BuildError('The script used too much memory and was stopped. Nothing was built.');
  // where in the agent's own code (the first frame in script.js)
  const m = /script\.js:(\d+)(?::(\d+))?/.exec(e.stack || '');
  const lineNo = m ? Number(m[1]) : 0;
  const src = lineNo ? code.split(/\r?\n/)[lineNo - 1]?.trim().slice(0, 160) : '';
  const what = `${e.name && e.name !== 'Error' ? `${e.name}: ` : ''}${e.message || 'the script failed'}`;
  throw new BuildError(`${lineNo ? `Line ${lineNo}${src ? ` (${src})` : ''}: ` : ''}${what}`);
}
