// Evacuation routing against the flood clock.
//
// A route is only worth offering if you can finish it before the water arrives, so this is not a
// shortest-path problem but a time-dependent one: leaving at a given moment, each road is passable
// only while it is still dry, and the goal is ground the flood never reaches.
//
// Speeds are deliberately conservative for a convoy in a hurry at night, and routes follow the live
// clock: green while leaving now still works, red once cut off, with safe destinations including
// both high ground above the valley floor and highways exiting the study area.

import { haversine, lngLatToCell, sampleBilinear } from './geo/grid.ts';
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
  /** Name of the settlement. */
  name: string;
  /** The way out, in lng/lat, ending on safe ground (high ground or road leaving study area). */
  path: [number, number][];
  /** 3D path coordinates [lng, lat, z] for depth-tested rendering on terrain. */
  path3d?: [number, number, number][];
  lengthM: number;
  travelSeconds: number;
  /**
   * Latest departure time from the settlement (seconds after breach) that still allows
   * arriving safely before flood waters reach any road segment along the route.
   * If you leave at or before latestDepartureSeconds, the route is open (GREEN).
   * After latestDepartureSeconds, the route is cut off (RED).
   */
  latestDepartureSeconds: number;
  /**
   * Seconds between arriving at the far end and the water reaching the most exposed road cell on
   * the way. Infinite when the route never touches ground the flood reaches.
   */
  marginSeconds: number;
  status: 'ok' | 'no-road' | 'cut-off';
}

export interface EvacuationOptions {
  /** When people start moving, in seconds after the breach (a warning lead is negative). */
  departAt?: number;
  /** Safety margin required between passing a cell and the water reaching it (s). */
  safetySeconds?: number;
  /**
   * How far clear of the water counts as safe (m). Without this, the search stops at the first
   * dry cell it meets.
   */
  safeBufferM?: number;
  /** Elevation DEM array for high-ground detection and 3D path coordinates. */
  dem?: Float32Array;
  /** Settlements to route, as indices into exposure.assets. Defaults to every flooded one. */
  assets?: number[];
}

export interface Graph {
  /** Node positions, lng/lat. */
  lng: Float64Array;
  lat: Float64Array;
  /** Elevation of the node from DEM. */
  elev: Float32Array;
  /** Time the water reaches each node (s); Infinity where it never does. */
  floods: Float64Array;
  /** Somewhere the route can end: dry high ground or road leaving study area. */
  safe: Uint8Array;
  /** Adjacency: for node i, edges are heads[i] … heads[i + 1] − 1. */
  heads: Int32Array;
  to: Int32Array;
  cost: Float64Array;
}

const key = (lng: number, lat: number) => `${lng.toFixed(5)},${lat.toFixed(5)}`;

/**
 * Cells within `bufferM` of anywhere the flood reaches. Grown ring by ring from every flooded cell.
 */
function nearFloodMask(g: GridGeometry, arrival: Float32Array, maxDepth: Float32Array, bufferM: number): Uint8Array {
  const { cols, rows } = g;
  const near = new Uint8Array(cols * rows);
  let frontier: number[] = [];
  for (let k = 0; k < near.length; k++) {
    if (arrival[k] >= 0 || maxDepth[k] >= CUT_DEPTH) {
      near[k] = 1;
      frontier.push(k);
    }
  }
  const rings = Math.ceil(bufferM / Math.min(g.dx, g.dy));
  for (let ring = 0; ring < rings && frontier.length > 0; ring++) {
    const next: number[] = [];
    for (const k of frontier) {
      const r = (k / cols) | 0;
      const c = k - r * cols;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
          const n = rr * cols + cc;
          if (near[n]) continue;
          near[n] = 1;
          next.push(n);
        }
      }
    }
    frontier = next;
  }
  return near;
}

/**
 * Builds the road graph once per run.
 * Safe destinations are identified by:
 * 1. Road exits leaving the study area.
 * 2. High ground on hillsides above local flood water level.
 * 3. Dry ground outside the flood buffer.
 */
function buildGraph(
  index: ExposureIndex,
  g: GridGeometry,
  arrival: Float32Array,
  maxDepth: Float32Array,
  dem: Float32Array | undefined,
  bufferM: number,
): Graph {
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

  const n = lng.length;
  const floods = new Float64Array(n).fill(Infinity);
  const safe = new Uint8Array(n);
  const elev = new Float32Array(n);

  const near = nearFloodMask(g, arrival, maxDepth, bufferM);

  // Peak water surface elevation across flooded cells
  const wse = dem ? new Float32Array(g.cols * g.rows) : null;
  if (wse && dem) {
    for (let k = 0; k < wse.length; k++) {
      if (arrival[k] >= 0 && maxDepth[k] >= CUT_DEPTH) {
        wse[k] = dem[k] + maxDepth[k];
      }
    }
  }

  for (let i = 0; i < n; i++) {
    const nodeLng = lng[i];
    const nodeLat = lat[i];
    const cell = lngLatToCell(g, nodeLng, nodeLat);
    if (!cell) {
      // Road leaves the study area: an exit highway!
      floods[i] = Infinity;
      safe[i] = 1;
      elev[i] = 0;
      continue;
    }

    const idx = cell.index;
    const nodeElev = dem ? dem[idx] : 0;
    elev[i] = nodeElev;

    const t = arrival[idx];
    if (t >= 0 && maxDepth[idx] >= CUT_DEPTH) {
      floods[i] = t;
    } else {
      floods[i] = Infinity;
    }

    if (floods[i] === Infinity) {
      // 1. Boundary exit: road node is right at the boundary of the study area
      const isEdge = cell.col <= 1 || cell.col >= g.cols - 2 || cell.row <= 1 || cell.row >= g.rows - 2;
      if (isEdge) {
        safe[i] = 1;
        continue;
      }

      // 2. High ground on hillside: elevated above peak flood in the local valley
      if (wse && dem) {
        let maxNearbyWse = 0;
        const r = cell.row;
        const c = cell.col;
        for (let dr = -3; dr <= 3; dr++) {
          for (let dc = -3; dc <= 3; dc++) {
            const rr = r + dr;
            const cc = c + dc;
            if (rr >= 0 && rr < g.rows && cc >= 0 && cc < g.cols) {
              const h = wse[rr * g.cols + cc];
              if (h > maxNearbyWse) maxNearbyWse = h;
            }
          }
        }
        if (maxNearbyWse > 0 && nodeElev >= maxNearbyWse + 6.0) {
          safe[i] = 1;
          continue;
        }
      }

      // 3. Clear of flood: outside the horizontal near-flood buffer
      if (!near[idx]) {
        safe[i] = 1;
        continue;
      }
    }
  }

  // Compressed adjacency
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

  return { lng: Float64Array.from(lng), lat: Float64Array.from(lat), elev, floods, safe, heads, to, cost };
}

/** Binary max-heap of (node, pri), largest priority first. */
class MaxQueue {
  private readonly node: number[] = [];
  private readonly pri: number[] = [];

  get size(): number {
    return this.node.length;
  }

  push(node: number, pri: number): void {
    this.node.push(node);
    this.pri.push(pri);
    let i = this.node.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.pri[parent] >= this.pri[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): { node: number; pri: number } {
    const node = this.node[0];
    const pri = this.pri[0];
    const lastNode = this.node.pop() as number;
    const lastPri = this.pri.pop() as number;
    if (this.node.length > 0) {
      this.node[0] = lastNode;
      this.pri[0] = lastPri;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let best = i;
        if (l < this.pri.length && this.pri[l] > this.pri[best]) best = l;
        if (r < this.pri.length && this.pri[r] > this.pri[best]) best = r;
        if (best === i) break;
        this.swap(i, best);
        i = best;
      }
    }
    return { node, pri };
  }

  private swap(a: number, b: number): void {
    [this.node[a], this.node[b]] = [this.node[b], this.node[a]];
    [this.pri[a], this.pri[b]] = [this.pri[b], this.pri[a]];
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

export interface RoutingResult {
  /** latest[u]: latest departure second from node u to reach safety */
  latest: Float64Array;
  /** nextHop[u]: next node along safest route towards safety */
  nextHop: Int32Array;
}

/**
 * Reverse Label-Correcting Max-Heap search starting at safe nodes.
 * Computes the maximum possible departure time `latest[u]` for every junction such that
 * leaving at `t <= latest[u]` guarantees reaching a safe destination before flood waters arrive.
 */
export function computeReverseRouting(graph: Graph, safety: number): RoutingResult {
  const n = graph.lng.length;
  const latest = new Float64Array(n).fill(-Infinity);
  const nextHop = new Int32Array(n).fill(-1);

  const queue = new MaxQueue();

  // Initialize all safe destinations
  for (let i = 0; i < n; i++) {
    if (graph.safe[i]) {
      latest[i] = Infinity;
      nextHop[i] = i;
      queue.push(i, Infinity);
    }
  }

  while (queue.size > 0) {
    const { node: v, pri } = queue.pop();
    if (pri < latest[v]) continue;

    // Predecessors u that can travel u -> v
    for (let e = graph.heads[v]; e < graph.heads[v + 1]; e++) {
      const u = graph.to[e];
      const cost = graph.cost[e];

      // To traverse u -> v departing u at t:
      // 1. t + safety <= floods[u]          => t <= floods[u] - safety
      // 2. t + cost + safety <= floods[v]   => t <= floods[v] - safety - cost
      // 3. t + cost <= latest[v]            => t <= latest[v] - cost
      const cand = Math.min(
        graph.floods[u] - safety,
        graph.floods[v] - safety - cost,
        latest[v] - cost,
      );

      if (cand > latest[u]) {
        latest[u] = cand;
        nextHop[u] = v;
        queue.push(u, cand);
      }
    }
  }

  return { latest, nextHop };
}

/**
 * Synchronous evacuation route planning against arrival times.
 */
export function planEvacuationSync(
  index: ExposureIndex,
  g: GridGeometry,
  summary: { arrival: Float32Array; maxDepth: Float32Array },
  options: EvacuationOptions = {},
): EvacuationRoute[] {
  const departAt = options.departAt ?? 0;
  const safety = options.safetySeconds ?? 300;
  const dem = options.dem;
  const graph = buildGraph(index, g, summary.arrival, summary.maxDepth, dem, options.safeBufferM ?? 400);
  if (graph.lng.length === 0) return [];

  const routing = computeReverseRouting(graph, safety);

  const wanted =
    options.assets ??
    index.assets
      .map((a, i) => ({ a, i }))
      .filter(({ a }) => {
        if (a.kind !== 'settlement') return false;
        for (let j = 0; j < a.footprint.length; j++) if (summary.arrival[a.footprint[j]] >= 0) return true;
        const cell = lngLatToCell(g, a.lng, a.lat);
        return !!cell && summary.arrival[cell.index] >= 0;
      })
      .map(({ i }) => i);

  const out: EvacuationRoute[] = [];
  for (const asset of wanted) {
    const a = index.assets[asset];
    const start = nearestNode(graph, a.lng, a.lat, 3000);
    if (start < 0) {
      out.push({
        asset,
        name: a.name,
        path: [],
        lengthM: 0,
        travelSeconds: 0,
        latestDepartureSeconds: -Infinity,
        marginSeconds: 0,
        status: 'no-road',
      });
      continue;
    }

    const latest = routing.latest[start];
    if (latest === -Infinity) {
      // Cut off from reaching safe ground
      out.push({
        asset,
        name: a.name,
        path: [[graph.lng[start], graph.lat[start]]],
        path3d: dem ? [[graph.lng[start], graph.lat[start], graph.elev[start] + 4]] : undefined,
        lengthM: 0,
        travelSeconds: 0,
        latestDepartureSeconds: -Infinity,
        marginSeconds: 0,
        status: 'cut-off',
      });
      continue;
    }

    // Trace route to safety
    const path: [number, number][] = [];
    const path3d: [number, number, number][] = [];
    let curr = start;
    const visited = new Set<number>();
    let margin = Infinity;

    while (curr >= 0 && !visited.has(curr)) {
      visited.add(curr);
      const lng = graph.lng[curr];
      const lat = graph.lat[curr];
      path.push([lng, lat]);

      if (dem) {
        const cell = lngLatToCell(g, lng, lat);
        const z = cell ? sampleBilinear(dem, g.cols, g.rows, cell.col, cell.row) + 4 : graph.elev[curr] + 4;
        path3d.push([lng, lat, z]);
      }

      if (graph.floods[curr] !== Infinity) {
        margin = Math.min(margin, graph.floods[curr] - departAt);
      }

      if (graph.safe[curr]) break;
      const next = routing.nextHop[curr];
      if (next < 0 || next === curr) break;
      curr = next;
    }

    let lengthM = 0;
    let travelSeconds = 0;
    for (let i = 1; i < path.length; i++) {
      const d = haversine(path[i - 1], path[i]);
      lengthM += d;
      travelSeconds += d / 11.1;
    }

    out.push({
      asset,
      name: a.name,
      path,
      path3d: dem ? path3d : undefined,
      lengthM,
      travelSeconds,
      latestDepartureSeconds: latest,
      marginSeconds: margin,
      status: 'ok',
    });
  }

  return out;
}

let evacuationWorker: Worker | null = null;
let nextRequestId = 1;
const pendingRequests = new Map<number, (routes: EvacuationRoute[]) => void>();

function getEvacuationWorker(): Worker | null {
  if (typeof window === 'undefined') return null;
  if (!evacuationWorker) {
    try {
      evacuationWorker = new Worker(new URL('./evacuationWorker.ts', import.meta.url), { type: 'module' });
      evacuationWorker.onmessage = (e: MessageEvent<{ id: number; routes: EvacuationRoute[] }>) => {
        const cb = pendingRequests.get(e.data.id);
        if (cb) {
          pendingRequests.delete(e.data.id);
          cb(e.data.routes);
        }
      };
      evacuationWorker.onerror = (err) => {
        console.warn('[evacuationWorker] worker error, will fall back to sync:', err);
      };
    } catch {
      evacuationWorker = null;
    }
  }
  return evacuationWorker;
}

/**
 * Asynchronous evacuation route planning off the main thread with fallback to in-thread sync execution.
 */
export function planEvacuation(
  index: ExposureIndex,
  g: GridGeometry,
  summary: { arrival: Float32Array; maxDepth: Float32Array },
  options: EvacuationOptions = {},
): Promise<EvacuationRoute[]> {
  const worker = getEvacuationWorker();
  if (!worker) {
    return Promise.resolve(planEvacuationSync(index, g, summary, options));
  }

  const id = nextRequestId++;
  return new Promise((resolve) => {
    pendingRequests.set(id, resolve);
    // Structured cloning only (no transfer lists)
    worker.postMessage({
      id,
      exposure: index,
      grid: g,
      summary,
      options,
    });
  });
}
