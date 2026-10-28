// Where things stand on the Station map, in map units on the ground (x, z; the Brain at 0, 0). The page draws
// the map from this and world_info tells builders the same numbers, so the two can't drift apart.

/** The nearest a team platform comes to the Brain. */
export const FIRST = 14;

/** A team platform's radius for its number of agents. */
export const platformRadius = (members: number): number => Math.max(6, (Math.max(1, members) * 5.6) / (2 * Math.PI) + 3.4);

/** How far a desk sits from its platform's centre. */
export const DESK_RING = 1.55;
/** A desk turns to face the camera, so it takes a circle this wide around its spot (the lead's gold ring is 1.95). */
export const DESK_REACH = 1.6;

export interface PlanTeam {
  id: string;
  /** its agents, in order (ones that no longer exist are left out by hasAgent) */
  members: string[];
  lead?: string | null;
  /** where it was dragged to, its spin, and an angle around the Brain picked for it */
  pos?: { x: number; z: number } | null;
  rot?: number | null;
  angle?: number | null;
}

export interface DeskSpot {
  agentId: string;
  /** on the map */
  at: [number, number];
  /** on the platform, before its spin (the page places the desk there in the platform's group) */
  local: [number, number];
  lead: boolean;
}

export interface TeamSpot {
  id: string;
  center: [number, number];
  /** where it stands when it isn't dragged */
  home: [number, number];
  radius: number;
  /** the platform's spin (the page's rotation.y is minus this) */
  spin: number;
  desks: DeskSpot[];
}

export interface BenchSpot {
  center: [number, number];
  /** the slab: [across, deep] map units, turned 45° to face the Brain */
  size: [number, number];
  desks: { agentId: string; at: [number, number]; local: [number, number] }[];
}

/** The team platforms around the Brain, leaving the front open for the Bench when there is one. */
export function teamSpots(teams: PlanTeam[], o: { benchCount: number; hasAgent: (id: string) => boolean }): TeamSpot[] {
  const n = teams.length;
  const gap = o.benchCount ? 0.9 : 0;
  // without a Bench, start on a world axis so the platforms run diagonally on screen (isometric look)
  const front = gap ? Math.PI / 4 : 0;
  const biggest = Math.max(5, ...teams.map((t) => platformRadius(t.members.length)));
  const dist = Math.max(FIRST + biggest, n > 1 ? (biggest + 2.5) / Math.sin(Math.PI / Math.max(2, n + (gap ? 1 : 0))) : 0);
  return teams.map((t, i) => {
    const auto = front + gap / 2 + (n === 1 ? (Math.PI * 2 - gap) / 2 : (i / Math.max(1, n - (gap ? 1 : 0))) * (Math.PI * 2 - gap));
    const ang = typeof t.angle === 'number' ? t.angle : auto;
    const home: [number, number] = [Math.cos(ang) * dist, Math.sin(ang) * dist];
    const center: [number, number] = t.pos && Number.isFinite(t.pos.x) && Number.isFinite(t.pos.z) ? [t.pos.x, t.pos.z] : home;
    const spin = typeof t.rot === 'number' ? t.rot : 0;
    const members = t.members.filter(o.hasAgent);
    const radius = platformRadius(members.length);
    const [c, s] = [Math.cos(spin), Math.sin(spin)];
    // the Brain seen from the platform (its own turned frame): the lead sits on that side
    const bx = -center[0] * c - center[1] * s;
    const bz = center[0] * s - center[1] * c;
    const base = bx * bx + bz * bz > 0.01 ? Math.atan2(bz, bx) : 0;
    const order = t.lead && members.includes(t.lead) ? [t.lead, ...members.filter((id) => id !== t.lead)] : members;
    const desks = order.map((agentId, k): DeskSpot => {
      const a = base + (k / Math.max(1, order.length)) * Math.PI * 2;
      const local: [number, number] = [Math.cos(a) * (radius - DESK_RING), Math.sin(a) * (radius - DESK_RING)];
      const at: [number, number] = [center[0] + local[0] * c - local[1] * s, center[1] + local[0] * s + local[1] * c];
      return { agentId, at, local, lead: t.lead === agentId };
    });
    return { id: t.id, center, home, radius, spin, desks };
  });
}

/** The Bench in front of the Brain: agents on no team, four to a row. Null when there are none. */
export function benchSpot(agentIds: string[], saved?: { x: number; z: number } | null): BenchSpot | null {
  if (!agentIds.length) return null;
  const dir: [number, number] = [Math.cos(Math.PI / 4), Math.sin(Math.PI / 4)];
  const right: [number, number] = [-dir[1], dir[0]];
  const cols = Math.min(4, agentIds.length);
  const rows = Math.ceil(agentIds.length / 4);
  const center: [number, number] = saved && Number.isFinite(saved.x) && Number.isFinite(saved.z) ? [saved.x, saved.z] : [dir[0] * (11 + rows * 1.6), dir[1] * (11 + rows * 1.6)];
  const desks = agentIds.map((agentId, j) => {
    const cx = (j % 4) - (cols - 1) / 2;
    const cz = Math.floor(j / 4) - (rows - 1) / 2;
    const local: [number, number] = [right[0] * cx * 3.4 + dir[0] * cz * 3.2, right[1] * cx * 3.4 + dir[1] * cz * 3.2];
    return { agentId, local, at: [center[0] + local[0], center[1] + local[1]] as [number, number] };
  });
  return { center, size: [cols * 3.4 + 1.2, rows * 3.2 + 1.2], desks };
}
