// Reads and writes .xlsx workbooks, and reads delimited text, with no dependency.
//
// An .xlsx is a ZIP of XML parts, and both halves of that are already available: DEFLATE through
// `DecompressionStream` and the markup through a scan of the sheet XML, which Excel writes in a
// narrow, entirely regular shape. Adding a spreadsheet library for this would cost several hundred
// kilobytes in a bundle whose whole point is to run on a laptop in a district office.

import { zipFiles } from './export/formats.ts';

export interface Sheet {
  name: string;
  /** Row-major cell text; short rows are padded so every row has the same length. */
  rows: string[][];
}

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const EOCD = 0x06054b50;

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The entries of a ZIP archive, by name. Handles the two methods Excel emits: stored and deflate. */
async function readZip(buf: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  // The end-of-central-directory record is last, after a comment of up to 64 KB.
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a .xlsx file (no ZIP directory found).');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== CENTRAL) break;
    const method = view.getUint16(p + 10, true);
    const compressed = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const offset = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (view.getUint32(offset, true) !== LOCAL) continue;
    // The local header repeats the name and carries its own extra field, which may differ in length.
    const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
    const raw = bytes.subarray(start, start + compressed);
    out.set(name, method === 0 ? raw : await inflateRaw(raw));
  }
  return out;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code] ?? whole;
  });
}

/** Every `<t>` inside each `<si>`, joined — rich text arrives split across runs. */
function sharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const si of xml.match(/<si>[\s\S]*?<\/si>/g) ?? []) {
    let text = '';
    for (const t of si.match(/<t[^>]*>[\s\S]*?<\/t>/g) ?? []) text += decodeXml(t.replace(/^<t[^>]*>/, '').replace(/<\/t>$/, ''));
    out.push(text);
  }
  return out;
}

/** "BC12" → 54. Excel addresses columns in base 26 with no zero. */
function columnOf(ref: string): number {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

function sheetRows(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  let width = 0;
  for (const row of xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) ?? []) {
    const cells: string[] = [];
    for (const cell of row.match(/<c[^>]*\/>|<c[^>]*>[\s\S]*?<\/c>/g) ?? []) {
      const ref = /\sr="([A-Z]+)/.exec(cell);
      const col = ref ? columnOf(ref[1]) : cells.length;
      const type = /\st="([^"]+)"/.exec(cell)?.[1];
      let text = '';
      if (type === 'inlineStr') {
        for (const t of cell.match(/<t[^>]*>[\s\S]*?<\/t>/g) ?? []) text += decodeXml(t.replace(/^<t[^>]*>/, '').replace(/<\/t>$/, ''));
      } else {
        const v = /<v[^>]*>([\s\S]*?)<\/v>/.exec(cell)?.[1];
        if (v !== undefined) text = type === 's' ? (shared[Number(v)] ?? '') : decodeXml(v);
      }
      while (cells.length < col) cells.push('');
      cells[col] = text;
    }
    width = Math.max(width, cells.length);
    rows.push(cells);
  }
  for (const r of rows) while (r.length < width) r.push('');
  return rows;
}

export async function readWorkbook(file: Blob): Promise<Sheet[]> {
  const zip = await readZip(await file.arrayBuffer());
  const decoder = new TextDecoder();
  const part = (name: string) => {
    const data = zip.get(name);
    return data ? decoder.decode(data) : '';
  };
  const shared = sharedStrings(part('xl/sharedStrings.xml'));
  // The workbook names the sheets and gives each a relationship id; the relationships map those to
  // the parts. Sheets are read in workbook order so the first sheet stays the first sheet.
  const rels = new Map<string, string>();
  for (const m of part('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && target) rels.set(id, target.replace(/^\/?(xl\/)?/, ''));
  }
  const sheets: Sheet[] = [];
  for (const m of part('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)) {
    const name = /\bname="([^"]*)"/.exec(m[0])?.[1];
    const rid = /\br:id="([^"]+)"/.exec(m[0])?.[1];
    const target = rid ? rels.get(rid) : undefined;
    const xml = target ? part(`xl/${target}`) : '';
    if (name && xml) sheets.push({ name: decodeXml(name), rows: sheetRows(xml, shared) });
  }
  if (sheets.length === 0) throw new Error('The workbook has no readable sheets.');
  return sheets;
}

/** CSV or TSV, quotes and embedded newlines included. The delimiter is detected from the header. */
export function parseDelimited(text: string): string[][] {
  const body = text.replace(/^﻿/, '');
  const head = body.slice(0, body.indexOf('\n') + 1 || body.length);
  const delimiter = (head.match(/\t/g)?.length ?? 0) > (head.match(/,/g)?.length ?? 0) ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"') {
        if (body[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && body[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((v) => v !== '')) rows.push(row);
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  for (const r of rows) while (r.length < width) r.push('');
  return rows;
}

// ---- Writing ------------------------------------------------------------------------------------

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** "A", "B", … "AA". */
function columnName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export interface SheetData {
  name: string;
  rows: (string | number)[][];
}

/**
 * Writes a workbook Excel and LibreOffice will open, and `readWorkbook` will read back. Text goes
 * through the shared-string table, as Excel writes it, so a file round-trips through both halves of
 * this module. The ZIP is stored rather than deflated — these are a few kilobytes of a template.
 */
export function writeWorkbook(sheets: SheetData[]): Uint8Array {
  const shared: string[] = [];
  const index = new Map<string, number>();
  const sheetXml = sheets.map((sheet) => {
    const rows = sheet.rows
      .map((row, r) => {
        const cells = row
          .map((v, c) => {
            const ref = `${columnName(c)}${r + 1}`;
            if (typeof v === 'number') return Number.isFinite(v) ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}"/>`;
            if (v === '') return `<c r="${ref}"/>`;
            let i = index.get(v);
            if (i === undefined) {
              i = shared.push(v) - 1;
              index.set(v, i);
            }
            return `<c r="${ref}" t="s"><v>${i}</v></c>`;
          })
          .join('');
        return `<row r="${r + 1}">${cells}</row>`;
      })
      .join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
  });

  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const ct = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
  return zipFiles([
    {
      name: '[Content_Types].xml',
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="${ct}.sheet.main+xml"/>` +
        sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${ct}.worksheet+xml"/>`).join('') +
        `<Override PartName="/xl/sharedStrings.xml" ContentType="${ct}.sharedStrings+xml"/></Types>`,
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${rel}"><sheets>` +
        sheets.map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        `</sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${rel}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rIdStrings" Type="${rel}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    },
    {
      name: 'xl/sharedStrings.xml',
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">` +
        shared.map((s) => `<si><t xml:space="preserve">${escapeXml(s)}</t></si>`).join('') +
        `</sst>`,
    },
    ...sheetXml.map((data, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data })),
  ]);
}

/**
 * The three sheets `importDataset` recognises, filled with Tehri's own figures as worked examples.
 * Handing someone a file they can edit beats describing a format they have to construct.
 */
export function datasetTemplate(): Uint8Array {
  return writeWorkbook([
    {
      name: 'Hydrograph',
      rows: [
        ['Time (min)', 'Discharge (m3/s)'],
        [0, 0],
        [15, 120000],
        [30, 410000],
        [45, 590000],
        [60, 547000],
        [120, 180000],
        [240, 60000],
        [480, 12000],
      ],
    },
    {
      name: 'Dam',
      rows: [
        ['Parameter', 'Value'],
        ['Height (m)', 260.5],
        ['Volume (MCM)', 3540],
        ['Water depth (m)', 250],
        ['Breach width (m)', 498],
        ['Formation time (min)', 77],
        ['Manning n', 0.045],
      ],
    },
    {
      name: 'Settlements',
      rows: [
        ['Name', 'Latitude', 'Longitude', 'Population'],
        ['Devprayag', 30.1462, 78.5986, 2144],
        ['Rishikesh', 30.1087, 78.2921, 102138],
        ['Virbhadra', 30.1265, 78.3106, 15000],
      ],
    },
  ]);
}
