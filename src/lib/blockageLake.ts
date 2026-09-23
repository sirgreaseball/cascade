// How much water a river blockage holds back.
//
// A landslide or debris dam is not a reservoir anyone has surveyed: the lake is whatever the valley
// behind the barrier can hold up to the barrier's crest. Rather than ask for a volume nobody knows,
// this fills the terrain upstream of the blockage to that level and measures what fits — the same
// level-pool idea the breach routing uses, run once on the DEM when the scenario is built.

export interface BlockageLake {
  /** Water level behind the barrier (m above sea level). */
  level: number;
  /** Bed elevation where the barrier sits (m above sea level). */
  bed: number;
  /** Impounded volume (million m³) and surface area (km²). */
  volumeMCM: number;
  areaKm2: number;
  /** Deepest water against the barrier (m). */
  waterDepth: number;
  /** True when the lake reaches the edge of the study area, so the volume is a lower bound. */
  spills: boolean;
}

interface Spec {
  cols: number;
  rows: number;
  bbox: [number, number, number, number];
}

/** Cells the fill may visit, so a wrongly placed barrier on flat ground cannot run away with memory. */
const MAX_CELLS = 400_000;

/**
 * The lake impounded behind a barrier of `barrierHeight` metres across the valley at (lng, lat).
 *
 * The barrier itself is drawn as a line of blocked cells across the flow, so the fill cannot leak
 * down the river it dams; the valley upstream is then filled to the crest. Returns null when the
 * point lies outside the grid.
 */
export function computeBlockageLake(
  dem: Float32Array,
  spec: Spec,
  barrier: { lng: number; lat: number; barrierHeight: number; barrierLength: number },
): BlockageLake | null {
  const { cols, rows, bbox } = spec;
  const lngStep = (bbox[2] - bbox[0]) / cols;
  const latStep = (bbox[3] - bbox[1]) / rows;
  const col = Math.floor((barrier.lng - bbox[0]) / lngStep);
  const row = Math.floor((bbox[3] - barrier.lat) / latStep);
  if (col < 0 || row < 0 || col >= cols || row >= rows) return null;
  const midLat = (bbox[1] + bbox[3]) / 2;
  const dx = lngStep * 111_320 * Math.cos((midLat * Math.PI) / 180);
  const dy = latStep * 110_574;
  const cellArea = dx * dy;
  const at = (r: number, c: number) => dem[r * cols + c];

  // Which way the river runs: the steepest fall across a few cells around the barrier.
  const reach = 3;
  let fallX = 0;
  let fallY = 0;
  for (let d = 1; d <= reach; d++) {
    const cW = Math.max(0, col - d);
    const cE = Math.min(cols - 1, col + d);
    const rN = Math.max(0, row - d);
    const rS = Math.min(rows - 1, row + d);
    fallX += at(row, cW) - at(row, cE);
    fallY += at(rN, col) - at(rS, col);
  }
  const fall = Math.hypot(fallX, fallY) || 1;
  // Unit vector pointing downstream, in grid axes (x east, y south).
  const ex = fallX / fall;
  const ey = fallY / fall;

  // The barrier: a line of blocked cells across the flow, long enough to close the valley.
  const blocked = new Uint8Array(cols * rows);
  const halfLength = Math.max(barrier.barrierLength, Math.max(dx, dy) * 3) / 2;
  const steps = Math.ceil(halfLength / Math.min(dx, dy));
  for (let s = -steps; s <= steps; s++) {
    const t = (s / Math.max(steps, 1)) * halfLength;
    // Along the barrier: perpendicular to the flow.
    const c = Math.round(col + (-ey * t) / dx);
    const r = Math.round(row + (ex * t) / dy);
    for (let w = -1; w <= 1; w++) {
      const cc = c + Math.round(ex * w);
      const rr = r + Math.round(ey * w);
      if (cc >= 0 && rr >= 0 && cc < cols && rr < rows) blocked[rr * cols + cc] = 1;
    }
  }

  const bed = at(row, col);
  const level = bed + Math.max(barrier.barrierHeight, 1);

  // Start one cell upstream of the barrier and fill everything below the crest that connects to it.
  let seed = -1;
  for (let step = 1; step <= 8 && seed < 0; step++) {
    const c = Math.min(cols - 1, Math.max(0, col - Math.round(ex * step)));
    const r = Math.min(rows - 1, Math.max(0, row - Math.round(ey * step)));
    // Look a little either side of the line upstream: the barrier's own cells are blocked.
    for (let side = 0; side <= step && seed < 0; side++) {
      for (const sign of [1, -1]) {
        const cc = Math.min(cols - 1, Math.max(0, c + Math.round(-ey * side * sign)));
        const rr = Math.min(rows - 1, Math.max(0, r + Math.round(ex * side * sign)));
        const k = rr * cols + cc;
        if (!blocked[k] && dem[k] < level) {
          seed = k;
          break;
        }
      }
    }
  }
  const seen = new Uint8Array(cols * rows);
  const queue = new Int32Array(MAX_CELLS);
  let head = 0;
  let tail = 0;
  let volume = 0;
  let cells = 0;
  let deepest = 0;
  let spills = false;
  if (seed >= 0) {
    queue[tail++] = seed;
    seen[seed] = 1;
  }
  while (head < tail) {
    const k = queue[head++];
    const r = (k / cols) | 0;
    const c = k - r * cols;
    const depth = level - dem[k];
    volume += depth * cellArea;
    cells++;
    if (depth > deepest) deepest = depth;
    if (r === 0 || c === 0 || r === rows - 1 || c === cols - 1) spills = true;
    const neighbours = [k - 1, k + 1, k - cols, k + cols];
    const sameRow = [true, true, false, false];
    for (let i = 0; i < 4; i++) {
      const n = neighbours[i];
      if (n < 0 || n >= cols * rows || seen[n] || blocked[n]) continue;
      // Stay inside the row when stepping east or west.
      if (sameRow[i] && ((n / cols) | 0) !== r) continue;
      if (dem[n] >= level) continue;
      if (tail >= MAX_CELLS) {
        spills = true;
        break;
      }
      seen[n] = 1;
      queue[tail++] = n;
    }
  }

  return {
    level,
    bed,
    volumeMCM: volume / 1e6,
    areaKm2: (cells * cellArea) / 1e6,
    waterDepth: Math.max(deepest, 1),
    spills,
  };
}
