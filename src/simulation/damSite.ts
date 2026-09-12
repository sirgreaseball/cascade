// Turns "a dam at lng/lat" into what the solvers need:
//  - the dam (or landslide blockage) burned into the DEM as a wall, so breach water cannot
//    run back upstream into the pre-impoundment valley that SRTM (Feb 2000) still shows;
//  - the cells just downstream of the axis that receive the breach hydrograph, spread over
//    the breach width (so breach width matters spatially as well as in the weir equation);
//  - the downstream direction.
// When the real crest is known (OpenStreetMap maps most large Indian dams) the wall is built
// on it, so the model and the map line up with the imagery. Otherwise the river direction is
// detected from the DEM itself, so this still works for any valley in India.

import { lngLatToGrid, localToLngLat, sampleBilinear } from '../lib/geo/grid.ts';
import type { GridGeometry } from '../lib/geo/grid.ts';
import type { SourceCell } from './types.ts';

type XY = [number, number];

export interface DamSiteInput {
  lng: number;
  lat: number;
  /** Structural height of the dam / blockage (m). */
  height: number;
  /** Crest length (m). The wall is extended automatically until it meets higher ground. */
  crestLength: number;
  /** Final breach width (m): the width over which outflow enters the downstream grid. */
  breachWidth: number;
  /** The real crest, abutment to abutment, as lng/lat points (e.g. from OpenStreetMap). */
  crestLine?: XY[] | null;
  /** Optional explicit axis, abutment to abutment: a two-point crest line. */
  axis?: [XY, XY];
  /** Search radius (m) for snapping an approximate location to the valley floor. */
  snapRadius?: number;
  /**
   * Decisions already taken on a finer grid, to be reused rather than re-derived: which way is
   * downstream, the riverbed and the crest. Which side of a dam is downstream is a property of
   * the dam, not of the cell size — but box-averaging a DEM fills a narrow downstream gorge
   * faster than a wide reservoir valley, so on coarse cells the "lower side" test can flip and
   * discharge the breach backwards into the reservoir. The Fast setting passes this.
   */
  reference?: SiteReference;
}

export interface SiteReference {
  /** Downstream unit vector in grid axes (x east, y south). */
  direction: [number, number];
  /** Riverbed elevation at the dam (m a.s.l.). */
  bedElevation: number;
  /** Crest elevation (m a.s.l.). */
  crestElevation: number;
}

export interface DamSite {
  elevation: Float32Array;
  sources: SourceCell[];
  /** Unit vector pointing downstream, grid axes (x east, y south). */
  direction: [number, number];
  /** Ends of the burned wall (may run past the crest to seal low saddles). */
  axis: [XY, XY];
  /** The crest as the map draws it: the real crest line when known, else a straight axis. */
  crestLine: XY[];
  /** Ends of the crest line. */
  crestAxis: [XY, XY];
  /** Riverbed point on the dam axis. */
  bed: { lng: number; lat: number; elevation: number };
  crestElevation: number;
  wallCells: number;
}

export function prepareDamSite(g: GridGeometry, dem: Float32Array, input: DamSiteInput): DamSite {
  const start = lngLatToGrid(g, input.lng, input.lat);
  if (start.x < 0 || start.y < 0 || start.x >= g.cols || start.y >= g.rows) {
    throw new Error('The dam location is outside the study area.');
  }
  const line = input.crestLine && input.crestLine.length >= 2 ? input.crestLine : input.axis;
  return (line && siteOnLine(g, dem, input, line)) || siteFromTerrain(g, dem, input);
}

/** Bilinear ground elevation at local metres (x east, y south from the NW corner). */
function sampler(g: GridGeometry, dem: Float32Array) {
  return (x: number, y: number) => {
    if (x < 0 || y < 0 || x > g.width || y > g.height) return Number.POSITIVE_INFINITY;
    return sampleBilinear(dem, g.cols, g.rows, x / g.dx, y / g.dy);
  };
}

/** Elevation of the cell containing a point (clamped to the grid). */
function cellAt(g: GridGeometry, dem: Float32Array, x: number, y: number): number {
  return dem[Math.min(g.rows - 1, Math.max(0, Math.floor(y / g.dy))) * g.cols + Math.min(g.cols - 1, Math.max(0, Math.floor(x / g.dx)))];
}

/**
 * Raises every cell within 0.8 cells of a point to the crest: a disc that keeps the wall
 * 8-connected and therefore blocks 4-connected face fluxes.
 */
function wallStamper(g: GridGeometry, elevation: Float32Array, crest: number) {
  const { cols, rows, dx, dy } = g;
  const rr = 0.8 * Math.max(dx, dy);
  let count = 0;
  const stamp = (x: number, y: number) => {
    const c0 = Math.floor((x - rr) / dx);
    const c1 = Math.floor((x + rr) / dx);
    const r0 = Math.floor((y - rr) / dy);
    const r1 = Math.floor((y + rr) / dy);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
        const ccx = (c + 0.5) * dx;
        const ccy = (r + 0.5) * dy;
        if ((ccx - x) ** 2 + (ccy - y) ** 2 > rr * rr) continue;
        const k = r * cols + c;
        if (elevation[k] < crest) {
          elevation[k] = crest;
          count++;
        }
      }
    }
  };
  return { stamp, count: () => count };
}

/**
 * Breach outflow cells: a line parallel to the axis just downstream, spanning the breach width
 * centred on the channel. Outflow is shared like flow over a weir — in proportion to
 * (crest − bed)^1.5 — so the valley floor takes most of it, not the walls.
 * The channel is the lowest non-wall cell up to `reach` cells downstream and three cells either
 * side: in winding gorges a straight offset can land on the valley wall, where the "tailwater"
 * would sit above the reservoir and wrongly drown the breach.
 */
function breachSources(
  g: GridGeometry,
  dem: Float32Array,
  elevation: Float32Array,
  crest: number,
  centre: XY,
  down: XY,
  along: XY,
  breachWidth: number,
  reach = 4,
): SourceCell[] {
  const { cols, rows, dx, dy } = g;
  const cell = Math.max(dx, dy);
  const [cx, cy] = centre;
  const [fx, fy] = down;
  const [ax, ay] = along;
  let sx = cx + fx * 2.2 * cell;
  let sy = cy + fy * 2.2 * cell;
  let toeZ = Number.POSITIVE_INFINITY;
  for (let a = 1; a <= reach; a += 0.5) {
    for (let s = -3; s <= 3; s += 0.5) {
      const x = cx + (fx * a + ax * s) * cell;
      const y = cy + (fy * a + ay * s) * cell;
      const c = Math.floor(x / dx);
      const r = Math.floor(y / dy);
      if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
      const k = r * cols + c;
      if (elevation[k] >= crest - 1e-3) continue;
      if (dem[k] < toeZ) {
        toeZ = dem[k];
        sx = (c + 0.5) * dx;
        sy = (r + 0.5) * dy;
      }
    }
  }
  const width = Math.max(breachWidth, cell);
  const picked = new Map<number, number>();
  for (let s = -width / 2; s <= width / 2 + 1e-6; s += Math.min(dx, dy) / 2) {
    const x = sx + ax * s;
    const y = sy + ay * s;
    const c = Math.floor(x / dx);
    const r = Math.floor(y / dy);
    if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
    const k = r * cols + c;
    const depthBelowCrest = crest - elevation[k];
    if (depthBelowCrest <= 5) continue;
    picked.set(k, (picked.get(k) ?? 0) + depthBelowCrest ** 1.5);
  }
  if (picked.size === 0) {
    const c = Math.min(cols - 1, Math.max(0, Math.floor(sx / dx)));
    const r = Math.min(rows - 1, Math.max(0, Math.floor(sy / dy)));
    picked.set(r * cols + c, 1);
  }
  const total = [...picked.values()].reduce((a, b) => a + b, 0);
  return [...picked.entries()].map(([index, n]) => ({ index, weight: n / total }));
}

/**
 * The dam on its real crest line. Downstream is the side whose low ground (the river below the
 * dam) lies lower than the reservoir side; the bed is the lowest ground just below the dam, and
 * the breach opens where the crest line passes closest to it.
 */
function siteOnLine(g: GridGeometry, dem: Float32Array, input: DamSiteInput, lineLngLat: XY[]): DamSite | null {
  const { dx, dy } = g;
  const cell = Math.max(dx, dy);
  const elevAt = sampler(g, dem);
  const pts = lineLngLat.map(([lng, lat]) => {
    const p = lngLatToGrid(g, lng, lat);
    return [p.x * dx, p.y * dy] as XY;
  });
  if (!pts.some(([x, y]) => x >= 0 && y >= 0 && x <= g.width && y <= g.height)) return null;

  // Stations every third of a cell along the crest, each with its segment's unit tangent.
  const stations: { x: number; y: number; tx: number; ty: number }[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 1e-6) continue;
    const tx = (x1 - x0) / len;
    const ty = (y1 - y0) / len;
    const n = Math.max(1, Math.ceil(len / (cell / 3)));
    for (let k = 0; k < n; k++) stations.push({ x: x0 + (tx * len * k) / n, y: y0 + (ty * len * k) / n, tx, ty });
    if (i + 2 === pts.length) stations.push({ x: x1, y: y1, tx, ty });
  }
  if (stations.length < 2) return null;

  // Lowest ground on one side of the crest (side +1 is the tangent's left normal).
  const lowest = (side: number, from: number, to: number) => {
    let best = { z: Number.POSITIVE_INFINITY, x: 0, y: 0 };
    for (const s of stations) {
      for (let d = from; d <= to; d += cell / 2) {
        const x = s.x - s.ty * d * side;
        const y = s.y + s.tx * d * side;
        const z = elevAt(x, y);
        if (z < best.z) best = { z, x, y };
      }
    }
    return best;
  };
  const clear = 1.5 * cell;
  const far = Math.max(2000, 8 * cell);
  const ref = input.reference;
  let side: number;
  if (ref) {
    // The side whose outward normal agrees with the direction already established.
    let tx = 0;
    let ty = 0;
    for (const s of stations) {
      tx += s.tx;
      ty += s.ty;
    }
    side = -ty * ref.direction[0] + tx * ref.direction[1] >= 0 ? 1 : -1;
  } else {
    side = lowest(1, clear, far).z <= lowest(-1, clear, far).z ? 1 : -1;
  }
  const toe = lowest(side, clear, Math.max(800, 5 * cell));
  if (!Number.isFinite(toe.z)) return null;

  // Where the crest passes closest to the riverbed below it: the breach centre.
  let centre = { x: stations[0].x, y: stations[0].y, tx: stations[0].tx, ty: stations[0].ty, d: Number.POSITIVE_INFINITY };
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const l2 = (x1 - x0) ** 2 + (y1 - y0) ** 2;
    if (l2 < 1e-9) continue;
    const t = Math.min(1, Math.max(0, ((toe.x - x0) * (x1 - x0) + (toe.y - y0) * (y1 - y0)) / l2));
    const x = x0 + t * (x1 - x0);
    const y = y0 + t * (y1 - y0);
    const d = Math.hypot(toe.x - x, toe.y - y);
    if (d < centre.d) {
      const len = Math.sqrt(l2);
      centre = { x, y, tx: (x1 - x0) / len, ty: (y1 - y0) / len, d };
    }
  }
  const bedZ = ref ? ref.bedElevation : toe.z;
  const crest = ref ? ref.crestElevation : bedZ + input.height;
  const fx = -centre.ty * side;
  const fy = centre.tx * side;

  // Burn the crest, then carry the wall past each abutment until the ground reaches the crest
  // (at most 300 m or three cells), sealing saddles the coarse DEM smooths away.
  const elevation = new Float32Array(dem);
  const wall = wallStamper(g, elevation, crest);
  for (const s of stations) wall.stamp(s.x, s.y);
  const extendMax = Math.max(300, 3 * cell);
  const ends: XY[] = [];
  for (const [s, sign] of [
    [stations[0], -1],
    [stations[stations.length - 1], 1],
  ] as const) {
    let last: XY = [s.x, s.y];
    for (let d = cell / 3; d <= extendMax; d += cell / 3) {
      const x = s.x + s.tx * d * sign;
      const y = s.y + s.ty * d * sign;
      if (x < 0 || y < 0 || x > g.width || y > g.height) break;
      if (cellAt(g, dem, x, y) >= crest) break;
      wall.stamp(x, y);
      last = [x, y];
    }
    ends.push(last);
  }

  const sources = breachSources(g, dem, elevation, crest, [centre.x, centre.y], [fx, fy], [centre.tx, centre.ty], input.breachWidth, 6);
  const bed = localToLngLat(g, centre.x, centre.y);
  const crestLine = lineLngLat.map(([lng, lat]) => [lng, lat] as XY);
  return {
    elevation,
    sources,
    direction: [fx, fy],
    axis: [localToLngLat(g, ends[0][0], ends[0][1]), localToLngLat(g, ends[1][0], ends[1][1])],
    crestLine,
    crestAxis: [crestLine[0], crestLine[crestLine.length - 1]],
    bed: { lng: bed[0], lat: bed[1], elevation: bedZ },
    crestElevation: crest,
    wallCells: wall.count(),
  };
}

/** No crest line: snap to the valley floor and detect the river direction from the DEM. */
function siteFromTerrain(g: GridGeometry, dem: Float32Array, input: DamSiteInput): DamSite {
  const { dx, dy } = g;
  const cell = Math.max(dx, dy);
  const start = lngLatToGrid(g, input.lng, input.lat);
  const elevAt = sampler(g, dem);
  // Approximate coordinates are snapped to the lowest ground nearby, i.e. onto the river.
  let x0 = start.x * dx;
  let y0 = start.y * dy;
  const snap = input.snapRadius ?? 300;
  if (snap > 0) {
    let bz = elevAt(x0, y0);
    let bx = x0;
    let by = y0;
    const stepM = Math.min(dx, dy) / 2;
    for (let oy = -snap; oy <= snap; oy += stepM) {
      for (let ox = -snap; ox <= snap; ox += stepM) {
        if (ox * ox + oy * oy > snap * snap) continue;
        const zz = elevAt(x0 + ox, y0 + oy);
        if (zz < bz) {
          bz = zz;
          bx = x0 + ox;
          by = y0 + oy;
        }
      }
    }
    x0 = bx;
    y0 = by;
  }

  // 1. River direction: the lowest point on a ring around the dam is downstream; the lowest
  //    point at least ~100° away from it is the upstream valley.
  const radius = Math.max(800, 6 * cell);
  const N = 72;
  const ring: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    ring.push(elevAt(x0 + radius * Math.cos(a), y0 + radius * Math.sin(a)));
  }
  const smooth = ring.map((_, i) => (ring[(i - 1 + N) % N] + 2 * ring[i] + ring[(i + 1) % N]) / 4);
  let down = 0;
  for (let i = 1; i < N; i++) if (smooth[i] < smooth[down]) down = i;
  let up = -1;
  for (let i = 0; i < N; i++) {
    const sep = Math.min(Math.abs(i - down), N - Math.abs(i - down));
    if (sep < (100 / 360) * N) continue;
    if (up < 0 || smooth[i] < smooth[up]) up = i;
  }
  const angle = (i: number) => (i / N) * Math.PI * 2;
  let fx = Math.cos(angle(down)) - (up >= 0 ? Math.cos(angle(up)) : 0);
  let fy = Math.sin(angle(down)) - (up >= 0 ? Math.sin(angle(up)) : 0);
  const norm = Math.hypot(fx, fy) || 1;
  fx /= norm;
  fy /= norm;
  const ref = input.reference;
  if (ref) {
    [fx, fy] = ref.direction;
  }
  const ax = -fy;
  const ay = fx;

  // 2. Snap to the thalweg along the axis line (the riverbed under the dam).
  const half = Math.max(input.crestLength / 2, 3 * cell);
  let best = { s: 0, z: Number.POSITIVE_INFINITY };
  for (let s = -half; s <= half; s += cell / 3) {
    const z = elevAt(x0 + ax * s, y0 + ay * s);
    if (z < best.z) best = { s, z };
  }
  const cx = x0 + ax * best.s;
  const cy = y0 + ay * best.s;
  const bedZ = ref ? ref.bedElevation : best.z;
  const crest = ref ? ref.crestElevation : bedZ + input.height;

  // 3. Burn the wall. Walk both ways along the axis until the crest length is covered AND the
  //    ground rises above the crest. The wall never runs further than half a crest length
  //    (min 300 m) past each abutment: where the DEM stays low along the line (a filled
  //    reservoir, a wide saddle) an unbounded walk produced kilometre-long walls.
  const maxHalf = input.crestLength / 2 + Math.max(input.crestLength / 2, 300);
  const elevation = new Float32Array(dem);
  const wall = wallStamper(g, elevation, crest);
  const ends: XY[] = [];
  for (const sign of [-1, 1]) {
    let s = 0;
    let lastX = cx;
    let lastY = cy;
    while (s <= maxHalf) {
      const x = cx + ax * s * sign;
      const y = cy + ay * s * sign;
      if (x < 0 || y < 0 || x > g.width || y > g.height) break;
      if (s > input.crestLength / 2 && cellAt(g, dem, x, y) >= crest) break;
      wall.stamp(x, y);
      lastX = x;
      lastY = y;
      s += cell / 3;
    }
    ends.push([lastX, lastY]);
  }

  const sources = breachSources(g, dem, elevation, crest, [cx, cy], [fx, fy], [ax, ay], input.breachWidth);
  const bedLngLat = localToLngLat(g, cx, cy);
  const halfCrest = input.crestLength / 2;
  const crestAxis: [XY, XY] = [localToLngLat(g, cx - ax * halfCrest, cy - ay * halfCrest), localToLngLat(g, cx + ax * halfCrest, cy + ay * halfCrest)];
  return {
    elevation,
    sources,
    direction: [fx, fy],
    axis: [localToLngLat(g, ends[0][0], ends[0][1]), localToLngLat(g, ends[1][0], ends[1][1])],
    crestLine: [crestAxis[0], crestAxis[1]],
    crestAxis,
    bed: { lng: bedLngLat[0], lat: bedLngLat[1], elevation: bedZ },
    crestElevation: crest,
    wallCells: wall.count(),
  };
}
