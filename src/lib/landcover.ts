// Land cover from OpenStreetMap, turned into a Manning roughness for every grid cell.
//
// A single roughness for a whole valley is the weakest common assumption in dam-break modelling:
// a forested hillside and a bare channel differ by a factor of three, and the flood front's speed
// follows. OpenStreetMap maps landuse and natural areas almost everywhere in India, so the same
// Overpass plumbing that fetches settlements and roads can give each cell its own n.
//
// Values follow the standard open-channel tables (Chow, 1959, Table 5-6; the same values the US
// Army Corps' HEC-RAS reference manual lists for floodplains). Where a class could reasonably take
// a range, the mid value is used.

import type { FeatureCollection } from './osm';
import type { GridGeometry } from './geo/grid';

/** A land-cover class, its Manning n, and how it reads in the UI. */
export interface LandCoverClass {
  id: number;
  label: string;
  manning: number;
}

/**
 * Classes in priority order: where areas overlap (a village inside farmland, a river inside a
 * forest), the later class wins, so water and built-up areas are not painted over by the large
 * background polygons they sit inside.
 */
export const LAND_COVER: LandCoverClass[] = [
  { id: 0, label: 'Unmapped', manning: 0.045 },
  { id: 1, label: 'Bare rock and sand', manning: 0.03 },
  { id: 2, label: 'Grass and meadow', manning: 0.035 },
  { id: 3, label: 'Farmland', manning: 0.04 },
  { id: 4, label: 'Orchard and plantation', manning: 0.06 },
  { id: 5, label: 'Scrub and heath', manning: 0.07 },
  { id: 6, label: 'Forest', manning: 0.1 },
  { id: 7, label: 'Wetland', manning: 0.05 },
  { id: 8, label: 'Built-up', manning: 0.08 },
  { id: 9, label: 'Open water', manning: 0.03 },
];

/** The default where nothing is mapped: the value the Model tab's slider has always used. */
export const UNMAPPED = LAND_COVER[0];

const CLASS_OF: Record<string, number> = {
  // landuse=*
  'landuse:forest': 6,
  'landuse:meadow': 2,
  'landuse:grass': 2,
  'landuse:village_green': 2,
  'landuse:farmland': 3,
  'landuse:farmyard': 3,
  'landuse:allotments': 3,
  'landuse:orchard': 4,
  'landuse:vineyard': 4,
  'landuse:plant_nursery': 4,
  'landuse:residential': 8,
  'landuse:commercial': 8,
  'landuse:retail': 8,
  'landuse:industrial': 8,
  'landuse:construction': 8,
  'landuse:quarry': 1,
  'landuse:cemetery': 2,
  'landuse:recreation_ground': 2,
  'landuse:reservoir': 9,
  'landuse:basin': 9,
  'landuse:salt_pond': 9,
  'landuse:religious': 8,
  'landuse:education': 8,
  'landuse:railway': 8,
  'landuse:military': 8,
  'landuse:brownfield': 1,
  'landuse:landfill': 1,
  // natural=*
  'natural:wood': 6,
  'natural:tree_row': 6,
  'natural:scrub': 5,
  'natural:heath': 5,
  'natural:grassland': 2,
  'natural:fell': 2,
  'natural:bare_rock': 1,
  'natural:scree': 1,
  'natural:shingle': 1,
  'natural:sand': 1,
  'natural:beach': 1,
  'natural:rock': 1,
  'natural:cliff': 1,
  'natural:glacier': 1,
  'natural:wetland': 7,
  'natural:marsh': 7,
  'natural:mud': 1,
  'natural:water': 9,
  'natural:strait': 9,
  'natural:bay': 9,
};

export interface LandCoverPolygon {
  cls: number;
  /** Closed ring, lng/lat. */
  ring: [number, number][];
}

export type LandCoverCollection = FeatureCollection<never> & { polygons: LandCoverPolygon[] };

export function landCoverQuery(bbox: [number, number, number, number]): string {
  const b = `${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]}`;
  // Ways only: multipolygon relations would need their holes resolved, and they are a small part
  // of the mapped area. Anything missed simply keeps the unmapped default.
  return `[out:json][timeout:120];
(
  way["landuse"](${b});
  way["natural"](${b});
)->.cover;
.cover out geom tags;`;
}

interface OverpassWay {
  type: string;
  id: number;
  geometry?: Array<{ lat: number; lon: number }>;
  tags?: Record<string, string>;
}

export function parseLandCover(json: { elements: OverpassWay[] }): LandCoverPolygon[] {
  const out: LandCoverPolygon[] = [];
  for (const el of json.elements ?? []) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 4) continue;
    const tags = el.tags ?? {};
    const key = tags.landuse ? `landuse:${tags.landuse}` : tags.natural ? `natural:${tags.natural}` : '';
    const cls = CLASS_OF[key];
    if (cls === undefined) continue;
    const ring = el.geometry.map((p) => [p.lon, p.lat] as [number, number]);
    const [x0, y0] = ring[0];
    const [xn, yn] = ring[ring.length - 1];
    // Only closed ways bound an area.
    if (Math.abs(x0 - xn) > 1e-9 || Math.abs(y0 - yn) > 1e-9) continue;
    out.push({ cls, ring });
  }
  return out;
}

/**
 * Paints polygons onto the grid by scanline fill, in class order so that water and built-up areas
 * overwrite the larger background polygons they sit inside. Returns one class id per cell.
 */
export function rasteriseLandCover(polygons: LandCoverPolygon[], g: GridGeometry): Uint8Array {
  const out = new Uint8Array(g.cols * g.rows);
  const byClass = [...polygons].sort((a, b) => a.cls - b.cls);
  const xs: number[] = [];
  for (const { cls, ring } of byClass) {
    // Ring in fractional cell coordinates (x east, y south from the north-west corner).
    const px = ring.map(([lng]) => (lng - g.bbox[0]) / g.lngStep);
    const py = ring.map(([, lat]) => (g.bbox[3] - lat) / g.latStep);
    let minY = Infinity;
    let maxY = -Infinity;
    for (const y of py) {
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const r0 = Math.max(0, Math.ceil(minY - 0.5));
    const r1 = Math.min(g.rows - 1, Math.floor(maxY + 0.5));
    for (let r = r0; r <= r1; r++) {
      const yc = r + 0.5;
      xs.length = 0;
      for (let i = 0, j = px.length - 1; i < px.length; j = i++) {
        const yi = py[i];
        const yj = py[j];
        if (yi > yc === yj > yc) continue;
        xs.push(px[i] + ((yc - yi) / (yj - yi)) * (px[j] - px[i]));
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil(xs[k] - 0.5));
        const c1 = Math.min(g.cols - 1, Math.floor(xs[k + 1] - 0.5));
        const base = r * g.cols;
        for (let c = c0; c <= c1; c++) out[base + c] = cls;
      }
    }
  }
  return out;
}

/** Manning n per cell from class ids, scaled by a multiplier the user can still turn. */
export function manningField(classes: Uint8Array, scale = 1): Float32Array {
  const table = new Float32Array(LAND_COVER.length);
  for (const c of LAND_COVER) table[c.id] = c.manning;
  const out = new Float32Array(classes.length);
  for (let k = 0; k < classes.length; k++) out[k] = table[classes[k]] * scale;
  return out;
}

export interface LandCoverShare {
  cls: LandCoverClass;
  cells: number;
  share: number;
}

/** What the study area is made of, largest first, with the area-weighted roughness. */
export function landCoverComposition(classes: Uint8Array): { shares: LandCoverShare[]; meanManning: number } {
  const counts = new Array(LAND_COVER.length).fill(0);
  for (let k = 0; k < classes.length; k++) counts[classes[k]]++;
  const total = classes.length || 1;
  let mean = 0;
  const shares: LandCoverShare[] = [];
  LAND_COVER.forEach((cls) => {
    const cells = counts[cls.id];
    mean += (cells / total) * cls.manning;
    if (cells > 0) shares.push({ cls, cells, share: cells / total });
  });
  shares.sort((a, b) => b.cells - a.cells);
  return { shares, meanManning: mean };
}
