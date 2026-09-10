// Regular lng/lat raster geometry shared by the solvers, analytics, exporters and the map.
// Row 0 is the northern edge; cells are addressed row-major (index = row * cols + col).
// Self-contained on purpose: the Node data-build scripts import this file directly.

export type BBox = [minLng: number, minLat: number, maxLng: number, maxLat: number];

export interface GridSpec {
  cols: number;
  rows: number;
  bbox: BBox;
}

export interface GridGeometry extends GridSpec {
  /** Cell width in degrees of longitude. */
  lngStep: number;
  /** Cell height in degrees of latitude. */
  latStep: number;
  /** Cell width in metres (east-west), evaluated at the bbox mid-latitude. */
  dx: number;
  /** Cell height in metres (north-south). */
  dy: number;
  cellArea: number;
  /** Domain size in metres. */
  width: number;
  height: number;
}

const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LNG_EQ = 111_320;

export function metresPerDegree(lat: number): { lng: number; lat: number } {
  return { lng: M_PER_DEG_LNG_EQ * Math.cos((lat * Math.PI) / 180), lat: M_PER_DEG_LAT };
}

export function gridGeometry(spec: GridSpec): GridGeometry {
  const [minLng, minLat, maxLng, maxLat] = spec.bbox;
  const lngStep = (maxLng - minLng) / spec.cols;
  const latStep = (maxLat - minLat) / spec.rows;
  const m = metresPerDegree((minLat + maxLat) / 2);
  const dx = lngStep * m.lng;
  const dy = latStep * m.lat;
  return {
    ...spec,
    lngStep,
    latStep,
    dx,
    dy,
    cellArea: dx * dy,
    width: dx * spec.cols,
    height: dy * spec.rows,
  };
}

/** Picks cols/rows for a bbox so cells are close to `cellMetres` and the grid stays under `maxCells`. */
export function gridForBBox(bbox: BBox, cellMetres: number, maxCells = 400_000): GridSpec {
  const m = metresPerDegree((bbox[1] + bbox[3]) / 2);
  const w = (bbox[2] - bbox[0]) * m.lng;
  const h = (bbox[3] - bbox[1]) * m.lat;
  let size = cellMetres;
  let cols = Math.max(16, Math.round(w / size));
  let rows = Math.max(16, Math.round(h / size));
  while (cols * rows > maxCells) {
    size *= 1.1;
    cols = Math.max(16, Math.round(w / size));
    rows = Math.max(16, Math.round(h / size));
  }
  return { cols, rows, bbox };
}

export function cellCenter(g: GridGeometry, col: number, row: number): [number, number] {
  return [g.bbox[0] + (col + 0.5) * g.lngStep, g.bbox[3] - (row + 0.5) * g.latStep];
}

/** Continuous grid coordinates (0..cols, 0..rows) for a lng/lat. */
export function lngLatToGrid(g: GridGeometry, lng: number, lat: number): { x: number; y: number } {
  return { x: (lng - g.bbox[0]) / g.lngStep, y: (g.bbox[3] - lat) / g.latStep };
}

export function lngLatToCell(g: GridGeometry, lng: number, lat: number): { col: number; row: number; index: number } | null {
  const { x, y } = lngLatToGrid(g, lng, lat);
  const col = Math.floor(x);
  const row = Math.floor(y);
  if (col < 0 || row < 0 || col >= g.cols || row >= g.rows) return null;
  return { col, row, index: row * g.cols + col };
}

/** Local metric coordinates (x east, y south, metres from the NW corner) -> lng/lat. */
export function localToLngLat(g: GridGeometry, x: number, y: number): [number, number] {
  return [g.bbox[0] + (x / g.dx) * g.lngStep, g.bbox[3] - (y / g.dy) * g.latStep];
}

export function lngLatToLocal(g: GridGeometry, lng: number, lat: number): [number, number] {
  return [((lng - g.bbox[0]) / g.lngStep) * g.dx, ((g.bbox[3] - lat) / g.latStep) * g.dy];
}

/** Bilinear sample of a cell-centred field at continuous grid coordinates. */
export function sampleBilinear(field: ArrayLike<number>, cols: number, rows: number, x: number, y: number): number {
  const fx = Math.min(Math.max(x - 0.5, 0), cols - 1);
  const fy = Math.min(Math.max(y - 0.5, 0), rows - 1);
  const c0 = Math.floor(fx);
  const r0 = Math.floor(fy);
  const c1 = Math.min(c0 + 1, cols - 1);
  const r1 = Math.min(r0 + 1, rows - 1);
  const tx = fx - c0;
  const ty = fy - r0;
  const a = field[r0 * cols + c0];
  const b = field[r0 * cols + c1];
  const c = field[r1 * cols + c0];
  const d = field[r1 * cols + c1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

export function haversine(a: [number, number], b: [number, number]): number {
  const R = 6_371_008.8;
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLng = (b[0] - a[0]) * toRad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function bboxAround(lng: number, lat: number, halfWidthM: number, halfHeightM = halfWidthM): BBox {
  const m = metresPerDegree(lat);
  const dLng = halfWidthM / m.lng;
  const dLat = halfHeightM / m.lat;
  return [lng - dLng, lat - dLat, lng + dLng, lat + dLat];
}

export function padBBox(b: BBox, padM: number): BBox {
  const m = metresPerDegree((b[1] + b[3]) / 2);
  return [b[0] - padM / m.lng, b[1] - padM / m.lat, b[2] + padM / m.lng, b[3] + padM / m.lat];
}
