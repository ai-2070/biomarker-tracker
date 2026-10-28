// A 3D model you can turn with the mouse: .glb, .obj, .stl, .ply, .fbx (and a .gltf that has everything inside it).
// three.js and the loaders come in only when a model is first shown. Each viewer draws only while it is on screen and
// gives its graphics context back when it leaves, so a long chat of models doesn't run out of them.
import { h } from './core.ts';
import { fetchFile } from './client/http.ts';
import type { Group, Object3D, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export const MODEL_EXT = /\.(glb|gltf|obj|stl|ply|fbx)$/i;
/** Bigger files are only offered for download: parsing them would freeze the page. */
export const MODEL_MAX_BYTES = 60 * 1024 * 1024;

type Three = typeof import('three');

/** A model file read into a three.js object (for the viewer here, and for the Brain's globe). */
export async function loadModel(url: string, ext: string): Promise<Object3D> {
  return parseModel(await import('three'), url, ext);
}

async function parseModel(THREE: Three, url: string, ext: string): Promise<Object3D> {
  const res = await fetchFile(url);
  const gray = () => new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.6, metalness: 0.1 });
  if (ext === 'obj') {
    const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
    const obj = new OBJLoader().parse(await res.text());
    obj.traverse((o) => {
      if ((o as Object3D & { isMesh?: boolean }).isMesh) (o as unknown as { material: unknown }).material = gray();
    });
    return obj;
  }
  const buf = await res.arrayBuffer();
  if (ext === 'glb' || ext === 'gltf') {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const gltf = await new GLTFLoader().parseAsync(ext === 'gltf' ? new TextDecoder().decode(buf) : buf, '');
    return gltf.scene;
  }
  if (ext === 'stl') {
    const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
    const geo = new STLLoader().parse(buf);
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, gray());
  }
  if (ext === 'ply') {
    const { PLYLoader } = await import('three/examples/jsm/loaders/PLYLoader.js');
    const geo = new PLYLoader().parse(buf);
    if (geo.index) {
      geo.computeVertexNormals();
      return new THREE.Mesh(geo, gray());
    }
    return new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.01, vertexColors: !!geo.getAttribute('color') }));
  }
  const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
  return new FBXLoader().parse(buf, '') as Group;
}

/** Centres the model, scales it to a standard size, and backs the camera off to see all of it. */
function frame(THREE: Three, model: Object3D, camera: PerspectiveCamera, controls: OrbitControls): void {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const k = 2 / (Math.max(size.x, size.y, size.z) || 1);
  model.scale.setScalar(k);
  model.position.copy(centre.multiplyScalar(-k));
  camera.position.set(2.2, 1.4, 2.8);
  camera.near = 0.05;
  camera.far = 100;
  camera.updateProjectionMatrix();
  controls.target.set(0, 0, 0);
  controls.update();
}

/** The viewer for one model file. Says so in words when the file can't be drawn (no 3D support, or a .gltf that is not self-contained). */
export function modelViewer(url: string, name: string, bytes = 0): HTMLElement {
  const ext = (/\.([a-z]+)$/i.exec(name)?.[1] || '').toLowerCase();
  const note = h('div.fp-model-note', { class: 'absolute inset-0 grid place-items-center p-4 text-center font-mono text-[12px] leading-[normal] text-dim' }, 'Loading the model…');
  const box = h('div.fp-model', { class: 'relative aspect-[4/3] max-h-90 w-full overflow-hidden bg-[radial-gradient(circle_at_50%_35%,#2a2f2b,#0b0d0b)]', role: 'img', 'aria-label': `3D model ${name}` }, note);
  if (bytes > MODEL_MAX_BYTES) {
    note.textContent = `This model is ${(bytes / 1048576).toFixed(0)} MB, too big to show here. Download it to open it.`;
    return box;
  }

  let stopLive: (() => void) | null = null;
  let model: Object3D | null = null;
  let THREE: Three | null = null;
  let failed = false;
  let loading = false;
  let visible = false;

  const stop = () => {
    stopLive?.();
    stopLive = null;
  };
  const fail = (why: string) => {
    failed = true;
    stop();
    note.textContent = why;
    note.classList.remove('hidden');
  };

  async function start() {
    if (failed || stopLive || !model || !THREE) return;
    const T = THREE;
    const m = model;
    let renderer: WebGLRenderer;
    try {
      renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      return fail("Can't show 3D in this browser. Download the file to open it.");
    }
    // (stop() before this finished loading the controls would otherwise leave a context behind)
    let cancelled = false;
    stopLive = () => {
      cancelled = true;
      renderer.dispose();
      renderer.forceContextLoss();
    };
    const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
    if (cancelled) return;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    const scene: Scene = new T.Scene();
    scene.add(new T.HemisphereLight(0xffffff, 0x445566, 1.4));
    const sun = new T.DirectionalLight(0xffffff, 2);
    sun.position.set(3, 5, 4);
    scene.add(sun);
    scene.add(m);
    const camera = new T.PerspectiveCamera(40, 1, 0.05, 100);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.6;
    // turning it by hand ends the spinning
    controls.addEventListener('start', () => (controls.autoRotate = false));
    frame(T, m, camera, controls);
    renderer.domElement.className = 'absolute inset-0 block h-full w-full cursor-grab touch-none';
    box.append(renderer.domElement);
    const resize = () => {
      const w = box.clientWidth || 300;
      const hh = box.clientHeight || 225;
      renderer.setSize(w, hh, false);
      camera.aspect = w / hh;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(box);
    resize();
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      controls.update();
      renderer.render(scene, camera);
    };
    tick();
    note.classList.add('hidden');
    stopLive = () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      scene.remove(m);
      renderer.domElement.remove();
      renderer.dispose();
      renderer.forceContextLoss();
    };
  }

  async function load() {
    if (loading || model || failed) return;
    loading = true;
    try {
      THREE = await import('three');
      model = await parseModel(THREE, url, ext);
      if (visible) void start();
    } catch (e) {
      fail(ext === 'gltf' ? 'This .gltf needs other files next to it. Download it, or export a single .glb.' : `Couldn't read this model (${(e as Error).message}). Download it to open it.`);
    } finally {
      loading = false;
    }
  }

  if (typeof IntersectionObserver === 'undefined') {
    visible = true;
    void load();
  } else {
    new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting);
      if (visible) {
        if (model) void start();
        else void load();
      } else stop();
    }).observe(box);
  }
  return box;
}
