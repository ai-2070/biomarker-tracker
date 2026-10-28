// How each kind of voxel is drawn: solid, glowing (as bright as its material says), glass, water (ripples
// and glints), leaves (they rustle in the wind) and metal. One material per kind, shared by every object
// and every prefab copy; time and wind are uniforms, so nothing is rebuilt while it moves.
import * as THREE from 'three';
import type { RenderClass } from './mesher.ts';

/** Uniforms shared by the voxel materials: seconds, and the wind (map units a second). */
export interface VoxelUniforms {
  time: { value: number };
  wind: { value: THREE.Vector3 };
}

type Shader = Parameters<THREE.Material['onBeforeCompile']>[0];

// Voxel colours are stored as written (sRGB, creases darkened); the shader turns them into linear light.
const SRGB = '#include <color_vertex>\n#ifdef USE_COLOR\n  vColor.rgb = pow(vColor.rgb, vec3(2.2));\n#endif';

/** Where a vertex is in the world (instanced copies included), for patterns that shouldn't move with the mesh. */
const WORLD_POS = `
  vec4 voxWorld = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    voxWorld = instanceMatrix * voxWorld;
  #endif
  voxWorld = modelMatrix * voxWorld;`;

function withShader<T extends THREE.Material>(m: T, key: string, edit: (s: Shader) => void): T {
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader.replace('#include <color_vertex>', SRGB);
    edit(s);
  };
  m.customProgramCacheKey = () => `voxel-${key}`;
  return m;
}

export function createVoxelMaterials(u: VoxelUniforms): Record<RenderClass, THREE.Material> {
  const opaque = withShader(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 }), 'opaque', () => {});

  // glow: brighter than white (so the glow pass picks it up), by the material's emissive level
  const emissive = withShader(new THREE.MeshBasicMaterial({ vertexColors: true }), 'emissive', (s) => {
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute float glow;').replace(SRGB, `${SRGB}\n#ifdef USE_COLOR\n  vColor.rgb *= 0.6 + glow * 3.6;\n#endif`);
  });

  const glass = withShader(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.38, depthWrite: false }), 'glass', () => {});

  // water: see-through, with moving ripples that catch the light
  const water = withShader(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.08, metalness: 0.15, transparent: true, opacity: 0.72, depthWrite: false }), 'water', (s) => {
    s.uniforms.uTime = u.time;
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vWaterXZ;').replace('#include <begin_vertex>', `#include <begin_vertex>\n${WORLD_POS}\n  vWaterXZ = voxWorld.xz;`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec2 vWaterXZ;')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
  float wa = sin(vWaterXZ.x * 2.1 + uTime * 1.3) + sin(vWaterXZ.y * 2.7 - uTime * 1.1);
  float wb = sin((vWaterXZ.x + vWaterXZ.y) * 3.3 + uTime * 1.9);
  normal = normalize(normal + vec3(wa, 0.0, wb) * 0.09);
  diffuseColor.rgb *= 0.92 + 0.12 * wb;`,
      );
  });

  // leaves: a small sway that differs from leaf to leaf and copy to copy, stronger with wind
  const leaf = withShader(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 }), 'leaf', (s) => {
    s.uniforms.uTime = u.time;
    s.uniforms.uWind = u.wind;
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform vec3 uWind;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
  vec3 leafAt = position;
  #ifdef USE_INSTANCING
    leafAt += instanceMatrix[3].xyz * 4.0;
  #endif
  float gust = 0.6 + length(uWind) * 0.35;
  float sway = sin(uTime * 2.3 + leafAt.x * 0.9 + leafAt.z * 0.7 + leafAt.y * 0.4) * 0.14 * gust;
  transformed.x += sway + uWind.x * 0.05;
  transformed.z += sway * 0.6 + uWind.z * 0.05;`,
    );
  });

  const metal = withShader(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.65 }), 'metal', () => {});

  return { opaque, emissive, transparent: glass, water, leaf, metal };
}

/** Kinds that cast shadows and take them. */
export const castsShadow = (cls: RenderClass): boolean => cls !== 'transparent' && cls !== 'water';
export const takesShadow = (cls: RenderClass): boolean => cls !== 'emissive';
