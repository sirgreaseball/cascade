// Samples a DEM onto a lng/lat grid from "Terrarium" encoded web-mercator tiles
// (AWS Open Data Terrain Tiles, which are built mostly from SRTM 30 m in India).
// Decoding and tile I/O are injected so the same sampler runs in the browser
// (fetch + canvas) and in the Node data-build script (fetch + zlib PNG decode).
// Self-contained on purpose: no imports.

export const TERRARIUM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const TERRARIUM_ATTRIBUTION = 'Terrain Tiles (AWS Open Data; SRTM, NASA / USGS)';

export interface RGBATile {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
  /** Bytes per pixel in `data` (4 for RGBA, 3 for RGB). */
  channels: number;
}

export type TileFetcher = (z: number, x: number, y: number) => Promise<RGBATile | null>;

interface Spec {
  cols: number;
  rows: number;
  bbox: [number, number, number, number];
}

export function lngToTileX(lng: number, z: number): number {
  return ((lng + 180) / 360) * 2 ** z;
}

export function latToTileY(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}

/** Ground size of one tile pixel in metres at a latitude. */
export function pixelSizeMetres(lat: number, z: number): number {
  return (156_543.033_92 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
}

export function tileRange(bbox: Spec['bbox'], z: number) {
  const x0 = Math.floor(lngToTileX(bbox[0], z));
  const x1 = Math.floor(lngToTileX(bbox[2], z));
  const y0 = Math.floor(latToTileY(bbox[3], z));
  const y1 = Math.floor(latToTileY(bbox[1], z));
  return { x0, x1, y0, y1, count: (x1 - x0 + 1) * (y1 - y0 + 1) };
}

/** Highest zoom whose pixels are at most half a grid cell, capped so the tile count stays sane. */
export function chooseZoom(spec: Spec, maxTiles = 160): number {
  const midLat = (spec.bbox[1] + spec.bbox[3]) / 2;
  const cellM = ((spec.bbox[2] - spec.bbox[0]) * 111_320 * Math.cos((midLat * Math.PI) / 180)) / spec.cols;
  let z = 8;
  for (let candidate = 8; candidate <= 13; candidate++) {
    if (tileRange(spec.bbox, candidate).count > maxTiles) break;
    z = candidate;
    if (pixelSizeMetres(midLat, candidate) <= cellM / 2) break;
  }
  return z;
}

export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

export interface SampleProgress {
  loaded: number;
  total: number;
}

/**
 * Box-filters every tile pixel whose centre falls inside a grid cell (falls back to the
 * nearest pixel for cells smaller than a pixel). Returns north-up row-major Float32 metres.
 */
export async function sampleTerrariumGrid(
  spec: Spec,
  fetchTile: TileFetcher,
  opts: { zoom?: number; concurrency?: number; onProgress?: (p: SampleProgress) => void } = {},
): Promise<{ elevation: Float32Array; zoom: number; missingTiles: number }> {
  const z = opts.zoom ?? chooseZoom(spec);
  const range = tileRange(spec.bbox, z);
  const tiles = new Map<string, RGBATile | null>();
  const jobs: Array<[number, number]> = [];
  for (let ty = range.y0; ty <= range.y1; ty++) for (let tx = range.x0; tx <= range.x1; tx++) jobs.push([tx, ty]);

  let loaded = 0;
  let missingTiles = 0;
  const concurrency = opts.concurrency ?? 8;
  let cursor = 0;
  const worker = async () => {
    while (cursor < jobs.length) {
      const [tx, ty] = jobs[cursor++];
      let tile: RGBATile | null = null;
      for (let attempt = 0; attempt < 3 && !tile; attempt++) {
        try {
          tile = await fetchTile(z, tx, ty);
        } catch {
          tile = null;
        }
      }
      if (!tile) missingTiles++;
      tiles.set(`${tx},${ty}`, tile);
      loaded++;
      opts.onProgress?.({ loaded, total: jobs.length });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));

  const { cols, rows, bbox } = spec;
  const lngStep = (bbox[2] - bbox[0]) / cols;
  const latStep = (bbox[3] - bbox[1]) / rows;
  const elevation = new Float32Array(cols * rows);
  const pixelAt = (gx: number, gy: number): number => {
    const tx = Math.floor(gx / 256);
    const ty = Math.floor(gy / 256);
    const tile = tiles.get(`${tx},${ty}`);
    if (!tile) return NaN;
    const px = Math.min(tile.width - 1, Math.max(0, Math.floor(gx - tx * 256)));
    const py = Math.min(tile.height - 1, Math.max(0, Math.floor(gy - ty * 256)));
    const o = (py * tile.width + px) * tile.channels;
    return decodeTerrarium(tile.data[o], tile.data[o + 1], tile.data[o + 2]);
  };

  const scale = 256 * 2 ** z;
  const colPx0 = new Float64Array(cols + 1);
  for (let c = 0; c <= cols; c++) colPx0[c] = ((bbox[0] + c * lngStep + 180) / 360) * scale;
  const rowPx0 = new Float64Array(rows + 1);
  for (let r = 0; r <= rows; r++) rowPx0[r] = (latToTileY(bbox[3] - r * latStep, z) / 2 ** z) * scale;

  for (let r = 0; r < rows; r++) {
    const ya = rowPx0[r];
    const yb = rowPx0[r + 1];
    const py0 = Math.ceil(ya - 0.5);
    const py1 = Math.floor(yb - 0.5);
    for (let c = 0; c < cols; c++) {
      const xa = colPx0[c];
      const xb = colPx0[c + 1];
      const px0 = Math.ceil(xa - 0.5);
      const px1 = Math.floor(xb - 0.5);
      let sum = 0;
      let n = 0;
      for (let py = py0; py <= py1; py++) {
        for (let px = px0; px <= px1; px++) {
          const v = pixelAt(px + 0.5, py + 0.5);
          if (Number.isFinite(v)) {
            sum += v;
            n++;
          }
        }
      }
      if (n === 0) {
        const v = pixelAt((xa + xb) / 2, (ya + yb) / 2);
        elevation[r * cols + c] = Number.isFinite(v) ? v : NaN;
      } else {
        elevation[r * cols + c] = sum / n;
      }
    }
  }
  fillNoData(elevation, cols, rows);
  return { elevation, zoom: z, missingTiles };
}

/** Replaces NaN / nodata cells by iteratively averaging valid neighbours. */
export function fillNoData(field: Float32Array, cols: number, rows: number, nodata = -9999): void {
  let remaining = 0;
  for (let i = 0; i < field.length; i++) {
    if (!Number.isFinite(field[i]) || field[i] <= nodata) {
      field[i] = NaN;
      remaining++;
    }
  }
  let guard = 0;
  while (remaining > 0 && guard++ < 512) {
    const next = field.slice();
    remaining = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (Number.isFinite(field[i])) continue;
        let s = 0;
        let n = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const rr = r + dr;
            const cc = c + dc;
            if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
            const v = field[rr * cols + cc];
            if (Number.isFinite(v)) {
              s += v;
              n++;
            }
          }
        }
        if (n > 0) next[i] = s / n;
        else remaining++;
      }
    }
    field.set(next);
  }
  if (remaining > 0) for (let i = 0; i < field.length; i++) if (!Number.isFinite(field[i])) field[i] = 0;
}

/** Encodes elevations as a Terrarium RGBA image (for deck.gl TerrainLayer in single-image mode). */
export function encodeTerrariumRGBA(elevation: ArrayLike<number>, out: Uint8ClampedArray): void {
  for (let i = 0; i < elevation.length; i++) {
    const v = Math.min(Math.max(elevation[i] + 32768, 0), 65535.99);
    const r = Math.floor(v / 256);
    const g = Math.floor(v - r * 256);
    const b = Math.floor((v - r * 256 - g) * 256);
    const o = i * 4;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = 255;
  }
}
