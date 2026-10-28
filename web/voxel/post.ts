// The voxel world's finishing passes: soft shadows in creases (high quality), glow around bright things,
// the miniature blur at the top and bottom of the view (tilt-shift), a light vignette, then tone mapping.
// Loaded only when the voxel look is on.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { WorldQuality } from '../../shared/types.ts';

// One direction of the blur; the vertical one also darkens the corners a little.
const TILT_SHIFT = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    delta: { value: new THREE.Vector2(1, 0) },
    /** blur at the edges of the view, in pixels per tap */
    amount: { value: 2 },
    /** the sharp band in the middle, as a part of the height */
    band: { value: 0.22 },
    vignette: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 delta;
    uniform float amount;
    uniform float band;
    uniform float vignette;
    varying vec2 vUv;
    void main() {
      float d = max(0.0, abs(vUv.y - 0.5) - band) / (0.5 - band);
      float r = amount * d * d;
      vec4 sum = vec4(0.0);
      float total = 0.0;
      for (int i = -4; i <= 4; i++) {
        float k = float(i);
        float w = 1.0 - abs(k) / 5.0;
        sum += texture2D(tDiffuse, vUv + delta * k * r) * w;
        total += w;
      }
      vec4 col = sum / total;
      vec2 c = vUv - 0.5;
      col.rgb *= 1.0 - vignette * smoothstep(0.35, 0.85, length(c * vec2(1.1, 1.0)));
      gl_FragColor = col;
    }`,
};

// The crease pass draws the scene once more to see its shapes. Out of the box it skips only points and lines;
// here it also skips sprites, see-through and glowing surfaces (the Brain's beam, rings, halos) and the
// invisible boxes the map uses to fit the view, which would otherwise darken the ground like solid boards.
function onlySolidsShadeCreases(pass: GTAOPass, scene: THREE.Scene): void {
  const hidden: THREE.Object3D[] = [];
  const internals = pass as unknown as { _overrideVisibility: () => void; _restoreVisibility: () => void };
  const solid = (m: THREE.Material) => m.visible && !m.transparent && m.depthWrite;
  internals._overrideVisibility = () => {
    scene.traverse((o) => {
      if (!o.visible) return;
      const mesh = o as THREE.Mesh;
      const keep = mesh.isMesh && (Array.isArray(mesh.material) ? mesh.material.every(solid) : solid(mesh.material));
      if (!keep && !(o as THREE.Group).isGroup && !(o as THREE.Scene).isScene && o.type !== 'Object3D') {
        o.visible = false;
        hidden.push(o);
      }
    });
  };
  internals._restoreVisibility = () => {
    for (const o of hidden) o.visible = true;
    hidden.length = 0;
  };
}

const PIXEL_CAP: Record<WorldQuality, number> = { low: 1, medium: 1.5, high: 1.5 };

export interface PostLook {
  bloom: number;
  tiltShift: number;
}

export interface Post {
  render(): void;
  setSize(w: number, h: number): void;
  setLook(look: PostLook): void;
  dispose(): void;
}

export function createPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, quality: WorldQuality, w: number, h: number): Post {
  // The passes cost by the pixel, so on sharp screens they run at a capped resolution (the labels are
  // HTML and stay sharp), and edges are smoothed only where pixels are big enough to need it.
  const ratio = () => Math.min(renderer.getPixelRatio(), PIXEL_CAP[quality]);
  const target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: quality === 'high' && renderer.getPixelRatio() < 1.5 ? 4 : 0 });
  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(ratio());
  composer.setSize(w, h);
  const scenePass = new RenderPass(scene, camera);
  composer.addPass(scenePass);
  let gtao: GTAOPass | null = null;
  if (quality === 'high') {
    gtao = new GTAOPass(scene, camera, w, h);
    onlySolidsShadeCreases(gtao, scene);
    gtao.updateGtaoMaterial({ radius: 1.2, distanceExponent: 1.5, thickness: 1, scale: 1 });
    gtao.blendIntensity = 0.7;
    composer.addPass(gtao);
  }
  const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.6, 0.55, 0.92);
  composer.addPass(bloom);
  const tiltH = new ShaderPass(TILT_SHIFT);
  const tiltV = new ShaderPass(TILT_SHIFT);
  composer.addPass(tiltH);
  composer.addPass(tiltV);
  // (kept: composer.dispose() doesn't dispose its passes)
  const output = new OutputPass();
  composer.addPass(output);

  let look: PostLook = { bloom: 0.6, tiltShift: 0.4 };
  const apply = () => {
    const pr = ratio();
    bloom.strength = look.bloom;
    bloom.enabled = look.bloom > 0.01;
    const amount = look.tiltShift * 3 * pr;
    tiltH.enabled = tiltV.enabled = amount > 0.05;
    tiltH.uniforms.delta.value.set(1 / (w * pr), 0);
    tiltV.uniforms.delta.value.set(0, 1 / (h * pr));
    for (const p of [tiltH, tiltV]) p.uniforms.amount.value = amount;
    tiltV.uniforms.vignette.value = 0.18 + look.tiltShift * 0.15;
  };
  apply();

  return {
    render: () => composer.render(),
    setSize(nw, nh) {
      w = nw;
      h = nh;
      composer.setPixelRatio(ratio());
      composer.setSize(nw, nh);
      apply();
    },
    setLook(l) {
      look = l;
      apply();
    },
    dispose() {
      gtao?.dispose();
      bloom.dispose();
      tiltH.dispose();
      tiltV.dispose();
      output.dispose();
      scenePass.dispose();
      composer.dispose();
      target.dispose();
    },
  };
}
