// Augments the curated national catalogue with every named dam and reservoir OpenStreetMap holds
// for India, so the scenario builder can find a district structure and not only the famous ones.
//
// The curated file (scripts/build-national-catalogue.ts) carries height, storage and river for 144
// major dams from the CWC register. That is the right data and the wrong coverage: a search for a
// dam in Dhule returns nothing. OpenStreetMap has the coverage and almost none of the figures —
// barely one dam in ten carries a height tag — so the two are merged rather than swapped. A curated
// record always wins; an OSM record fills the gap with a position and a name, and the builder asks
// for the numbers it cannot know.
//
// Dams are mapped two ways and both are collected: `waterway=dam` is the structure, while many
// Indian dams are mapped only as the water body (`landuse=reservoir`, `water=reservoir`) named
// after the dam. Taking only the first misses roughly nine tenths of them.
//
// Usage: node scripts/fetch-osm-dams.ts [--out public/data/dams-national.json]
// Needs a connection Overpass answers on; it is blocked on some campus networks.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const ENDPOINT = 'https://overpass-api.de/api/interpreter';
// Overpass refuses a request with no User-Agent, with a 406 that looks like a network block.
const UA = 'Cascade/1.0 (Smart India Hackathon dam-break model)';

/** ISO 3166-2 codes for every Indian state and union territory, with the spellings OSM accepts. */
const REGIONS: [code: string, name: string][] = [
  ['IN-AN', 'Andaman and Nicobar Islands'], ['IN-AP', 'Andhra Pradesh'], ['IN-AR', 'Arunachal Pradesh'],
  ['IN-AS', 'Assam'], ['IN-BR', 'Bihar'], ['IN-CH', 'Chandigarh'], ['IN-CT', 'Chhattisgarh'],
  ['IN-DH', 'Dadra and Nagar Haveli and Daman and Diu'], ['IN-DL', 'Delhi'], ['IN-GA', 'Goa'],
  ['IN-GJ', 'Gujarat'], ['IN-HP', 'Himachal Pradesh'], ['IN-HR', 'Haryana'], ['IN-JH', 'Jharkhand'],
  ['IN-JK', 'Jammu and Kashmir'], ['IN-KA', 'Karnataka'], ['IN-KL', 'Kerala'], ['IN-LA', 'Ladakh'],
  ['IN-LD', 'Lakshadweep'], ['IN-MH', 'Maharashtra'], ['IN-ML', 'Meghalaya'], ['IN-MN', 'Manipur'],
  ['IN-MP', 'Madhya Pradesh'], ['IN-MZ', 'Mizoram'], ['IN-NL', 'Nagaland'], ['IN-OR', 'Odisha'],
  ['IN-PB', 'Punjab'], ['IN-PY', 'Puducherry'], ['IN-RJ', 'Rajasthan'], ['IN-SK', 'Sikkim'],
  ['IN-TG', 'Telangana'], ['IN-TN', 'Tamil Nadu'], ['IN-TR', 'Tripura'], ['IN-UP', 'Uttar Pradesh'],
  ['IN-UT', 'Uttarakhand'], ['IN-WB', 'West Bengal'],
];

interface OsmElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface CatalogueRecord {
  id: string;
  name: string;
  river: string;
  state: string;
  district: string;
  nearestCity: string;
  lng: number;
  lat: number;
  height: number;
  crestLength: number;
  volumeMCM: number;
  type?: string;
  year?: number;
  /** True when the figures are defaults for the builder to replace, not measured values. */
  approximate?: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function overpass(query: string, attempt = 0): Promise<OsmElement[]> {
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'User-Agent': UA },
      body: query,
    });
  } catch (err) {
    // A dropped connection, not a refusal: tethered and campus links lose one request in ten, and
    // giving up on the first would quietly leave whole states out of the catalogue.
    if (attempt >= 4) throw err;
    await sleep(8_000 * (attempt + 1));
    return overpass(query, attempt + 1);
  }
  if (res.status === 429 || res.status === 504) {
    if (attempt >= 4) throw new Error(`Overpass kept returning ${res.status}`);
    // The public instance queues by slot; waiting is the documented way through.
    await sleep(15_000 * (attempt + 1));
    return overpass(query, attempt + 1);
  }
  if (!res.ok) throw new Error(`Overpass returned ${res.status}`);
  const text = await res.text();
  if (!text.trimStart().startsWith('{')) throw new Error(`Overpass returned ${text.slice(0, 120)}`);
  return (JSON.parse(text) as { elements?: OsmElement[] }).elements ?? [];
}

const queryFor = (code: string) => `[out:json][timeout:240];
area["ISO3166-2"="${code}"]->.r;
(
  nwr["waterway"="dam"]["name"](area.r);
  nwr["landuse"="reservoir"]["name"](area.r);
  nwr["water"="reservoir"]["name"](area.r);
);
out center tags;`;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Strips the words that make two records of one dam look like two dams. */
const bareName = (s: string) =>
  s.toLowerCase().replace(/\b(dam|reservoir|lake|bandhara|project|weir|barrage|tank)\b/g, '').replace(/[^a-z0-9]/g, '');

/** A dam's height in metres if OSM recorded one; heights arrive as "42", "42 m" or "42.5m". */
function heightOf(tags: Record<string, string>): number | null {
  const raw = tags.height ?? tags['dam:height'] ?? tags.ele;
  if (!raw) return null;
  const v = Number.parseFloat(raw.replace(/[^\d.]/g, ''));
  return Number.isFinite(v) && v > 3 && v < 350 ? v : null;
}

async function main(): Promise<void> {
  const outArg = process.argv.indexOf('--out');
  const out = outArg > 0 ? process.argv[outArg + 1] : path.join(root, 'public', 'data', 'dams-national.json');

  const curatedRaw = JSON.parse(await readFile(out, 'utf8')) as { dams?: CatalogueRecord[] } | CatalogueRecord[];
  const curated: CatalogueRecord[] = Array.isArray(curatedRaw) ? curatedRaw : (curatedRaw.dams ?? []);
  console.log(`curated records: ${curated.length}`);

  // A curated dam claims its name and its neighbourhood, so an OSM record of the same structure
  // does not appear twice under a slightly different spelling.
  const taken = new Map<string, CatalogueRecord>();
  for (const d of curated) taken.set(bareName(d.name), d);

  const added: CatalogueRecord[] = [];
  const failures: string[] = [];
  const seen = new Set<string>();
  for (const [code, state] of REGIONS) {
    let elements: OsmElement[];
    try {
      elements = await overpass(queryFor(code));
    } catch (err) {
      console.log(`  ${code} ${state}: FAILED — ${err instanceof Error ? err.message : String(err)}`);
      failures.push(`${code} ${state}`);
      continue;
    }
    let kept = 0;
    for (const el of elements) {
      const tags = el.tags ?? {};
      const name = (tags['name:en'] ?? tags.name ?? '').trim();
      if (!name || name.length < 3 || /^\d+$/.test(name)) continue;
      const lat = el.lat ?? el.center?.lat;
      const lng = el.lon ?? el.center?.lon;
      if (lat === undefined || lng === undefined) continue;
      const key = bareName(name);
      if (!key) continue;
      // Two records within a few kilometres under the same bare name are one dam: the structure
      // and the water behind it.
      const near = `${key}:${Math.round(lat * 20)}:${Math.round(lng * 20)}`;
      if (taken.has(key) || seen.has(near)) continue;
      seen.add(near);
      const height = heightOf(tags);
      added.push({
        id: `osm-${el.type[0]}${el.id}`,
        name: /dam|reservoir|lake|sagar|barrage/i.test(name) ? name : `${name} Dam`,
        river: tags.river ?? tags['water:river'] ?? '',
        state,
        district: tags['addr:district'] ?? '',
        nearestCity: tags['addr:city'] ?? tags['addr:town'] ?? '',
        lng: Number(lng.toFixed(5)),
        lat: Number(lat.toFixed(5)),
        // Defaults a builder replaces, sized for a mid-scale Indian irrigation dam. Flagged so the
        // interface can say plainly that these are placeholders, not survey values.
        height: height ?? 30,
        crestLength: Number(tags['dam:length'] ?? tags.length ?? 0) || 300,
        volumeMCM: 50,
        type: tags['dam:type'] ?? undefined,
        approximate: true,
      });
      kept++;
    }
    console.log(`  ${code} ${state.padEnd(38)} ${String(elements.length).padStart(5)} features → ${String(kept).padStart(4)} kept`);
    await sleep(1200);
  }

  const all = [...curated, ...added].sort((a, b) => a.name.localeCompare(b.name));
  const withHeight = added.filter((d) => d.height !== 30).length;
  await writeFile(
    out,
    `${JSON.stringify(
      {
        generated: new Date().toISOString().slice(0, 10),
        source:
          'Curated records from the CWC National Register of Large Dams (GODL-India); the remainder from OpenStreetMap contributors (ODbL) via the Overpass API.',
        note: 'Records marked approximate carry placeholder height, crest length and storage for the builder to replace.',
        dams: all,
      },
      null,
      1,
    )}\n`,
  );
  console.log(`\ncurated ${curated.length} + OpenStreetMap ${added.length} = ${all.length} dams`);
  console.log(`${withHeight} of the added records carried a height tag; the rest take a placeholder.`);
  console.log(`written to ${path.relative(root, out)}`);
  if (failures.length > 0) console.log(`
states that never answered, re-run to fill them in: ${failures.join(', ')}`);
}

await main();
