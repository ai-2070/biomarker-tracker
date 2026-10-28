// Materials every world can use by name without defining them first. A build that uses one adds it to
// the world's palette, where it can then be changed ({"material": "grass", "color": "#…"}).
import type { VoxelMaterial } from '../../shared/types.ts';

export const STOCK_MATERIALS: VoxelMaterial[] = [
  { name: 'grass', color: '#5f9e3a', ramp: ['#4f8a30', '#6fae45', '#7dbb52'], jitter: 0.1, kind: 'solid' },
  { name: 'moss', color: '#4a7a35', ramp: ['#3e6a2c', '#5a8c40'], jitter: 0.1, kind: 'leaf' },
  { name: 'dirt', color: '#6b4a2f', ramp: ['#5d3f28', '#7a5636'], jitter: 0.08, kind: 'solid' },
  { name: 'sand', color: '#cdb98f', ramp: ['#c2ad82', '#d8c69e'], jitter: 0.06, kind: 'solid' },
  { name: 'stone', color: '#7d7a74', ramp: ['#6c6964', '#8c8982'], jitter: 0.08, kind: 'solid' },
  { name: 'dark stone', color: '#4f4b47', ramp: ['#433f3b', '#5a5651'], jitter: 0.08, kind: 'solid' },
  { name: 'cobble', color: '#8a8580', ramp: ['#77726c', '#9a958f', '#6a655f'], jitter: 0.1, kind: 'solid' },
  { name: 'brick', color: '#8c3b2c', ramp: ['#7a3226', '#9c4636', '#6e2c22'], jitter: 0.08, kind: 'solid' },
  { name: 'white plaster', color: '#e8e2d4', ramp: ['#ddd6c6', '#f0ebdf'], jitter: 0.04, kind: 'solid' },
  { name: 'wood', color: '#9a6b42', ramp: ['#8a5e39', '#a87a4e'], jitter: 0.07, kind: 'solid' },
  { name: 'dark wood', color: '#4a3326', ramp: ['#3e2a1f', '#563c2d'], jitter: 0.06, kind: 'solid' },
  { name: 'bark', color: '#5a3b2a', ramp: ['#4c3122', '#6a4632'], jitter: 0.08, kind: 'solid' },
  { name: 'leaves', color: '#3f7f34', ramp: ['#356e2b', '#4b8f3e', '#5a9c45'], jitter: 0.08, kind: 'leaf' },
  { name: 'pine needles', color: '#2f5a3a', ramp: ['#284d31', '#376745'], jitter: 0.08, kind: 'leaf' },
  { name: 'blossom', color: '#f3b6cf', ramp: ['#e89ab8', '#f7cde0', '#fde6f0', '#e47fa6'], jitter: 0.06, kind: 'leaf' },
  { name: 'autumn leaves', color: '#c8622a', ramp: ['#b5521f', '#d97a35', '#e0a040', '#a8401c'], jitter: 0.07, kind: 'leaf' },
  { name: 'bamboo', color: '#7fa64a', ramp: ['#6f9640', '#8db456'], jitter: 0.05, kind: 'solid' },
  { name: 'water', color: '#3d8fb0', ramp: ['#3482a2'], jitter: 0.04, kind: 'water', opacity: 0.65 },
  { name: 'glass', color: '#cfe6f2', jitter: 0.02, kind: 'glass', opacity: 0.35 },
  { name: 'ice', color: '#bfe0ee', ramp: ['#d6ecf5'], jitter: 0.04, kind: 'glass', opacity: 0.6 },
  { name: 'snow', color: '#eef2f6', ramp: ['#e2e8ee', '#f7f9fb'], jitter: 0.03, kind: 'snow' },
  { name: 'cloud', color: '#f4f1ee', ramp: ['#e8e4e0', '#fbf9f7'], jitter: 0.03, kind: 'solid' },
  { name: 'red lacquer', color: '#b8322a', ramp: ['#a82c25', '#c43a30'], jitter: 0.05, kind: 'solid' },
  { name: 'roof tile', color: '#2f7f7a', ramp: ['#286f6a', '#378f89'], jitter: 0.06, kind: 'solid' },
  { name: 'gold', color: '#d9b45a', ramp: ['#c9a24a', '#e6c46c'], jitter: 0.05, kind: 'metal' },
  { name: 'iron', color: '#4a4d52', ramp: ['#3f4246', '#56595e'], jitter: 0.05, kind: 'metal' },
  { name: 'lantern', color: '#ffcf7a', ramp: ['#ffd98f'], jitter: 0.03, kind: 'emissive', emissive: 3 },
  { name: 'neon pink', color: '#ff4f8b', jitter: 0.02, kind: 'emissive', emissive: 4 },
  { name: 'neon blue', color: '#4fc8ff', jitter: 0.02, kind: 'emissive', emissive: 4 },
  { name: 'fire', color: '#ff8a2a', ramp: ['#ffb040', '#ff6a1a'], jitter: 0.05, kind: 'emissive', emissive: 4 },
  { name: 'cloth white', color: '#e6e3dc', jitter: 0.03, kind: 'solid' },
  { name: 'skin light', color: '#f0c8a8', jitter: 0.02, kind: 'solid' },
  { name: 'skin medium', color: '#c8916a', jitter: 0.02, kind: 'solid' },
  { name: 'skin dark', color: '#7a4e34', jitter: 0.02, kind: 'solid' },
];

export const stockMaterial = (name: string): VoxelMaterial | undefined => STOCK_MATERIALS.find((m) => m.name === name.trim().toLowerCase());
