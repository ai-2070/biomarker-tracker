// Pictures for world_look: a camera aimed at what a builder asked to see, rendered offscreen through the
// same look (glow, tone mapping) without touching the view on screen, and read back as a JPEG.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/** The camera stands this far from what it looks at, like the Station's (the fog is set for it). */
export const SNAP_DISTANCE = 300;
const DEG = Math.PI / 180;

export interface SnapFit {
  /** what the camera looks at */
  target: THREE.Vector3;
  position: THREE.Vector3;
  up: THREE.Vector3;
  /** half the view's height and width, map units */
  halfHeight: number;
  halfWidth: number;
}

/**
 * Aims an orthographic camera at a box from an azimuth and elevation (degrees, like the Station's: azimuth 45,
 * elevation 35), so the box fills the picture (zoom 1) with a little room around it, centred on screen.
 */
export function fitCamera(box: THREE.Box3, azimuth = 45, elevation = 35, zoom = 1, aspect = 1.6): SnapFit {
  const az = azimuth * DEG;
  const el = Math.max(5, Math.min(90, elevation)) * DEG;
  // from the target towards the camera
  const back = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
  // straight down has no "up" from the world: the side away from the azimuth is up on screen
  const worldUp = elevation >= 89 ? new THREE.Vector3(-Math.sin(az), 0, -Math.cos(az)) : new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(worldUp, back).normalize();
  const up = new THREE.Vector3().crossVectors(back, right).normalize();
  const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
  let minX = 0;
  let maxX = 0;
  let minY = 0;
  let maxY = 0;
  if (!box.isEmpty()) {
    minX = minY = Infinity;
    maxX = maxY = -Infinity;
    const c = new THREE.Vector3();
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z]) {
          c.set(x, y, z).sub(center);
          const px = c.dot(right);
          const py = c.dot(up);
          minX = Math.min(minX, px);
          maxX = Math.max(maxX, px);
          minY = Math.min(minY, py);
          maxY = Math.max(maxY, py);
        }
  }
  // centred on screen: the middle of what the box covers there
  const target = center.clone().addScaledVector(right, (minX + maxX) / 2).addScaledVector(up, (minY + maxY) / 2);
  const z = Math.max(0.05, zoom || 1);
  const halfHeight = Math.max(1, Math.max((maxY - minY) / 2, (maxX - minX) / 2 / aspect) * 1.12) / z;
  return { target, position: target.clone().addScaledVector(back, SNAP_DISTANCE), up, halfHeight, halfWidth: halfHeight * aspect };
}

/** An orthographic camera from a fit. */
export function snapCamera(f: SnapFit): THREE.OrthographicCamera {
  const cam = new THREE.OrthographicCamera(-f.halfWidth, f.halfWidth, f.halfHeight, -f.halfHeight, -600, 1200);
  cam.up.copy(f.up);
  cam.position.copy(f.position);
  cam.lookAt(f.target);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  return cam;
}

/** Bottom-up RGBA rows (as WebGL reads them) to a top-down JPEG data: URL. */
export function pixelsToJpeg(pixels: Uint8Array, w: number, h: number, quality = 0.85): string {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2D canvas');
  const img = ctx.createImageData(w, h);
  const row = w * 4;
  for (let y = 0; y < h; y++) img.data.set(pixels.subarray((h - 1 - y) * row, (h - y) * row), y * row);
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * Renders the scene from `camera` into offscreen targets (glow, then tone mapping and colour as on screen) and
 * reads it back. The renderer's own target and the view on screen are left as they were.
 */
export function renderSnapshot(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, w: number, h: number, bloom: number): string {
  const before = renderer.getRenderTarget();
  const hdr = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
  const out = new THREE.WebGLRenderTarget(w, h);
  const composer = new EffectComposer(renderer, hdr);
  composer.renderToScreen = false;
  composer.addPass(new RenderPass(scene, camera));
  const glow = new UnrealBloomPass(new THREE.Vector2(w, h), bloom, 0.55, 0.92);
  glow.enabled = bloom > 0.01;
  composer.addPass(glow);
  const output = new OutputPass();
  try {
    composer.render();
    // tone mapping and sRGB into an 8-bit target we can read
    output.renderToScreen = false;
    output.render(renderer, out, composer.readBuffer, 0, false);
    const pixels = new Uint8Array(w * h * 4);
    renderer.readRenderTargetPixels(out, 0, 0, w, h, pixels);
    return pixelsToJpeg(pixels, w, h);
  } finally {
    renderer.setRenderTarget(before);
    glow.dispose();
    output.dispose();
    composer.dispose();
    hdr.dispose();
    out.dispose();
  }
}
