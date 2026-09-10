// Turns "a dam at lng/lat" into what the solvers need:
//  - the dam (or landslide blockage) burned into the DEM as a wall, so breach water cannot
//    run back upstream into the pre-impoundment valley that SRTM (Feb 2000) still shows;
//  - the cells just downstream of the axis that receive the breach hydrograph, spread over
//    the breach width (so breach width matters spatially as well as in the weir equation);
//  - the downstream direction.
// River direction is detected from the DEM itself, so this works for any valley in India.

import { lngLatToGrid, localToLngLat, sampleBilinear } from '../lib/geo/grid.ts';
import type { GridGeometry } from '../lib/geo/grid.ts';
import type { SourceCell } from './types.ts';

export interface DamSiteInput {
  lng: number;
  lat: number;
  /** Structural height of the dam / blockage (m). */
  height: number;
  /** Crest length (m). The wall is extended automatically until it meets higher ground. */
  crestLength: number;
  /** Final breach width (m): the width over which outflow enters the downstream grid. */
  breachWidth: number;
  /** Optional explicit axis, abutment to abutment. Detected from the DEM when omitted. */
  axis?: [[number, number], [number, number]];
  /** Search radius (m) for snapping an approximate location to the valley floor. */
  snapRadius?: number;
}

export interface DamSite {
  elevation: Float32Array;
  sources: SourceCell[];
  /** Unit vector pointing downstream, grid axes (x east, y south). */
  direction: [number, number];
  axis: [[number, number], [number, number]];
  /** Riverbed point on the dam axis. */
  bed: { lng: number; lat: number; elevation: number };
  crestElevation: number;
  wallCells: number;
}

export function prepareDamSite(g: GridGeometry, dem: Float32Array, input: DamSiteInput): DamSite {
  const { cols, rows, dx, dy } = g;
  const cell = Math.max(dx, dy);
  const start = lngLatToGrid(g, input.lng, input.lat);
  if (start.x < 0 || start.y < 0 || start.x >= cols || start.y >= rows) {
    throw new Error('The dam location is outside the study area.');
  }
  const elevAt = (x: number, y: number) => {
    if (x < 0 || y < 0 || x > g.width || y > g.height) return Number.POSITIVE_INFINITY;
    return sampleBilinear(dem, cols, rows, x / dx, y / dy);
  };
  // Work in local metres (x east, y south from the NW corner). Approximate coordinates are
  // snapped to the lowest ground nearby, i.e. onto the river.
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
  let norm = Math.hypot(fx, fy) || 1;
  fx /= norm;
  fy /= norm;

  let ax = -fy;
  let ay = fx;
  if (input.axis) {
    const [a, b] = input.axis;
    const pa = lngLatToGrid(g, a[0], a[1]);
    const pb = lngLatToGrid(g, b[0], b[1]);
    ax = (pb.x - pa.x) * dx;
    ay = (pb.y - pa.y) * dy;
    norm = Math.hypot(ax, ay) || 1;
    ax /= norm;
    ay /= norm;
    // Downstream is the side of the axis that is lower.
    const side = elevAt(x0 - ay * radius, y0 + ax * radius) < elevAt(x0 + ay * radius, y0 - ax * radius) ? 1 : -1;
    fx = -ay * side;
    fy = ax * side;
  }

  // 2. Snap to the thalweg along the axis line (the riverbed under the dam).
  const half = Math.max(input.crestLength / 2, 3 * cell);
  let best = { s: 0, z: Number.POSITIVE_INFINITY };
  for (let s = -half; s <= half; s += cell / 3) {
    const z = elevAt(x0 + ax * s, y0 + ay * s);
    if (z < best.z) best = { s, z };
  }
  const cx = x0 + ax * best.s;
  const cy = y0 + ay * best.s;
  const bedZ = best.z;
  const crest = bedZ + input.height;

  // 3. Burn the wall. Walk both ways along the axis until the crest length is covered AND the
  //    ground rises above the crest (or 5 km), stamping a disc ≥ 0.75 cells so the wall stays
  //    8-connected and therefore blocks 4-connected face fluxes.
  const elevation = new Float32Array(dem);
  let wallCells = 0;
  const stamp = (x: number, y: number) => {
    const rr = 0.8 * cell;
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
          wallCells++;
        }
      }
    }
  };
  const ends: [number, number][] = [];
  for (const sign of [-1, 1]) {
    let s = 0;
    let lastX = cx;
    let lastY = cy;
    while (s < 5000) {
      const x = cx + ax * s * sign;
      const y = cy + ay * s * sign;
      if (x < 0 || y < 0 || x > g.width || y > g.height) break;
      if (s > input.crestLength / 2 && dem[Math.min(rows - 1, Math.floor(y / dy)) * cols + Math.min(cols - 1, Math.floor(x / dx))] >= crest) break;
      stamp(x, y);
      lastX = x;
      lastY = y;
      s += cell / 3;
    }
    ends.push([lastX, lastY]);
  }

  // 4. Breach outflow cells: a line parallel to the axis, two cells downstream, spanning the
  //    breach width centred on the thalweg. Outflow is shared like flow over a weir — in
  //    proportion to (crest − bed)^1.5 — so the valley floor takes most of it, not the walls.
  const offset = 2.2 * cell;
  const sx = cx + fx * offset;
  const sy = cy + fy * offset;
  const width = Math.max(input.breachWidth, cell);
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
  const sources: SourceCell[] = [...picked.entries()].map(([index, n]) => ({ index, weight: n / total }));

  const bedLngLat = localToLngLat(g, cx, cy);
  return {
    elevation,
    sources,
    direction: [fx, fy],
    axis: [localToLngLat(g, ends[0][0], ends[0][1]), localToLngLat(g, ends[1][0], ends[1][1])],
    bed: { lng: bedLngLat[0], lat: bedLngLat[1], elevation: bedZ },
    crestElevation: crest,
    wallCells,
  };
}
