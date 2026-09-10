// Reading user rasters (GeoTIFF, ESRI ASCII grid) and resampling them onto a scenario grid.
// Supports WGS84 lon/lat, WGS84 UTM (EPSG:326xx / 327xx) and Web Mercator (EPSG:3857), which
// covers SRTM/ASTER/CartoDEM downloads and typical Delft3D / HEC-RAS / GEE exports.

import type { GridGeometry } from './grid';

export type Crs = { kind: 'lnglat' } | { kind: 'utm'; zone: number; north: boolean } | { kind: 'mercator' };

export interface SourceRaster {
  width: number;
  height: number;
  values: Float32Array;
  /** [minX, minY, maxX, maxY] in the raster's own CRS; north-up, no rotation. */
  bbox: [number, number, number, number];
  crs: Crs;
  nodata: number | null;
  name: string;
}

export function crsLabel(crs: Crs): string {
  if (crs.kind === 'lnglat') return 'WGS 84 (EPSG:4326)';
  if (crs.kind === 'mercator') return 'Web Mercator (EPSG:3857)';
  return `WGS 84 / UTM ${crs.zone}${crs.north ? 'N' : 'S'} (EPSG:${crs.north ? 32600 + crs.zone : 32700 + crs.zone})`;
}

/** WGS84 lng/lat → UTM easting/northing (Snyder 1987, accurate to < 1 m within the zone). */
export function lngLatToUtm(lng: number, lat: number, zone: number, north: boolean): [number, number] {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const phi = (lat * Math.PI) / 180;
  const lam = ((lng - ((zone - 1) * 6 - 180 + 3)) * Math.PI) / 180;
  const sin = Math.sin(phi);
  const cos = Math.cos(phi);
  const tan = Math.tan(phi);
  const N = a / Math.sqrt(1 - e2 * sin * sin);
  const T = tan * tan;
  const C = ep2 * cos * cos;
  const A = cos * lam;
  const e4 = e2 * e2;
  const e6 = e4 * e2;
  const M =
    a *
    ((1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi -
      ((3 * e2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi) +
      ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi) -
      ((35 * e6) / 3072) * Math.sin(6 * phi));
  const x = k0 * N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120) + 500000;
  let y = k0 * (M + N * tan * ((A * A) / 2 + ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720));
  if (!north) y += 10_000_000;
  return [x, y];
}

function project(crs: Crs, lng: number, lat: number): [number, number] {
  if (crs.kind === 'lnglat') return [lng, lat];
  if (crs.kind === 'mercator') {
    const R = 6378137;
    return [(R * lng * Math.PI) / 180, R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))];
  }
  return lngLatToUtm(lng, lat, crs.zone, crs.north);
}

function crsFromEpsg(code: number | undefined): Crs | null {
  if (!code) return null;
  if (code === 4326 || code === 4269 || code === 4258) return { kind: 'lnglat' };
  if (code === 3857 || code === 900913) return { kind: 'mercator' };
  if (code > 32600 && code <= 32660) return { kind: 'utm', zone: code - 32600, north: true };
  if (code > 32700 && code <= 32760) return { kind: 'utm', zone: code - 32700, north: false };
  return null;
}

/** Guess the CRS of a header-only raster (.asc) from its coordinate magnitudes. */
function guessCrs(bbox: [number, number, number, number], fallbackLng: number, fallbackLat: number): Crs {
  const looksLngLat = Math.abs(bbox[0]) <= 180 && Math.abs(bbox[2]) <= 180 && Math.abs(bbox[1]) <= 90 && Math.abs(bbox[3]) <= 90;
  if (looksLngLat) return { kind: 'lnglat' };
  return { kind: 'utm', zone: Math.floor((fallbackLng + 180) / 6) + 1, north: fallbackLat >= 0 };
}

export async function readGeoTiff(file: File): Promise<SourceRaster> {
  const { fromArrayBuffer } = await import('geotiff');
  const tiff = await fromArrayBuffer(await file.arrayBuffer());
  const image = await tiff.getImage();
  const keys = (image.getGeoKeys?.() ?? {}) as Record<string, number>;
  const crs = crsFromEpsg(keys.ProjectedCSTypeGeoKey) ?? crsFromEpsg(keys.GeographicTypeGeoKey) ?? (keys.ProjectedCSTypeGeoKey ? null : { kind: 'lnglat' as const });
  if (!crs) throw new Error(`Unsupported projection (EPSG:${keys.ProjectedCSTypeGeoKey}). Reproject to WGS 84 or WGS 84 / UTM first.`);
  const rasters = (await image.readRasters({ samples: [0] })) as unknown as ArrayLike<number>[];
  const band = rasters[0];
  const values = new Float32Array(band.length);
  for (let i = 0; i < band.length; i++) values[i] = band[i];
  const bb = image.getBoundingBox() as number[];
  const nd = image.getGDALNoData?.();
  return {
    width: image.getWidth(),
    height: image.getHeight(),
    values,
    bbox: [bb[0], bb[1], bb[2], bb[3]],
    crs,
    nodata: nd === null || nd === undefined ? null : Number(nd),
    name: file.name,
  };
}

export async function readAsciiGrid(file: File, near: [number, number]): Promise<SourceRaster> {
  const text = await file.text();
  const lines = text.split(/\r?\n/);
  const header: Record<string, number> = {};
  let i = 0;
  for (; i < lines.length; i++) {
    const m = lines[i].trim().match(/^([a-zA-Z_]+)\s+(-?[\d.eE+-]+)$/);
    if (!m) break;
    header[m[1].toLowerCase()] = Number(m[2]);
  }
  const width = header.ncols;
  const height = header.nrows;
  if (!width || !height) throw new Error('Not an ESRI ASCII grid (missing ncols / nrows).');
  const dx = header.cellsize ?? header.dx;
  const dy = header.cellsize ?? header.dy ?? dx;
  const x0 = header.xllcorner ?? (header.xllcenter !== undefined ? header.xllcenter - dx / 2 : NaN);
  const y0 = header.yllcorner ?? (header.yllcenter !== undefined ? header.yllcenter - dy / 2 : NaN);
  if (!Number.isFinite(x0) || !Number.isFinite(y0) || !dx) throw new Error('ASCII grid header is incomplete.');
  const values = new Float32Array(width * height);
  let n = 0;
  for (; i < lines.length && n < values.length; i++) {
    for (const tok of lines[i].trim().split(/\s+/)) {
      if (tok === '') continue;
      values[n++] = Number(tok);
    }
  }
  if (n < values.length) throw new Error(`ASCII grid has ${n} values; expected ${values.length}.`);
  const bbox: [number, number, number, number] = [x0, y0, x0 + width * dx, y0 + height * dy];
  return {
    width,
    height,
    values,
    bbox,
    crs: guessCrs(bbox, near[0], near[1]),
    nodata: header.nodata_value ?? null,
    name: file.name,
  };
}

export async function readRasterFile(file: File, near: [number, number]): Promise<SourceRaster> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.tif') || name.endsWith('.tiff')) return readGeoTiff(file);
  if (name.endsWith('.asc') || name.endsWith('.txt')) return readAsciiGrid(file, near);
  throw new Error('Use a GeoTIFF (.tif) or ESRI ASCII grid (.asc).');
}

/** Lng/lat bounds of a raster (for building a scenario around an uploaded DEM). */
export function rasterLngLatBounds(src: SourceRaster): [number, number, number, number] | null {
  return src.crs.kind === 'lnglat' ? src.bbox : null;
}

/**
 * Resamples onto a grid. 'mean' supersamples each cell (use for DEMs and depths when the
 * source is finer than the grid); 'max' keeps the largest value; 'majority' is for 0/1 masks.
 * Cells outside the source or on nodata become NaN.
 */
export function resampleToGrid(src: SourceRaster, g: GridGeometry, mode: 'mean' | 'max' | 'majority' = 'mean'): Float32Array {
  const out = new Float32Array(g.cols * g.rows);
  const [sx0, sy0, sx1, sy1] = src.bbox;
  const pxW = (sx1 - sx0) / src.width;
  const pxH = (sy1 - sy0) / src.height;
  // Supersampling factor from the approximate source pixel size in metres.
  const srcPxM = src.crs.kind === 'lnglat' ? pxW * 111_320 * Math.cos((((g.bbox[1] + g.bbox[3]) / 2) * Math.PI) / 180) : pxW;
  const ss = Math.max(1, Math.min(4, Math.round(Math.min(g.dx, g.dy) / Math.max(srcPxM, 1))));
  const nd = src.nodata;
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      let sum = 0;
      let n = 0;
      let mx = -Infinity;
      let total = 0;
      for (let sj = 0; sj < ss; sj++) {
        for (let si = 0; si < ss; si++) {
          const lng = g.bbox[0] + (c + (si + 0.5) / ss) * g.lngStep;
          const lat = g.bbox[3] - (r + (sj + 0.5) / ss) * g.latStep;
          const [x, y] = project(src.crs, lng, lat);
          const px = Math.floor((x - sx0) / pxW);
          const py = Math.floor((sy1 - y) / pxH);
          total++;
          if (px < 0 || py < 0 || px >= src.width || py >= src.height) continue;
          const v = src.values[py * src.width + px];
          if (!Number.isFinite(v) || (nd !== null && v === nd) || v < -1e20) continue;
          sum += v;
          n++;
          if (v > mx) mx = v;
        }
      }
      const k = r * g.cols + c;
      if (n === 0) out[k] = NaN;
      else if (mode === 'max') out[k] = mx;
      else if (mode === 'majority') out[k] = sum / total >= 0.5 ? 1 : 0;
      else out[k] = sum / n;
    }
  }
  return out;
}
