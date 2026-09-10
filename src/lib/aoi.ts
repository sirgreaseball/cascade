// Automatic study area: follow the river downstream from a dam on a coarse DEM and draw the
// box around that path. Uses priority-flood (always expand the lowest cell reached so far),
// which walks down the valley and fills pits instead of stopping in them.

import { bboxAround, gridGeometry, haversine, lngLatToCell, padBBox } from './geo/grid.ts';
import type { BBox } from './geo/grid.ts';
import { chooseZoom, sampleTerrariumGrid } from './geo/terrarium.ts';
import type { SampleProgress, TileFetcher } from './geo/terrarium.ts';

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size() {
    return this.keys.length;
  }
  push(key: number, val: number) {
    const k = this.keys;
    const v = this.vals;
    k.push(key);
    v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const k = this.keys;
    const v = this.vals;
    const top: [number, number] = [k[0], v[0]];
    const lk = k.pop() as number;
    const lv = v.pop() as number;
    if (k.length) {
      k[0] = lk;
      v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}

export interface StudyArea {
  bbox: BBox;
  path: [number, number][];
  /** Straight-line reach actually followed (km). */
  reachKm: number;
}

export async function autoStudyArea(
  lng: number,
  lat: number,
  reachKm: number,
  widthKm: number,
  fetchTile: TileFetcher,
  onProgress?: (p: SampleProgress) => void,
): Promise<StudyArea> {
  const radius = reachKm * 1000 * 1.1 + 3000;
  const spec = { cols: 220, rows: 220, bbox: bboxAround(lng, lat, radius) };
  const { elevation } = await sampleTerrariumGrid(spec, fetchTile, { zoom: Math.min(chooseZoom(spec, 36), 11), onProgress });
  const g = gridGeometry(spec);
  const startCell = lngLatToCell(g, lng, lat);
  if (!startCell) throw new Error('Dam location is outside the search area.');

  // Snap to the lowest ground within ~1.5 km: the river at the dam toe.
  let start = startCell.index;
  const rr = Math.ceil(1500 / g.dy);
  const rc = Math.ceil(1500 / g.dx);
  for (let dr = -rr; dr <= rr; dr++) {
    for (let dc = -rc; dc <= rc; dc++) {
      const r = startCell.row + dr;
      const c = startCell.col + dc;
      if (r < 0 || c < 0 || r >= g.rows || c >= g.cols) continue;
      const k = r * g.cols + c;
      if (elevation[k] < elevation[start]) start = k;
    }
  }

  const n = g.cols * g.rows;
  const visited = new Uint8Array(n);
  const parent = new Int32Array(n).fill(-1);
  const heap = new MinHeap();
  heap.push(elevation[start], start);
  visited[start] = 1;
  const origin: [number, number] = [lng, lat];
  const center = (k: number): [number, number] => [g.bbox[0] + ((k % g.cols) + 0.5) * g.lngStep, g.bbox[3] - (Math.floor(k / g.cols) + 0.5) * g.latStep];
  let target = start;
  while (heap.size) {
    const [level, k] = heap.pop();
    const d = haversine(origin, center(k));
    if (d > haversine(origin, center(target))) target = k;
    if (d >= reachKm * 1000) {
      target = k;
      break;
    }
    const r = Math.floor(k / g.cols);
    const c = k % g.cols;
    if (r === 0 || c === 0 || r === g.rows - 1 || c === g.cols - 1) {
      target = k;
      break;
    }
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      const j = (r + dr) * g.cols + (c + dc);
      if (visited[j]) continue;
      visited[j] = 1;
      parent[j] = k;
      heap.push(Math.max(level, elevation[j]), j);
    }
  }

  const path: [number, number][] = [];
  for (let k = target; k !== -1; k = parent[k]) path.push(center(k));
  path.reverse();
  let box: BBox = [lng, lat, lng, lat];
  for (const [x, y] of path) box = [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)];
  box = padBBox(box, (widthKm * 1000) / 2);
  return { bbox: box, path, reachKm: haversine(origin, center(target)) / 1000 };
}
