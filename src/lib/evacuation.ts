// Evacuation routing against the flood clock.
//
// A route is only worth offering if you can finish it before the water arrives, so this is not a
// shortest-path problem but a time-dependent one: leaving at a given moment, each road is passable
// only while it is still dry, and the goal is ground the flood never reaches. The result is a
// route per settlement with the time it takes and the margin left against the water — and an
// honest "cut off" where no such route exists, which is itself the most important thing to know.
//
// Speeds are deliberately conservative for a crowd leaving in a hurry at night, and the margin is
// reported so a planner can judge it rather than trusting a single number.

// Explicit extensions so this module can be imported both by the app and by a plain Node script,
// the way the solver modules are.
import { haversine, lngLatToCell } from './geo/grid.ts';
import type { GridGeometry } from './geo/grid.ts';
import type { ExposureIndex } from './analytics.ts';

/** Travel speed by road class (m/s): a convoy in a hurry, not free-flow design speed. */
const SPEED: Record<string, number> = {
  motorway: 16.7,
  trunk: 13.9,
  primary: 11.1,
  secondary: 9.7,
  tertiary: 8.3,
};
const DEFAULT_SPEED = 8.3;

/** Depth (m) at which a road counts as impassable — the same threshold the impact panel uses. */
const CUT_DEPTH = 0.3;

export interface EvacuationRoute {
  /** Index into exposure.assets of the settlement this route leaves from. */
  asset: number;
  /** The way out, in lng/lat, ending on ground the flood never reaches. */
  path: [number, number][];
  lengthM: number;
  travelSeconds: number;
  /**
   * Seconds between arriving at the far end and the water reaching the most exposed road cell on
   * the way. Infinite when the route never touches ground the flood reaches at all.
   */
  marginSeconds: number;
  status: 'ok' | 'no-road' | 'cut-off';
}

export interface EvacuationOptions {
  /** When people start moving, in seconds after the breach (a warning lead is negative). */
  departAt?: number;
  /** Safety margin required between passing a cell and the water reaching it (s). */
  safetySeconds?: number;
  /** Settlements to route, as indices into exposure.assets. Defaults to every flooded one. */
  assets?: number[];
}

interface Graph {
  /** Node positions, lng/lat. */
  lng: Float64Array;
  lat: Float64Array;
  /** Time the water reaches each node (s); Infinity where it never does. */
  floods: Float64Array;
  /** Adjacency: for node i, edges are heads[i] … heads[i + 1] − 1. */
  heads: Int32Array;
  to: Int32Array;
  cost: Float64Array;
}

const key = (lng: number, lat: number) => `${lng.toFixed(5)},${lat.toFixed(5)}`;

/**
 * Builds the road graph once per run. Vertices shared between ways (junctions) merge because
 * OpenStreetMap gives them identical coordinates.
 */
function buildGraph(index: ExposureIndex, g: GridGeometry, arrival: Float32Array, maxDepth: Float32Array): Graph {
  const ids = new Map<string, number>();
  const lng: number[] = [];
  const lat: number[] = [];
  const edgesFrom: number[] = [];
  const edgesTo: number[] = [];
  const edgeCost: number[] = [];

  const nodeAt = (p: [number, number]) => {
    const k = key(p[0], p[1]);
    let id = ids.get(k);
    if (id === undefined) {
      id = lng.length;
      ids.set(k, id);
      lng.push(p[0]);
      lat.push(p[1]);
    }
    return id;
  };

  for (const road of index.roads) {
    const speed = SPEED[road.highway] ?? DEFAULT_SPEED;
    for (let i = 1; i < road.path.length; i++) {
      const a = nodeAt(road.path[i - 1]);
      const b = nodeAt(road.path[i]);
      if (a === b) continue;
      const metres = haversine(road.path[i - 1], road.path[i]);
      const seconds = metres / speed;
      edgesFrom.push(a, b);
      edgesTo.push(b, a);
      edgeCost.push(seconds, seconds);
    }
  }

  // When each node goes under: the arrival time of its cell, if the water gets deep enough there.
  const floods = new Float64Array(lng.length).fill(Infinity);
  for (let i = 0; i < lng.length; i++) {
    const cell = lngLatToCell(g, lng[i], lat[i]);
    if (!cell) continue;
    const t = arrival[cell.index];
    if (t >= 0 && maxDepth[cell.index] >= CUT_DEPTH) floods[i] = t;
  }

  // Compressed adjacency.
  const n = lng.length;
  const counts = new Int32Array(n + 1);
  for (const from of edgesFrom) counts[from + 1]++;
  for (let i = 0; i < n; i++) counts[i + 1] += counts[i];
  const heads = counts;
  const to = new Int32Array(edgesTo.length);
  const cost = new Float64Array(edgesTo.length);
  const cursor = Int32Array.from(heads.subarray(0, n));
  for (let e = 0; e < edgesFrom.length; e++) {
    const slot = cursor[edgesFrom[e]]++;
    to[slot] = edgesTo[e];
    cost[slot] = edgeCost[e];
  }
  return { lng: Float64Array.from(lng), lat: Float64Array.from(lat), floods, heads, to, cost };
}

/** Binary heap of (node, time), smallest time first. */
class Queue {
  private readonly node: number[] = [];
  private readonly time: number[] = [];
  get size(): number {
    return this.node.length;
  }
  push(node: number, time: number): void {
    this.node.push(node);
    this.time.push(time);
    let i = this.node.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.time[parent] <= this.time[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  pop(): { node: number; time: number } {
    const node = this.node[0];
    const time = this.time[0];
    const lastNode = this.node.pop() as number;
    const lastTime = this.time.pop() as number;
    if (this.node.length > 0) {
      this.node[0] = lastNode;
      this.time[0] = lastTime;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let best = i;
        if (l < this.time.length && this.time[l] < this.time[best]) best = l;
        if (r < this.time.length && this.time[r] < this.time[best]) best = r;
        if (best === i) break;
        this.swap(i, best);
        i = best;
      }
    }
    return { node, time };
  }
  private swap(a: number, b: number): void {
    [this.node[a], this.node[b]] = [this.node[b], this.node[a]];
    [this.time[a], this.time[b]] = [this.time[b], this.time[a]];
  }
}

/** Nearest graph node to a point, within `limit` metres. */
function nearestNode(graph: Graph, lng: number, lat: number, limit = 3000): number {
  let best = -1;
  let bestDistance = limit;
  for (let i = 0; i < graph.lng.length; i++) {
    const d = haversine([lng, lat], [graph.lng[i], graph.lat[i]]);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return best;
}

/**
 * Earliest-arrival search from one settlement to the nearest ground the flood never reaches. An
 * edge may only be taken if the water reaches neither end until after you would have passed,
 * which is what makes this a route rather than a line on a map.
 */
function route(graph: Graph, start: number, departAt: number, safety: number): { path: number[]; time: number; margin: number } | null {
  const best = new Float64Array(graph.lng.length).fill(Infinity);
  const from = new Int32Array(graph.lng.length).fill(-1);
  const queue = new Queue();
  best[start] = departAt;
  queue.push(start, departAt);
  while (queue.size > 0) {
    const { node, time } = queue.pop();
    if (time > best[node]) continue;
    if (graph.floods[node] === Infinity && node !== start) {
      // Safe ground: walk the path back.
      const path: number[] = [];
      let at = node;
      let margin = Infinity;
      while (at >= 0) {
        path.push(at);
        if (graph.floods[at] !== Infinity) margin = Math.min(margin, graph.floods[at] - best[at]);
        at = from[at];
      }
      path.reverse();
      return { path, time: time - departAt, margin };
    }
    for (let e = graph.heads[node]; e < graph.heads[node + 1]; e++) {
      const next = graph.to[e];
      const at = time + graph.cost[e];
      // Both ends must still be dry when you pass, with the safety margin to spare.
      if (at + safety > graph.floods[next] || time + safety > graph.floods[node]) continue;
      if (at < best[next]) {
        best[next] = at;
        from[next] = node;
        queue.push(next, at);
      }
    }
  }
  return null;
}

/**
 * A way out for every settlement the flood reaches, computed against the arrival times of the run
 * on screen. Settlements with no road within reach, or none that stays dry long enough, are
 * returned with that status rather than silently dropped.
 */
export function planEvacuation(
  index: ExposureIndex,
  g: GridGeometry,
  summary: { arrival: Float32Array; maxDepth: Float32Array },
  options: EvacuationOptions = {},
): EvacuationRoute[] {
  const departAt = options.departAt ?? 0;
  const safety = options.safetySeconds ?? 300;
  const graph = buildGraph(index, g, summary.arrival, summary.maxDepth);
  if (graph.lng.length === 0) return [];

  const wanted =
    options.assets ??
    index.assets
      .map((a, i) => ({ a, i }))
      .filter(({ a }) => {
        if (a.kind !== 'settlement') return false;
        const cell = lngLatToCell(g, a.lng, a.lat);
        return !!cell && summary.arrival[cell.index] >= 0;
      })
      .map(({ i }) => i);

  const out: EvacuationRoute[] = [];
  for (const asset of wanted) {
    const a = index.assets[asset];
    const start = nearestNode(graph, a.lng, a.lat);
    if (start < 0) {
      out.push({ asset, path: [], lengthM: 0, travelSeconds: 0, marginSeconds: 0, status: 'no-road' });
      continue;
    }
    const found = route(graph, start, departAt, safety);
    if (!found) {
      out.push({ asset, path: [], lengthM: 0, travelSeconds: 0, marginSeconds: 0, status: 'cut-off' });
      continue;
    }
    const path = found.path.map((n) => [graph.lng[n], graph.lat[n]] as [number, number]);
    let lengthM = 0;
    for (let i = 1; i < path.length; i++) lengthM += haversine(path[i - 1], path[i]);
    out.push({ asset, path, lengthM, travelSeconds: found.time, marginSeconds: found.margin, status: 'ok' });
  }
  return out;
}
