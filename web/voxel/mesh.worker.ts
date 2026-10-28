// Meshes voxel objects off the page's main thread, so a big build doesn't stall the map.
// Its own entry in scripts/build-web.ts: public/dist/voxel/mesh.worker.js.
import { meshObject } from './mesher.ts';
import type { VoxelMaterial, VoxelObjectData } from '../../shared/types.ts';

interface MeshJob {
  job: number;
  data: VoxelObjectData;
  palette: VoxelMaterial[];
  region: number;
}

const scope = self as unknown as { onmessage: ((e: MessageEvent<MeshJob>) => void) | null; postMessage: (msg: unknown, transfer: Transferable[]) => void };
scope.onmessage = (e) => {
  const { job, data, palette, region } = e.data;
  try {
    const parts = meshObject(data, palette, region);
    scope.postMessage({ job, parts }, parts.flatMap((p) => [p.positions.buffer, p.normals.buffer, p.colors.buffer, p.indices.buffer, ...(p.glow ? [p.glow.buffer] : []), ...(p.lights ? [p.lights.buffer] : [])]));
  } catch (err) {
    scope.postMessage({ job, error: err instanceof Error ? err.message : String(err) }, []);
  }
};
