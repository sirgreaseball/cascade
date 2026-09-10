// Imports for comparison and validation:
//  - observed flood extents (Sentinel-1 / GEE exports as GeoJSON, KML or GeoTIFF masks);
//  - external model results (Delft3D, HEC-RAS, TUFLOW… max-depth rasters as GeoTIFF or .asc).

import type { GridGeometry } from './geo/grid';
import { crsLabel, readRasterFile, resampleToGrid } from './geo/raster';
import type { ExternalResult } from '@/simulation/results';

export interface ObservedExtent {
  name: string;
  source: string;
  /** 1 where the observation shows flooding, per grid cell. */
  mask: Uint8Array;
  cells: number;
}

type Ring = [number, number][];
type Polygon = Ring[];

function collectPolygons(geo: unknown, out: Polygon[]): void {
  if (!geo || typeof geo !== 'object') return;
  const g = geo as { type?: string; features?: unknown[]; geometry?: unknown; geometries?: unknown[]; coordinates?: unknown };
  switch (g.type) {
    case 'FeatureCollection':
      g.features?.forEach((f) => collectPolygons(f, out));
      break;
    case 'Feature':
      collectPolygons(g.geometry, out);
      break;
    case 'GeometryCollection':
      g.geometries?.forEach((x) => collectPolygons(x, out));
      break;
    case 'Polygon':
      out.push(g.coordinates as Polygon);
      break;
    case 'MultiPolygon':
      (g.coordinates as Polygon[]).forEach((p) => out.push(p));
      break;
  }
}

function parseKmlPolygons(text: string): Polygon[] {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const polys: Polygon[] = [];
  const toRing = (el: Element | null): Ring | null => {
    const coords = el?.getElementsByTagName('coordinates')[0]?.textContent?.trim();
    if (!coords) return null;
    return coords
      .split(/\s+/)
      .map((t) => t.split(',').map(Number))
      .filter((p) => p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
      .map((p) => [p[0], p[1]] as [number, number]);
  };
  for (const poly of Array.from(doc.getElementsByTagName('Polygon'))) {
    const outer = toRing(poly.getElementsByTagName('outerBoundaryIs')[0]);
    if (!outer) continue;
    const rings: Polygon = [outer];
    for (const inner of Array.from(poly.getElementsByTagName('innerBoundaryIs'))) {
      const r = toRing(inner);
      if (r) rings.push(r);
    }
    polys.push(rings);
  }
  return polys;
}

/** Even-odd scanline fill of polygons (with holes) at cell centres. */
export function rasterizePolygons(polys: Polygon[], g: GridGeometry): Uint8Array {
  const mask = new Uint8Array(g.cols * g.rows);
  const xs: number[] = [];
  for (const poly of polys) {
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (const ring of poly) for (const p of ring) {
      if (p[1] < minLat) minLat = p[1];
      if (p[1] > maxLat) maxLat = p[1];
    }
    const r0 = Math.max(0, Math.floor((g.bbox[3] - maxLat) / g.latStep));
    const r1 = Math.min(g.rows - 1, Math.ceil((g.bbox[3] - minLat) / g.latStep));
    for (let r = r0; r <= r1; r++) {
      const lat = g.bbox[3] - (r + 0.5) * g.latStep;
      xs.length = 0;
      for (const ring of poly) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [x1, y1] = ring[i];
          const [x2, y2] = ring[j];
          if (y1 > lat !== y2 > lat) xs.push(x1 + ((lat - y1) / (y2 - y1)) * (x2 - x1));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil((xs[k] - g.bbox[0]) / g.lngStep - 0.5));
        const c1 = Math.min(g.cols - 1, Math.floor((xs[k + 1] - g.bbox[0]) / g.lngStep - 0.5));
        for (let c = c0; c <= c1; c++) mask[r * g.cols + c] = 1;
      }
    }
  }
  return mask;
}

const count = (m: Uint8Array) => m.reduce((a, v) => a + v, 0);

export async function importObservedExtent(file: File, g: GridGeometry): Promise<ObservedExtent> {
  const name = file.name.toLowerCase();
  let mask: Uint8Array;
  let source: string;
  if (name.endsWith('.tif') || name.endsWith('.tiff') || name.endsWith('.asc')) {
    const src = await readRasterFile(file, [(g.bbox[0] + g.bbox[2]) / 2, (g.bbox[1] + g.bbox[3]) / 2]);
    const values = resampleToGrid(src, g, 'majority');
    mask = new Uint8Array(values.length);
    for (let i = 0; i < values.length; i++) mask[i] = values[i] >= 0.5 ? 1 : 0;
    source = `Raster mask, ${crsLabel(src.crs)}`;
  } else {
    const text = await file.text();
    const polys: Polygon[] = [];
    if (name.endsWith('.kml')) polys.push(...parseKmlPolygons(text));
    else collectPolygons(JSON.parse(text), polys);
    if (polys.length === 0) throw new Error('No polygons found in the file.');
    mask = rasterizePolygons(polys, g);
    source = `${polys.length.toLocaleString()} polygon${polys.length === 1 ? '' : 's'}`;
  }
  const cells = count(mask);
  if (cells === 0) throw new Error('The observed extent does not overlap this study area.');
  return { name: file.name, source, mask, cells };
}

export async function importExternalResult(file: File, g: GridGeometry): Promise<ExternalResult> {
  const src = await readRasterFile(file, [(g.bbox[0] + g.bbox[2]) / 2, (g.bbox[1] + g.bbox[3]) / 2]);
  const values = resampleToGrid(src, g, 'mean');
  let covered = 0;
  for (let i = 0; i < values.length; i++) {
    if (Number.isFinite(values[i])) covered++;
    else values[i] = 0;
    if (values[i] < 0) values[i] = 0;
  }
  if (covered === 0) throw new Error('The raster does not overlap this study area.');
  return {
    name: file.name.replace(/\.[^.]+$/, ''),
    source: `${crsLabel(src.crs)}, ${src.width}×${src.height} px, covers ${Math.round((covered / values.length) * 100)}% of the area`,
    maxDepth: values,
  };
}
