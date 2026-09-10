// File writers with no dependencies: ESRI Shapefile (SHP/SHX/DBF/PRJ/CPG), KML 2.2,
// ESRI ASCII grid, CSV and a STORE zip container.

import type { GridGeometry } from '../geo/grid';
import { orientPolygon } from './polygonize';
import type { Ring } from './polygonize';

export const PRJ_WGS84 =
  'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

const encoder = new TextEncoder();

// ---- Shapefile --------------------------------------------------------------------------------

export interface DbfField {
  name: string;
  type: 'C' | 'N';
  length: number;
  decimals?: number;
}

export type ShapeKind = 'point' | 'polyline' | 'polygon';
/** point: [x, y]; polyline: parts; polygon: polygons (each a list of rings). */
export type ShapeGeometry = [number, number] | Ring[] | Ring[][];

const SHAPE_TYPE: Record<ShapeKind, number> = { point: 1, polyline: 3, polygon: 5 };

function writeDbf(rows: Record<string, string | number>[], fields: DbfField[]): Uint8Array {
  const recordLen = 1 + fields.reduce((a, f) => a + f.length, 0);
  const headerLen = 32 + fields.length * 32 + 1;
  const buf = new Uint8Array(headerLen + rows.length * recordLen + 1);
  const view = new DataView(buf.buffer);
  const now = new Date();
  buf[0] = 0x03;
  buf[1] = now.getFullYear() - 1900;
  buf[2] = now.getMonth() + 1;
  buf[3] = now.getDate();
  view.setUint32(4, rows.length, true);
  view.setUint16(8, headerLen, true);
  view.setUint16(10, recordLen, true);
  buf[29] = 0x57; // language driver: ANSI (UTF-8 declared in .cpg)
  fields.forEach((f, i) => {
    const o = 32 + i * 32;
    const name = encoder.encode(f.name.slice(0, 10));
    buf.set(name, o);
    buf[o + 11] = f.type.charCodeAt(0);
    buf[o + 16] = f.length;
    buf[o + 17] = f.decimals ?? 0;
  });
  buf[headerLen - 1] = 0x0d;
  let o = headerLen;
  for (const row of rows) {
    buf[o++] = 0x20;
    for (const f of fields) {
      const v = row[f.name];
      let bytes: Uint8Array;
      if (f.type === 'N') {
        const s = typeof v === 'number' && Number.isFinite(v) ? v.toFixed(f.decimals ?? 0) : '';
        bytes = encoder.encode(s.padStart(f.length).slice(-f.length));
      } else {
        let enc = encoder.encode(String(v ?? ''));
        // Truncate on a UTF-8 boundary.
        if (enc.length > f.length) {
          let cut = f.length;
          while (cut > 0 && (enc[cut] & 0xc0) === 0x80) cut--;
          enc = enc.slice(0, cut);
        }
        bytes = new Uint8Array(f.length).fill(0x20);
        bytes.set(enc);
      }
      buf.set(bytes, o);
      o += f.length;
    }
  }
  buf[o] = 0x1a;
  return buf;
}

export function writeShapefile(
  kind: ShapeKind,
  geometries: ShapeGeometry[],
  rows: Record<string, string | number>[],
  fields: DbfField[],
): { shp: Uint8Array; shx: Uint8Array; dbf: Uint8Array } {
  const type = SHAPE_TYPE[kind];
  // Normalise every record to parts (rings or lines) and compute sizes.
  const records = geometries.map((geom) => {
    if (kind === 'point') return { parts: [[geom as [number, number]]] as Ring[] };
    if (kind === 'polyline') return { parts: geom as Ring[] };
    // Shapefile polygons: exterior rings clockwise, holes counter-clockwise.
    const parts: Ring[] = [];
    for (const poly of geom as Ring[][]) parts.push(...orientPolygon(poly, false));
    return { parts };
  });
  const contentLen = records.map((r) => {
    if (kind === 'point') return 20;
    const points = r.parts.reduce((a, p) => a + p.length, 0);
    return 44 + 4 * r.parts.length + 16 * points;
  });
  const shpLen = 100 + contentLen.reduce((a, c) => a + 8 + c, 0);
  const shp = new Uint8Array(shpLen);
  const shx = new Uint8Array(100 + 8 * records.length);
  const sv = new DataView(shp.buffer);
  const xv = new DataView(shx.buffer);

  let xmin = Infinity;
  let ymin = Infinity;
  let xmax = -Infinity;
  let ymax = -Infinity;
  for (const r of records) for (const p of r.parts) for (const [x, y] of p) {
    if (x < xmin) xmin = x;
    if (y < ymin) ymin = y;
    if (x > xmax) xmax = x;
    if (y > ymax) ymax = y;
  }
  if (!Number.isFinite(xmin)) xmin = ymin = xmax = ymax = 0;
  for (const [view, len] of [
    [sv, shpLen],
    [xv, shx.length],
  ] as const) {
    view.setInt32(0, 9994);
    view.setInt32(24, len / 2);
    view.setInt32(28, 1000, true);
    view.setInt32(32, type, true);
    view.setFloat64(36, xmin, true);
    view.setFloat64(44, ymin, true);
    view.setFloat64(52, xmax, true);
    view.setFloat64(60, ymax, true);
  }

  let o = 100;
  records.forEach((r, i) => {
    xv.setInt32(100 + i * 8, o / 2);
    xv.setInt32(104 + i * 8, contentLen[i] / 2);
    sv.setInt32(o, i + 1);
    sv.setInt32(o + 4, contentLen[i] / 2);
    o += 8;
    sv.setInt32(o, type, true);
    if (kind === 'point') {
      const [x, y] = r.parts[0][0];
      sv.setFloat64(o + 4, x, true);
      sv.setFloat64(o + 12, y, true);
      o += 20;
      return;
    }
    let bx0 = Infinity;
    let by0 = Infinity;
    let bx1 = -Infinity;
    let by1 = -Infinity;
    for (const p of r.parts) for (const [x, y] of p) {
      if (x < bx0) bx0 = x;
      if (y < by0) by0 = y;
      if (x > bx1) bx1 = x;
      if (y > by1) by1 = y;
    }
    sv.setFloat64(o + 4, bx0, true);
    sv.setFloat64(o + 12, by0, true);
    sv.setFloat64(o + 20, bx1, true);
    sv.setFloat64(o + 28, by1, true);
    const nPoints = r.parts.reduce((a, p) => a + p.length, 0);
    sv.setInt32(o + 36, r.parts.length, true);
    sv.setInt32(o + 40, nPoints, true);
    let q = o + 44;
    let start = 0;
    for (const p of r.parts) {
      sv.setInt32(q, start, true);
      q += 4;
      start += p.length;
    }
    for (const p of r.parts) {
      for (const [x, y] of p) {
        sv.setFloat64(q, x, true);
        sv.setFloat64(q + 8, y, true);
        q += 16;
      }
    }
    o += contentLen[i];
  });
  return { shp, shx, dbf: writeDbf(rows, fields) };
}

// ---- KML ------------------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** #rrggbb + alpha (0–1) → KML aabbggrr. */
export function kmlColor(hex: string, alpha = 1): string {
  const h = hex.replace('#', '');
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `${a}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`;
}

const coordString = (ring: Ring) => ring.map(([x, y]) => `${x.toFixed(6)},${y.toFixed(6)},0`).join(' ');

export interface KmlPlacemark {
  name: string;
  style: string;
  data?: Record<string, string | number>;
  description?: string;
  geometry: { type: 'Point'; coordinates: [number, number] } | { type: 'LineString'; coordinates: Ring } | { type: 'MultiPolygon'; coordinates: Ring[][] };
}

export interface KmlFolder {
  name: string;
  visible?: boolean;
  placemarks: KmlPlacemark[];
}

export interface KmlStyle {
  id: string;
  color: string;
  fillOpacity?: number;
  lineWidth?: number;
  icon?: boolean;
}

export function buildKml(doc: { name: string; description: string; styles: KmlStyle[]; folders: KmlFolder[] }): string {
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<kml xmlns="http://www.opengis.net/kml/2.2"><Document>');
  out.push(`<name>${esc(doc.name)}</name><description>${esc(doc.description)}</description>`);
  for (const s of doc.styles) {
    out.push(`<Style id="${s.id}">`);
    if (s.icon) out.push(`<IconStyle><color>${kmlColor(s.color)}</color><scale>0.9</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle>`);
    out.push(`<LineStyle><color>${kmlColor(s.color, 0.95)}</color><width>${s.lineWidth ?? 1}</width></LineStyle>`);
    out.push(`<PolyStyle><color>${kmlColor(s.color, s.fillOpacity ?? 0.55)}</color></PolyStyle></Style>`);
  }
  for (const folder of doc.folders) {
    out.push(`<Folder><name>${esc(folder.name)}</name><visibility>${folder.visible === false ? 0 : 1}</visibility>`);
    for (const p of folder.placemarks) {
      out.push(`<Placemark><name>${esc(p.name)}</name><styleUrl>#${p.style}</styleUrl>`);
      if (p.description) out.push(`<description>${esc(p.description)}</description>`);
      if (p.data) {
        out.push('<ExtendedData>');
        for (const [k, v] of Object.entries(p.data)) out.push(`<Data name="${esc(k)}"><value>${esc(String(v))}</value></Data>`);
        out.push('</ExtendedData>');
      }
      const g = p.geometry;
      if (g.type === 'Point') out.push(`<Point><coordinates>${g.coordinates[0].toFixed(6)},${g.coordinates[1].toFixed(6)},0</coordinates></Point>`);
      else if (g.type === 'LineString') out.push(`<LineString><tessellate>1</tessellate><coordinates>${coordString(g.coordinates)}</coordinates></LineString>`);
      else {
        out.push('<MultiGeometry>');
        for (const poly of g.coordinates) {
          out.push(`<Polygon><tessellate>1</tessellate><outerBoundaryIs><LinearRing><coordinates>${coordString(poly[0])}</coordinates></LinearRing></outerBoundaryIs>`);
          for (const hole of poly.slice(1)) out.push(`<innerBoundaryIs><LinearRing><coordinates>${coordString(hole)}</coordinates></LinearRing></innerBoundaryIs>`);
          out.push('</Polygon>');
        }
        out.push('</MultiGeometry>');
      }
      out.push('</Placemark>');
    }
    out.push('</Folder>');
  }
  out.push('</Document></kml>');
  return out.join('\n');
}

// ---- ESRI ASCII grid ------------------------------------------------------------------------

/** ESRI ASCII grid in WGS 84, with GDAL's DX/DY keys because lng/lat cells are not square. */
export function toAsciiGrid(values: ArrayLike<number>, g: GridGeometry, decimals = 2, nodata = -9999, isNoData?: (v: number) => boolean): string {
  const lines = [
    `ncols ${g.cols}`,
    `nrows ${g.rows}`,
    `xllcorner ${g.bbox[0].toFixed(8)}`,
    `yllcorner ${g.bbox[1].toFixed(8)}`,
    `dx ${g.lngStep.toFixed(10)}`,
    `dy ${g.latStep.toFixed(10)}`,
    `NODATA_value ${nodata}`,
  ];
  for (let r = 0; r < g.rows; r++) {
    const row: string[] = new Array(g.cols);
    for (let c = 0; c < g.cols; c++) {
      const v = values[r * g.cols + c];
      row[c] = !Number.isFinite(v) || isNoData?.(v) ? String(nodata) : v.toFixed(decimals);
    }
    lines.push(row.join(' '));
  }
  return lines.join('\n') + '\n';
}

// ---- CSV ------------------------------------------------------------------------------------

export function toCsv(header: string[], rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))].join('\n') + '\n';
}

// ---- Zip (STORE) ----------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zipFiles(files: { name: string; data: Uint8Array | string }[]): Uint8Array {
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const entries = files.map((f) => {
    const data = typeof f.data === 'string' ? encoder.encode(f.data) : f.data;
    return { name: encoder.encode(f.name), data, crc: crc32(data) };
  });
  const localSize = entries.reduce((a, e) => a + 30 + e.name.length + e.data.length, 0);
  const centralSize = entries.reduce((a, e) => a + 46 + e.name.length, 0);
  const out = new Uint8Array(localSize + centralSize + 22);
  const v = new DataView(out.buffer);
  let o = 0;
  const offsets: number[] = [];
  for (const e of entries) {
    offsets.push(o);
    v.setUint32(o, 0x04034b50, true);
    v.setUint16(o + 4, 20, true);
    v.setUint16(o + 6, 0x0800, true);
    v.setUint16(o + 8, 0, true);
    v.setUint16(o + 10, dosTime, true);
    v.setUint16(o + 12, dosDate, true);
    v.setUint32(o + 14, e.crc, true);
    v.setUint32(o + 18, e.data.length, true);
    v.setUint32(o + 22, e.data.length, true);
    v.setUint16(o + 26, e.name.length, true);
    v.setUint16(o + 28, 0, true);
    out.set(e.name, o + 30);
    out.set(e.data, o + 30 + e.name.length);
    o += 30 + e.name.length + e.data.length;
  }
  const cdStart = o;
  entries.forEach((e, i) => {
    v.setUint32(o, 0x02014b50, true);
    v.setUint16(o + 4, 20, true);
    v.setUint16(o + 6, 20, true);
    v.setUint16(o + 8, 0x0800, true);
    v.setUint16(o + 10, 0, true);
    v.setUint16(o + 12, dosTime, true);
    v.setUint16(o + 14, dosDate, true);
    v.setUint32(o + 16, e.crc, true);
    v.setUint32(o + 20, e.data.length, true);
    v.setUint32(o + 24, e.data.length, true);
    v.setUint16(o + 28, e.name.length, true);
    v.setUint32(o + 42, offsets[i], true);
    out.set(e.name, o + 46);
    o += 46 + e.name.length;
  });
  v.setUint32(o, 0x06054b50, true);
  v.setUint16(o + 8, entries.length, true);
  v.setUint16(o + 10, entries.length, true);
  v.setUint32(o + 12, o - cdStart, true);
  v.setUint32(o + 16, cdStart, true);
  return out;
}

export function download(data: Uint8Array | string, filename: string, mime: string): void {
  const blob = new Blob([typeof data === 'string' ? data : new Uint8Array(data)], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
