// Raster classes → GeoJSON polygons (with holes) using marching squares (d3-contour) on a
// binary mask per class, then Douglas–Peucker simplification. Coordinates are WGS 84 lng/lat.

import { contours } from 'd3-contour';
import type { GridGeometry } from '../geo/grid';

export interface ClassBand {
  min: number;
  max: number;
  label: string;
  color: string;
}

export type Ring = [number, number][];

export interface PolygonFeature {
  type: 'Feature';
  geometry: { type: 'MultiPolygon'; coordinates: Ring[][] };
  properties: Record<string, string | number>;
}

function perpDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export function simplifyRing(ring: Ring, tol: number): Ring {
  if (ring.length <= 5) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = 1;
  keep[ring.length - 1] = 1;
  const stack: [number, number][] = [[0, ring.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = perpDist(ring[i], ring[s], ring[e]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > tol) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  const out = ring.filter((_, i) => keep[i]);
  return out.length >= 4 ? out : ring;
}

export function signedArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return a / 2;
}

/** Orients rings: exterior counter-clockwise and holes clockwise (RFC 7946) or the reverse (shapefile). */
export function orientPolygon(rings: Ring[], exteriorCCW: boolean): Ring[] {
  return rings.map((ring, i) => {
    const ccw = signedArea(ring) < 0;
    const wantCCW = i === 0 ? exteriorCCW : !exteriorCCW;
    return ccw === wantCCW ? ring : [...ring].reverse();
  });
}

/**
 * One MultiPolygon feature per band (cells with min ≤ value < max). `values` NaN / below the
 * first band are ignored. Tiny slivers (< minCells) are dropped.
 */
export function polygonizeBands(
  values: ArrayLike<number>,
  g: GridGeometry,
  bands: ClassBand[],
  layer: string,
  minCells = 2,
): PolygonFeature[] {
  const { cols, rows } = g;
  const mask = new Float64Array(cols * rows);
  const generator = contours().size([cols, rows]).smooth(true).thresholds([0.5]);
  const features: PolygonFeature[] = [];
  const tol = 0.35;
  for (const band of bands) {
    let any = 0;
    for (let k = 0; k < mask.length; k++) {
      const v = values[k];
      const inside = v >= band.min && v < band.max ? 1 : 0;
      mask[k] = inside;
      any += inside;
    }
    if (any < minCells) continue;
    const [contour] = generator(mask as unknown as number[]);
    const polys: Ring[][] = [];
    let areaCells = 0;
    for (const poly of contour.coordinates as unknown as Ring[][]) {
      const rings: Ring[] = [];
      poly.forEach((ring, i) => {
        const simple = simplifyRing(ring, tol);
        const a = Math.abs(signedArea(simple));
        if (i === 0 && a < minCells) return;
        if (i > 0 && a < 1) return;
        if (i === 0 || rings.length > 0) {
          areaCells += i === 0 ? a : -a;
          rings.push(simple.map(([x, y]) => [g.bbox[0] + x * g.lngStep, g.bbox[3] - y * g.latStep] as [number, number]));
        }
      });
      if (rings.length) polys.push(orientPolygon(rings, true));
    }
    if (polys.length === 0) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'MultiPolygon', coordinates: polys },
      properties: {
        layer,
        class: band.label,
        min: Number.isFinite(band.min) ? band.min : -1,
        max: Number.isFinite(band.max) ? band.max : -1,
        area_km2: Math.round((areaCells * g.cellArea) / 1e4) / 100,
        color: band.color,
      },
    });
  }
  return features;
}
