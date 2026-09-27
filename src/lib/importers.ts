// Imports for comparison and validation:
//  - observed flood extents (Sentinel-1 / GEE exports as GeoJSON, KML or GeoTIFF masks);
//  - external model results (Delft3D, HEC-RAS, TUFLOW… max-depth rasters as GeoTIFF or .asc).
//  - datasets a user brings to the model: a hydrograph, dam parameters or settlements, as a
//    spreadsheet or delimited text.

import type { GridGeometry } from './geo/grid';
import { crsLabel, readRasterFile, resampleToGrid } from './geo/raster.ts';
import type { ExternalResult } from '@/simulation/results';
import { parseDelimited, readWorkbook } from './xlsx.ts';
import type { Sheet } from './xlsx.ts';

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

// ---- Datasets -----------------------------------------------------------------------------------
//
// A spreadsheet is how hydrology actually arrives — from a gauge record, a CWC table, a district
// register — so a run can be driven by one instead of by the model's own regressions. Sheets are
// recognised by their column headings rather than by name, because nobody renames a sheet to match
// a manual: a sheet with a time column and a discharge column is a hydrograph wherever it sits.

export interface ImportedHydrograph {
  /** Seconds since the start of the event, strictly increasing. */
  t: number[];
  /** Outflow into the downstream reach (m³/s). */
  q: number[];
  peak: number;
  timeToPeak: number;
  /** Trapezoidal integral of the record (m³). */
  volume: number;
}

export interface ImportedDam {
  height?: number;
  volumeMCM?: number;
  waterDepth?: number;
  breachWidth?: number;
  /** Seconds. */
  formationTime?: number;
  manning?: number;
}

export interface ImportedSettlement {
  name: string;
  lng: number;
  lat: number;
  population: number;
}

export interface ImportedDataset {
  name: string;
  hydrograph?: ImportedHydrograph;
  dam?: ImportedDam;
  settlements?: ImportedSettlement[];
  /** What was recognised, what was assumed and what was skipped — shown to the user verbatim. */
  notes: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function findColumn(header: string[], patterns: RegExp[]): number {
  for (const p of patterns) {
    const i = header.findIndex((h) => p.test(norm(h)));
    if (i >= 0) return i;
  }
  return -1;
}

/** A number from a cell, tolerating thousands separators and stray spaces. */
function num(cell: string | undefined): number {
  if (cell === undefined) return NaN;
  const text = cell.replace(/[\s,](?=\d)/g, '').trim();
  // Number('') and Number(' ') are both 0, which would silently put a blank coordinate at zero.
  if (text === '') return NaN;
  const v = Number(text);
  return Number.isFinite(v) ? v : NaN;
}

/** Seconds per unit of whatever the time column is labelled in; defaults to seconds. */
function timeScale(header: string): { scale: number; label: string } {
  const h = norm(header);
  if (/hour|hrs?$/.test(h)) return { scale: 3600, label: 'hours' };
  if (/min/.test(h)) return { scale: 60, label: 'minutes' };
  if (/day/.test(h)) return { scale: 86400, label: 'days' };
  return { scale: 1, label: 'seconds' };
}

function readHydrograph(rows: string[][], notes: string[]): ImportedHydrograph | undefined {
  if (rows.length < 2) return undefined;
  const header = rows[0];
  const ti = findColumn(header, [/^time/, /^t$/, /elapsed/, /minute|hour|second/]);
  const qi = findColumn(header, [/discharge/, /outflow/, /^q$/, /flow/, /cumec/, /m3s/, /cfs/]);
  if (ti < 0 || qi < 0) return undefined;
  const { scale, label } = timeScale(header[ti]);
  const cfs = /cfs|cubicfeet/.test(norm(header[qi]));
  const pairs: [number, number][] = [];
  for (const row of rows.slice(1)) {
    const t = num(row[ti]);
    const q = num(row[qi]);
    if (!Number.isFinite(t) || !Number.isFinite(q)) continue;
    pairs.push([t * scale, Math.max(0, q * (cfs ? 0.0283168 : 1))]);
  }
  if (pairs.length < 2) return undefined;
  pairs.sort((a, b) => a[0] - b[0]);
  const t: number[] = [];
  const q: number[] = [];
  for (const pair of pairs) {
    // Repeated timestamps would make the interpolation ambiguous; the later value wins.
    if (t.length > 0 && pair[0] === t[t.length - 1]) q[q.length - 1] = pair[1];
    else {
      t.push(pair[0]);
      q.push(pair[1]);
    }
  }
  let volume = 0;
  let peak = 0;
  let timeToPeak = 0;
  for (let i = 0; i < t.length; i++) {
    if (q[i] > peak) {
      peak = q[i];
      timeToPeak = t[i];
    }
    if (i > 0) volume += ((q[i] + q[i - 1]) / 2) * (t[i] - t[i - 1]);
  }
  notes.push(
    `Hydrograph: ${t.length} points, read as ${label}${cfs ? ' and cubic feet per second' : ''}, peak ${Math.round(peak).toLocaleString()} m³/s at ${(timeToPeak / 3600).toFixed(2)} h, ${(volume / 1e6).toFixed(0)} Mm³ total.`,
  );
  return { t, q, peak, timeToPeak, volume };
}

const DAM_KEYS: [keyof ImportedDam, RegExp, number][] = [
  ['height', /^(dam)?height/, 1],
  ['volumeMCM', /volume|capacity|storage/, 1],
  ['waterDepth', /waterdepth|depthatdam|headwater|poollevel/, 1],
  ['breachWidth', /breachwidth|width/, 1],
  ['formationTime', /formation|breachtime|failuretime/, 60],
  ['manning', /manning|roughness/, 1],
];

/** A two-column parameter/value sheet. */
function readDam(rows: string[][], notes: string[]): ImportedDam | undefined {
  const out: ImportedDam = {};
  const found: string[] = [];
  for (const row of rows) {
    if (row.length < 2) continue;
    const key = norm(row[0]);
    const value = num(row[1]);
    if (!key || !Number.isFinite(value)) continue;
    for (const entry of DAM_KEYS) {
      const field = entry[0];
      if (out[field] === undefined && entry[1].test(key)) {
        // A formation time already written in seconds should not be scaled up from minutes again.
        const alreadySeconds = field === 'formationTime' && /sec/.test(key);
        out[field] = value * (alreadySeconds ? 1 : entry[2]);
        found.push(`${field} ${out[field]}`);
        break;
      }
    }
  }
  if (found.length === 0) return undefined;
  notes.push(`Dam parameters: ${found.join(', ')}.`);
  return out;
}

function readSettlements(rows: string[][], notes: string[]): ImportedSettlement[] | undefined {
  if (rows.length < 2) return undefined;
  const header = rows[0];
  const ni = findColumn(header, [/^name/, /settlement|village|town|city|place/]);
  const yi = findColumn(header, [/^lat/, /^y$/]);
  const xi = findColumn(header, [/^lon/, /^lng/, /^x$/]);
  const pi = findColumn(header, [/population|people|residents|pop/]);
  if (ni < 0 || yi < 0 || xi < 0) return undefined;
  const out: ImportedSettlement[] = [];
  let skipped = 0;
  for (const row of rows.slice(1)) {
    const name = (row[ni] ?? '').trim();
    const lat = num(row[yi]);
    const lng = num(row[xi]);
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      skipped++;
      continue;
    }
    const population = pi >= 0 ? num(row[pi]) : NaN;
    out.push({ name, lng, lat, population: Number.isFinite(population) ? Math.max(0, Math.round(population)) : 0 });
  }
  if (out.length === 0) return undefined;
  notes.push(`Settlements: ${out.length} read${skipped > 0 ? `, ${skipped} row${skipped === 1 ? '' : 's'} skipped for a missing name or coordinate` : ''}.`);
  return out;
}

/**
 * Reads a .xlsx, .csv or .tsv into whichever of the three datasets it holds. Every sheet is offered
 * to every reader, so one workbook can carry all three and a single CSV can carry one.
 */
export async function importDataset(file: File): Promise<ImportedDataset> {
  const name = file.name.toLowerCase();
  let sheets: Sheet[];
  if (name.endsWith('.xlsx')) sheets = await readWorkbook(file);
  else if (name.endsWith('.csv') || name.endsWith('.tsv') || name.endsWith('.txt')) sheets = [{ name: file.name, rows: parseDelimited(await file.text()) }];
  else throw new Error('Expected a .xlsx, .csv or .tsv file.');

  const notes: string[] = [];
  const out: ImportedDataset = { name: file.name, notes };
  for (const sheet of sheets) {
    if (sheet.rows.length === 0) continue;
    const before = notes.length;
    if (!out.hydrograph) out.hydrograph = readHydrograph(sheet.rows, notes);
    if (!out.dam) out.dam = readDam(sheet.rows, notes);
    if (!out.settlements) out.settlements = readSettlements(sheet.rows, notes);
    // Name the sheet a note came from, unless the sheet is already called what the note reports.
    if (notes.length > before && sheets.length > 1) {
      for (let i = before; i < notes.length; i++) {
        if (!norm(notes[i]).startsWith(norm(sheet.name))) notes[i] = `${sheet.name} — ${notes[i]}`;
      }
    }
  }
  if (!out.hydrograph && !out.dam && !out.settlements) {
    throw new Error(
      'Nothing recognised. Expected a time and a discharge column for a hydrograph, parameter and value columns for dam settings, or name, latitude and longitude columns for settlements.',
    );
  }
  return out;
}
