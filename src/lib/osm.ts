// Exposure data (settlements, critical facilities, bridges, major roads) and dam crest lines from
// OpenStreetMap. Used both by the in-app scenario builder and by the Node data-build scripts, so
// it is self-contained (no imports).

export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';
export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

export type AssetKind = 'settlement' | 'hospital' | 'school' | 'emergency' | 'bridge';

export interface AssetProperties {
  id: string;
  kind: AssetKind;
  /** OSM subtype, e.g. city / town / village / hamlet / clinic / college / police. */
  subtype: string;
  name: string;
  population: number;
  /** True when OSM had no population tag and a typical value for the place type was used. */
  populationEstimated: boolean;
}

export interface RoadProperties {
  id: string;
  name: string;
  highway: string;
  bridge: boolean;
}

export interface PointFeature<P> {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: P;
}

export interface LineFeature<P> {
  type: 'Feature';
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  properties: P;
}

export interface FeatureCollection<F> {
  type: 'FeatureCollection';
  features: F[];
}

export type AssetCollection = FeatureCollection<PointFeature<AssetProperties>>;
export type RoadCollection = FeatureCollection<LineFeature<RoadProperties>>;

/** Typical populations for untagged places (order-of-magnitude Census 2011 medians for hill districts). */
export const DEFAULT_POPULATION: Record<string, number> = {
  city: 100_000,
  town: 15_000,
  suburb: 5_000,
  village: 1_000,
  hamlet: 150,
};

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  geometry?: Array<{ lat: number; lon: number }>;
  tags?: Record<string, string>;
}

const round = (v: number) => Math.round(v * 1e5) / 1e5;

function parsePopulation(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(/[,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function facilityKind(amenity: string): AssetKind {
  if (amenity === 'hospital' || amenity === 'clinic' || amenity === 'doctors') return 'hospital';
  if (amenity === 'police' || amenity === 'fire_station') return 'emergency';
  return 'school';
}

function toExposure(elements: OverpassElement[]): { assets: AssetCollection; roads: RoadCollection } {
  const assets: PointFeature<AssetProperties>[] = [];
  const roads: LineFeature<RoadProperties>[] = [];
  const seenBridges = new Set<string>();

  for (const el of elements) {
    const tags = el.tags ?? {};
    if (el.type === 'way' && el.geometry && tags.highway) {
      const coords = el.geometry.map((p) => [round(p.lon), round(p.lat)] as [number, number]);
      if (coords.length < 2) continue;
      const bridge = tags.bridge === 'yes' || tags.bridge === 'viaduct';
      roads.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
        properties: { id: `osm:w${el.id}`, name: tags.name ?? tags.ref ?? '', highway: tags.highway, bridge },
      });
      if (bridge) {
        const mid = coords[Math.floor(coords.length / 2)];
        const key = `${mid[0].toFixed(3)},${mid[1].toFixed(3)}`;
        if (!seenBridges.has(key)) {
          seenBridges.add(key);
          assets.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: mid },
            properties: {
              id: `osm:w${el.id}`,
              kind: 'bridge',
              subtype: tags.highway,
              name: tags.name ?? (tags.ref ? `${tags.ref} bridge` : 'Road bridge'),
              population: 0,
              populationEstimated: false,
            },
          });
        }
      }
      continue;
    }

    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat === undefined || lon === undefined) continue;
    const coordinates: [number, number] = [round(lon), round(lat)];
    const id = `osm:${el.type[0]}${el.id}`;

    if (tags.place) {
      const pop = parsePopulation(tags.population);
      const name = tags['name:en'] ?? tags.name;
      if (!name) continue;
      assets.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates },
        properties: {
          id,
          kind: 'settlement',
          subtype: tags.place,
          name,
          population: pop ?? DEFAULT_POPULATION[tags.place] ?? 500,
          populationEstimated: pop === null,
        },
      });
    } else if (tags.amenity) {
      assets.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates },
        properties: {
          id,
          kind: facilityKind(tags.amenity),
          subtype: tags.amenity,
          name: tags['name:en'] ?? tags.name ?? tags.amenity.replace('_', ' '),
          population: 0,
          populationEstimated: false,
        },
      });
    }
  }
  return {
    assets: { type: 'FeatureCollection', features: assets },
    roads: { type: 'FeatureCollection', features: roads },
  };
}

/**
 * Asks every public mirror at once and returns the first good answer. The free servers are often
 * full: they turn a request away at once (429, 502, 504), sit on it, or answer 200 with a
 * "runtime error" remark and partial data. Each mirror is asked again a few seconds after it fails,
 * until one answers or `deadline` (ms) passes. Waiting for a whole round to fail before asking again
 * left the builder idle for 90 s behind the mirrors that never answer, while the ones that had
 * refused in a second would have taken the query.
 */
async function askMirrors<T>(query: string, fetchImpl: typeof fetch, deadline: number): Promise<T> {
  const body = new URLSearchParams({ data: query }).toString();
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), deadline);
  const pause = (ms: number) =>
    new Promise<void>((resolve) => {
      const t = setTimeout(resolve, ms);
      stop.signal.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true });
    });
  try {
    return await Promise.any(
      OVERPASS_ENDPOINTS.map(async (endpoint) => {
        for (let attempt = 0; ; attempt++) {
          const res = await fetchImpl(endpoint, {
            method: 'POST',
            body,
            // Overpass answers a request with no User-Agent with a 406 that reads like a blocked
            // network. A browser always sends one and ignores this header; Node sends none, so
            // without it the same code works in the app and fails in every script.
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Cascade/1.0 (dam-break model)' },
            signal: stop.signal,
          }).catch(() => null);
          if (res?.ok) {
            const json = (await res.json().catch(() => null)) as (T & { remark?: string }) | null;
            if (json && !/runtime error/i.test(json.remark ?? '')) {
              stop.abort();
              return json;
            }
          } else if (res && res.status !== 429 && res.status < 500) {
            throw new Error(`Overpass ${new URL(endpoint).host} returned ${res.status}`);
          }
          if (stop.signal.aborted) throw new Error('Stopped');
          await pause(Math.min(2_000 * 2 ** attempt, 10_000));
        }
      }),
    );
  } catch (err) {
    if (stop.signal.aborted) throw new Error(`OpenStreetMap did not answer in ${Math.round(deadline / 1000)} s.`);
    throw err instanceof AggregateError ? err.errors[0] : err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Answers by key, shared while in flight and kept for the session (failures are dropped). The
 * builder asks as soon as a dam is picked, and Build then joins that request instead of starting
 * it a second time. `signal` stops this caller waiting; the shared request carries on.
 */
const answers = new Map<string, Promise<unknown>>();

function shared<T>(key: string, start: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  let answer = answers.get(key) as Promise<T> | undefined;
  if (!answer) {
    answer = start();
    answers.set(key, answer);
    answer.catch(() => answers.delete(key));
    if (answers.size > 8) answers.delete(answers.keys().next().value!);
  }
  if (!signal) return answer;
  return new Promise<T>((resolve, reject) => {
    const cancel = () => reject(new Error('Cancelled'));
    if (signal.aborted) return cancel();
    signal.addEventListener('abort', cancel, { once: true });
    answer.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel));
  });
}

/** Runs an Overpass query on whichever mirror answers first. */
function overpass<T>(query: string, fetchImpl: typeof fetch, signal: AbortSignal | undefined, deadline: number): Promise<T> {
  return shared(query, () => askMirrors<T>(query, fetchImpl, deadline), signal);
}

/** Places and roads fetched before, kept on this device so rebuilding an area needs no network. */
function cacheStore(mode: IDBTransactionMode): Promise<IDBObjectStore | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open('cascade-osm', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('exposure');
    req.onsuccess = () => resolve(req.result.transaction('exposure', mode).objectStore('exposure'));
    req.onerror = () => resolve(null);
  });
}

async function cacheGet<T>(key: string): Promise<T | null> {
  const store = await cacheStore('readonly').catch(() => null);
  if (!store) return null;
  return new Promise((resolve) => {
    const req = store.get(key);
    req.onsuccess = () => resolve((req.result as T) ?? null);
    req.onerror = () => resolve(null);
  });
}

async function cachePut(key: string, value: unknown): Promise<void> {
  const store = await cacheStore('readwrite').catch(() => null);
  store?.put(value, key);
}

// ---- Exposure from vector tiles -------------------------------------------------------------

/**
 * The public Overpass servers queue a request for 20–40 s when they are busy, and turn it away
 * outright when they are full ("at capacity", 28 October 2026). OpenFreeMap serves the same
 * OpenStreetMap data as vector tiles (OpenMapTiles schema, rebuilt every few days) from a CDN in a
 * fraction of a second, so exposure comes from there. Zoom 14 is the only zoom that keeps every
 * hamlet, school and side road; a 40 km study area is about 500 tiles and 1 MB.
 */
const OPENFREEMAP = 'https://tiles.openfreemap.org/planet';
const TILE_ZOOM = 14;
const TILE_LAYERS = new Set(['place', 'poi', 'transportation', 'transportation_name']);
const PLACE_CLASSES = ['city', 'town', 'suburb', 'village', 'hamlet'];
const FACILITY = /^(hospital|clinic|doctors|school|college|university|police|fire_station)$/;
const MAJOR_ROAD = /^(motorway|trunk|primary|secondary|tertiary)$/;

type TileValue = string | number | boolean;

interface TileFeature {
  /** The OpenStreetMap id × 10, plus 1 for a node, 2 for a way, 3 for a relation. */
  id: number;
  /** 1 point, 2 line, 3 polygon. */
  type: number;
  props: Record<string, TileValue>;
  /** Points or lines in tile units: 0 to the layer's extent, plus a small buffer past each edge. */
  parts: XY[][];
}

const utf8 = new TextDecoder();

/** Reads the named layers of a Mapbox Vector Tile, a protobuf message, without a library. */
function readTile(buf: Uint8Array, wanted: Set<string>): Map<string, { extent: number; features: TileFeature[] }> {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let pos = 0;
  const varint = () => {
    let v = 0;
    let scale = 1;
    let b: number;
    do {
      b = buf[pos++];
      v += (b & 0x7f) * scale;
      scale *= 128;
    } while (b & 0x80);
    return v;
  };
  const zigzag = (n: number) => (n % 2 ? -(n + 1) / 2 : n / 2);
  const text = () => {
    const len = varint();
    pos += len;
    return utf8.decode(buf.subarray(pos - len, pos));
  };
  const skip = (wire: number) => {
    if (wire === 0) varint();
    else if (wire === 1) pos += 8;
    else if (wire === 5) pos += 4;
    else {
      // Not `pos += varint()`: that reads `pos` before varint() moves it past the length.
      const len = varint();
      pos += len;
    }
  };
  const fields = (end: number, on: (field: number, wire: number) => void) => {
    while (pos < end) {
      const key = varint();
      on(key >> 3, key & 7);
    }
  };
  const layers = new Map<string, { extent: number; features: TileFeature[] }>();
  fields(buf.length, (field, wire) => {
    if (field !== 3) return skip(wire);
    const end = varint() + pos;
    const start = pos;
    let name = '';
    fields(end, (f, w) => (f === 1 ? (name = text()) : skip(w)));
    if (!wanted.has(name)) return;
    pos = start;
    const keys: string[] = [];
    const values: TileValue[] = [];
    const ranges: [number, number][] = [];
    let extent = 4096;
    fields(end, (f, w) => {
      if (f === 2) {
        const featureEnd = varint() + pos;
        ranges.push([pos, featureEnd]);
        pos = featureEnd;
      } else if (f === 3) keys.push(text());
      else if (f === 4) {
        let v: TileValue = '';
        fields(varint() + pos, (vf, vw) => {
          if (vf === 1) v = text();
          else if (vf === 2) {
            v = view.getFloat32(pos, true);
            pos += 4;
          } else if (vf === 3) {
            v = view.getFloat64(pos, true);
            pos += 8;
          } else if (vf === 4 || vf === 5) v = varint();
          else if (vf === 6) v = zigzag(varint());
          else if (vf === 7) v = varint() !== 0;
          else skip(vw);
        });
        values.push(v);
      } else if (f === 5) extent = varint();
      else skip(w);
    });
    const features = ranges.map(([from, to]) => {
      pos = from;
      const feature: TileFeature = { id: 0, type: 0, props: {}, parts: [] };
      fields(to, (f, w) => {
        if (f === 1) feature.id = varint();
        else if (f === 3) feature.type = varint();
        else if (f === 2) {
          const tagsEnd = varint() + pos;
          while (pos < tagsEnd) feature.props[keys[varint()]] = values[varint()];
        } else if (f === 4) {
          // Commands: MoveTo (1) and LineTo (2) carry zigzag-encoded deltas; ClosePath (7) none.
          const geometryEnd = varint() + pos;
          let x = 0;
          let y = 0;
          let part: XY[] = [];
          while (pos < geometryEnd) {
            const command = varint();
            if ((command & 7) === 7) continue;
            for (let i = command >> 3; i > 0; i--) {
              x += zigzag(varint());
              y += zigzag(varint());
              if ((command & 7) === 1) feature.parts.push((part = []));
              part.push([x, y]);
            }
          }
        } else skip(w);
      });
      return feature;
    });
    layers.set(name, { extent, features });
    pos = end;
  });
  return layers;
}

/** The runs of a polyline that lie inside the tile, cut at its edges (Liang–Barsky per segment). */
function clipToTile(line: XY[], size: number): XY[][] {
  const runs: XY[][] = [];
  let run: XY[] | null = null;
  for (let i = 1; i < line.length; i++) {
    const [x0, y0] = line[i - 1];
    const dx = line[i][0] - x0;
    const dy = line[i][1] - y0;
    let t0 = 0;
    let t1 = 1;
    let inside = true;
    for (const [p, q] of [[-dx, x0], [dx, size - x0], [-dy, y0], [dy, size - y0]]) {
      if (p === 0) {
        if (q < 0) inside = false;
        continue;
      }
      const r = q / p;
      if (p < 0) {
        if (r > t1) inside = false;
        else if (r > t0) t0 = r;
      } else if (r < t0) inside = false;
      else if (r < t1) t1 = r;
    }
    if (!inside || t1 - t0 < 1e-9) {
      run = null;
      continue;
    }
    if (!run || t0 > 0) runs.push((run = [[x0 + t0 * dx, y0 + t0 * dy]]));
    run.push([x0 + t1 * dx, y0 + t1 * dy]);
    if (t1 < 1) run = null;
  }
  return runs;
}

/** Rejoins the pieces of one road that tile edges cut apart: their ends meet within a few metres. */
function stitch(pieces: XY[][]): XY[][] {
  const meet = (a: XY, b: XY) => haversineKm(a[1], a[0], b[1], b[0]) < 0.01;
  const left = [...pieces];
  const out: XY[][] = [];
  while (left.length) {
    let line = left.pop()!;
    for (let i = 0; i < left.length; i++) {
      const piece = left[i];
      if (meet(line[line.length - 1], piece[0])) line = line.concat(piece.slice(1));
      else if (meet(piece[piece.length - 1], line[0])) line = piece.concat(line.slice(1));
      else continue;
      left.splice(i, 1);
      i = -1;
    }
    out.push(line);
  }
  return out;
}

/**
 * Tiles simplify every road on its own, which drops the shared vertex where a side road meets a
 * straight one. Evacuation routing links roads only through shared vertices, so it would see the
 * side road stop half a metre short and cut off. A road end within 3 m of another road that does
 * not already pass through it becomes a vertex of that road. (Testing only loose ends misses the
 * crossroads, where the side road is split in two at the junction and its halves share the end.)
 */
function joinEnds(lines: XY[][]): void {
  const key = (p: XY) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
  const linesAt = new Map<string, Set<number>>();
  lines.forEach((line, li) => {
    for (const p of line) {
      const set = linesAt.get(key(p));
      if (set) set.add(li);
      else linesAt.set(key(p), new Set([li]));
    }
  });
  const cell = 0.002;
  const segments = new Map<string, [number, number][]>();
  lines.forEach((line, li) => {
    for (let i = 1; i < line.length; i++) {
      const [a, b] = [line[i - 1], line[i]];
      for (let gx = Math.floor(Math.min(a[0], b[0]) / cell); gx <= Math.floor(Math.max(a[0], b[0]) / cell); gx++) {
        for (let gy = Math.floor(Math.min(a[1], b[1]) / cell); gy <= Math.floor(Math.max(a[1], b[1]) / cell); gy++) {
          const list = segments.get(`${gx},${gy}`);
          if (list) list.push([li, i]);
          else segments.set(`${gx},${gy}`, [[li, i]]);
        }
      }
    }
  });
  const inserts = new Map<string, { li: number; i: number; t: number; p: XY }>();
  lines.forEach((line, li) => {
    for (const p of [line[0], line[line.length - 1]]) {
      const kx = 111_320 * Math.cos((p[1] * Math.PI) / 180);
      const ky = 110_574;
      const nearest = new Map<number, { d: number; i: number; t: number }>();
      const gx = Math.floor(p[0] / cell);
      const gy = Math.floor(p[1] / cell);
      for (let x = gx - 1; x <= gx + 1; x++) {
        for (let y = gy - 1; y <= gy + 1; y++) {
          for (const [lj, j] of segments.get(`${x},${y}`) ?? []) {
            if (lj === li) continue;
            const a = lines[lj][j - 1];
            const b = lines[lj][j];
            const ax = (b[0] - a[0]) * kx;
            const ay = (b[1] - a[1]) * ky;
            const px = (p[0] - a[0]) * kx;
            const py = (p[1] - a[1]) * ky;
            const l2 = ax * ax + ay * ay;
            const t = l2 ? Math.min(1, Math.max(0, (px * ax + py * ay) / l2)) : 0;
            const d = Math.hypot(px - t * ax, py - t * ay);
            if (d < 3 && d < (nearest.get(lj)?.d ?? Infinity)) nearest.set(lj, { d, i: j, t });
          }
        }
      }
      for (const [lj, { i, t }] of nearest) if (!linesAt.get(key(p))!.has(lj)) inserts.set(`${lj} ${key(p)}`, { li: lj, i, t, p });
    }
  });
  // Last segment first, and the far end of a segment before its near end, so indices stay valid.
  for (const { li, i, p } of [...inserts.values()].sort((a, b) => b.i - a.i || b.t - a.t)) lines[li].splice(i, 0, p);
}

/** One tile's bytes, asked for up to three times. An empty tile can come back as 204 or 404. */
async function tileBytes(url: string, fetchImpl: typeof fetch): Promise<Uint8Array> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetchImpl(url).catch(() => null);
    if (res?.status === 204 || res?.status === 404) return new Uint8Array(0);
    const buf = res?.ok ? await res.arrayBuffer().catch(() => null) : null;
    if (buf) return new Uint8Array(buf);
    if (attempt === 3) throw new Error('Map tiles from OpenFreeMap failed to download. Check the connection and try again.');
    await new Promise((resolve) => setTimeout(resolve, 1_000 * attempt));
  }
}

/**
 * OpenMapTiles leaves out the population tag. Few places carry one, but they are the towns that
 * dominate the people at risk (Morbi, 194,947), so one Nominatim lookup restores it for up to 50
 * places, the largest classes first. The rest keep the typical value for their class.
 */
async function addPopulations(elements: OverpassElement[], fetchImpl: typeof fetch): Promise<void> {
  const places = elements
    .filter((e) => e.tags?.place)
    .sort((a, b) => PLACE_CLASSES.indexOf(a.tags!.place) - PLACE_CLASSES.indexOf(b.tags!.place))
    .slice(0, 50);
  if (!places.length) return;
  const url = `https://nominatim.openstreetmap.org/lookup?format=json&extratags=1&osm_ids=${places.map((p) => `N${p.id}`).join(',')}`;
  const res = await fetchImpl(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'Cascade/1.0 (dam-break model)' },
    signal: AbortSignal.timeout(5_000),
  }).catch(() => null);
  const found = res?.ok ? ((await res.json().catch(() => [])) as { osm_id: number; extratags?: { population?: string } }[]) : [];
  const byId = new Map(places.map((p) => [p.id, p]));
  for (const f of found) {
    const place = byId.get(Number(f.osm_id));
    if (place && f.extratags?.population) place.tags!.population = f.extratags.population;
  }
}

/** The exposure in `bbox` as Overpass-style elements, read from the zoom-14 tiles that cover it. */
async function tileElements(
  bbox: [number, number, number, number],
  fetchImpl: typeof fetch,
  onProgress?: (message: string) => void,
): Promise<OverpassElement[]> {
  const res = await fetchImpl(OPENFREEMAP).catch(() => null);
  const template = res?.ok ? ((await res.json().catch(() => null)) as { tiles?: string[] } | null)?.tiles?.[0] : undefined;
  if (!template) throw new Error('OpenFreeMap did not answer. Check the connection and try again.');
  const n = 2 ** TILE_ZOOM;
  const column = (lng: number) => Math.floor(((lng + 180) / 360) * n);
  const row = (lat: number) => Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n);
  const tiles: XY[] = [];
  for (let x = column(bbox[0]); x <= column(bbox[2]); x++) for (let y = row(bbox[3]); y <= row(bbox[1]); y++) tiles.push([x, y]);
  const inside = ([lng, lat]: XY) => lng >= bbox[0] && lng <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
  const names = (props: Record<string, TileValue>) => ({
    ...(props.name ? { name: String(props.name) } : {}),
    ...(props['name:en'] ? { 'name:en': String(props['name:en']) } : {}),
  });

  const points = new Map<number, OverpassElement>();
  const roads = new Map<number, { pieces: XY[][]; tags: Record<string, string> }>();
  // Road names live in a separate layer of merged lines; they are matched back by shared vertices.
  const labels = new Map<string, Map<string, number>>();
  const read = (x: number, y: number, buf: Uint8Array) => {
    const layers = readTile(buf, TILE_LAYERS);
    const extent = layers.values().next().value?.extent ?? 4096;
    // Rounded as toExposure rounds, so points joinEnds finds equal stay equal in the output.
    const lngLat = ([px, py]: XY): XY => [
      round(((x + px / extent) / n) * 360 - 180),
      round((Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + py / extent)) / n))) * 180) / Math.PI),
    ];
    const point = (f: TileFeature, tags: Record<string, string>) => {
      const at = f.parts[0]?.[0] && lngLat(f.parts[0][0]);
      if (!at || !inside(at)) return;
      const type = f.id % 10 === 2 ? 'way' : f.id % 10 === 3 ? 'relation' : 'node';
      points.set(f.id, { type, id: Math.floor(f.id / 10), lon: at[0], lat: at[1], tags: { ...tags, ...names(f.props) } });
    };
    for (const f of layers.get('place')?.features ?? []) {
      if (PLACE_CLASSES.includes(String(f.props.class))) point(f, { place: String(f.props.class) });
    }
    for (const f of layers.get('poi')?.features ?? []) {
      if (FACILITY.test(String(f.props.subclass))) point(f, { amenity: String(f.props.subclass) });
    }
    for (const f of layers.get('transportation')?.features ?? []) {
      // `ramp` marks the *_link slip roads, which the major-road classes leave out.
      if (f.type !== 2 || !MAJOR_ROAD.test(String(f.props.class)) || f.props.ramp) continue;
      const road = roads.get(f.id) ?? { pieces: [], tags: { highway: String(f.props.class), ...(f.props.brunnel === 'bridge' ? { bridge: 'yes' } : {}) } };
      for (const part of f.parts) for (const run of clipToTile(part, extent)) road.pieces.push(run.map(lngLat));
      roads.set(f.id, road);
    }
    for (const f of layers.get('transportation_name')?.features ?? []) {
      const label = f.props.name ? `name:${f.props.name}` : f.props.ref ? `ref:${f.props.ref}` : '';
      if (!label || !MAJOR_ROAD.test(String(f.props.class))) continue;
      for (const part of f.parts) {
        for (const p of part) {
          const votes = labels.get(lngLat(p).join()) ?? new Map<string, number>();
          labels.set(lngLat(p).join(), votes.set(label, (votes.get(label) ?? 0) + 1));
        }
      }
    }
  };

  let next = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: 32 }, async () => {
      while (next < tiles.length) {
        const [x, y] = tiles[next++];
        try {
          read(x, y, await tileBytes(template.replace('{z}', String(TILE_ZOOM)).replace('{x}', String(x)).replace('{y}', String(y)), fetchImpl));
        } catch (err) {
          next = tiles.length;
          throw err;
        }
        onProgress?.(`${++done} of ${tiles.length} map tiles`);
      }
    }),
  );

  const lines: { id: number; line: XY[]; tags: Record<string, string> }[] = [];
  for (const [id, road] of roads) {
    // A road takes the name that most of its vertices share, if that is at least half of them;
    // a vertex or two in common is only a junction with a named road.
    const tally = new Map<string, number>();
    let vertices = 0;
    for (const piece of road.pieces) {
      for (const p of piece) {
        vertices++;
        for (const [label, count] of labels.get(p.join()) ?? []) tally.set(label, (tally.get(label) ?? 0) + count);
      }
    }
    const [label, votes] = [...tally].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
    const colon = label.indexOf(':');
    const tags = votes >= Math.max(2, vertices / 2) ? { ...road.tags, [label.slice(0, colon)]: label.slice(colon + 1) } : road.tags;
    for (const line of stitch(road.pieces)) if (line.some(inside)) lines.push({ id, line, tags });
  }
  joinEnds(lines.map((l) => l.line));

  const elements = [...points.values()];
  await addPopulations(elements, fetchImpl);
  for (const { id, line, tags } of lines) elements.push({ type: 'way', id: Math.floor(id / 10), geometry: line.map(([lon, lat]) => ({ lat, lon })), tags });
  return elements;
}

/** Settlements, facilities, bridges and major roads in `bbox`. `signal` stops this caller waiting. */
export async function fetchOsmExposure(
  bbox: [number, number, number, number],
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
  onProgress?: (message: string) => void,
): Promise<{ assets: AssetCollection; roads: RoadCollection }> {
  const key = bbox.map((v) => v.toFixed(3)).join(',');
  const cached = await cacheGet<{ assets: AssetCollection; roads: RoadCollection }>(key);
  if (cached) return cached;
  const report = onProgress && ((m: string) => {
    if (!signal?.aborted) onProgress(m);
  });
  return shared(
    `exposure:${key}`,
    async () => {
      const result = toExposure(await tileElements(bbox, fetchImpl, report));
      await cachePut(key, result).catch(() => undefined);
      return result;
    },
    signal,
  );
}

// ---- Dam crest lines ------------------------------------------------------------------------

type XY = [number, number];

export function damLineQuery(lng: number, lat: number, radius: number): string {
  return `[out:json][timeout:25];way["waterway"="dam"](around:${Math.round(radius)},${lat},${lng});out geom tags;`;
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

/**
 * A dam's crest as a line from abutment to abutment. OpenStreetMap maps large dams either as a
 * line along the crest or as the outline of the dam body. Outlines are reduced to their
 * centreline along whichever principal direction best matches the known crest length: an
 * embankment's footprint (Tehri's is ~1.1 km along the river) can be longer than its crest.
 */
export function damCentreline(coords: XY[], crestLength?: number): XY[] {
  const first = coords[0];
  const last = coords[coords.length - 1];
  const closed = coords.length > 3 && first[0] === last[0] && first[1] === last[1];
  if (!closed) return coords.map(([x, y]) => [round6(x), round6(y)]);

  const lat0 = coords.reduce((s, p) => s + p[1], 0) / coords.length;
  const lng0 = coords.reduce((s, p) => s + p[0], 0) / coords.length;
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110_574;
  // Densify the outline so every slice across it contains vertices.
  const pts: XY[] = [];
  for (let i = 0; i + 1 < coords.length; i++) {
    const ax = (coords[i][0] - lng0) * kx;
    const ay = (coords[i][1] - lat0) * ky;
    const bx = (coords[i + 1][0] - lng0) * kx;
    const by = (coords[i + 1][1] - lat0) * ky;
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 5));
    for (let k = 0; k < n; k++) pts.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y] of pts) {
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
    sxy += (x - mx) * (y - my);
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let u: XY = [Math.cos(theta), Math.sin(theta)];
  let v: XY = [-Math.sin(theta), Math.cos(theta)];
  const span = (d: XY) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const [x, y] of pts) {
      const t = (x - mx) * d[0] + (y - my) * d[1];
      if (t < lo) lo = t;
      if (t > hi) hi = t;
    }
    return { lo, hi, len: hi - lo };
  };
  if (crestLength && Math.abs(span(v).len - crestLength) < Math.abs(span(u).len - crestLength)) [u, v] = [v, u];
  const { lo, len } = span(u);
  const bins = Math.min(24, Math.max(2, Math.round(len / 40)));
  const minP = new Array<number>(bins).fill(Infinity);
  const maxP = new Array<number>(bins).fill(-Infinity);
  for (const [x, y] of pts) {
    const t = (x - mx) * u[0] + (y - my) * u[1];
    const p = (x - mx) * v[0] + (y - my) * v[1];
    const b = Math.min(bins - 1, Math.max(0, Math.floor(((t - lo) / len) * bins)));
    if (p < minP[b]) minP[b] = p;
    if (p > maxP[b]) maxP[b] = p;
  }
  const local: XY[] = [];
  for (let b = 0; b < bins; b++) {
    if (!Number.isFinite(minP[b])) continue;
    const t = lo + ((b + 0.5) / bins) * len;
    local.push([t, (minP[b] + maxP[b]) / 2]);
  }
  if (local.length === 0) return [];
  local.unshift([lo, local[0][1]]);
  local.push([lo + len, local[local.length - 1][1]]);
  return local.map(([t, p]) => {
    const x = mx + t * u[0] + p * v[0];
    const y = my + t * u[1] + p * v[1];
    return [round6(lng0 + x / kx), round6(lat0 + y / ky)] as XY;
  });
}

/** Approximate distance (m) from a point to a lng/lat polyline. */
function distanceToLine(line: XY[], lng: number, lat: number): number {
  const kx = 111_320 * Math.cos((lat * Math.PI) / 180);
  const ky = 110_574;
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const ax = (line[i][0] - lng) * kx;
    const ay = (line[i][1] - lat) * ky;
    const bx = (line[i + 1][0] - lng) * kx;
    const by = (line[i + 1][1] - lat) * ky;
    const l2 = (bx - ax) ** 2 + (by - ay) ** 2;
    const t = l2 > 0 ? Math.min(1, Math.max(0, -(ax * (bx - ax) + ay * (by - ay)) / l2)) : 0;
    best = Math.min(best, Math.hypot(ax + t * (bx - ax), ay + t * (by - ay)));
  }
  return best;
}

/**
 * The crest of the dam nearest to (lng, lat) from OpenStreetMap, or null when none is mapped
 * within `radius` metres. Lets the model and the map put the dam exactly where the imagery shows it.
 */
export async function fetchDamLine(
  lng: number,
  lat: number,
  crestLength?: number,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
  radius = 2500,
): Promise<XY[] | null> {
  const json = await overpass<{ elements: OverpassElement[] }>(damLineQuery(lng, lat, radius), fetchImpl, signal, 60_000);
  let best: XY[] | null = null;
  let bestDistance = Infinity;
  for (const el of json.elements ?? []) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
    const coords = el.geometry.map((p) => [p.lon, p.lat] as XY);
    const d = distanceToLine(coords, lng, lat);
    if (d < bestDistance) {
      bestDistance = d;
      best = coords;
    }
  }
  if (!best) return null;
  const line = damCentreline(best, crestLength);
  return line.length >= 2 ? line : null;
}

/**
 * Looks a dam up in OpenStreetMap by name, live, through Nominatim.
 *
 * The bundled catalogue is a snapshot, and a snapshot is the wrong shape for "does it know *my*
 * dam?" — whatever was not fetched is invisible however large the file grows. This asks the map
 * itself, so coverage is bounded by what has been mapped rather than by what was packaged.
 *
 * Nominatim rather than Overpass: a name is what the user has, and Overpass has no name index — a
 * regex scan across India times out, which is exactly what it did. Nominatim is built for this and
 * answers in well under a second. It gives no height or storage, but OpenStreetMap barely records
 * those anyway, so the builder asks for them either way.
 */
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

/** Great-circle distance in kilometres. */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Categories and types that are a dam or the water it holds, so a district of the same name is not offered. */
const WATER_CLASSES = new Set(['waterway', 'water', 'reservoir', 'natural', 'landuse']);
const WATER_TYPES = new Set(['dam', 'weir', 'reservoir', 'water', 'lake', 'basin', 'barrage']);

interface NominatimPlace {
  osm_type?: string;
  osm_id?: number;
  display_name?: string;
  name?: string;
  lat: string;
  lon: string;
  /** jsonv2 calls it `category`; the older format calls it `class`. Both appear in the wild. */
  category?: string;
  class?: string;
  type?: string;
  address?: Record<string, string>;
}

/**
 * The shape a catalogue entry takes, restated here rather than imported: this module is shared with
 * the Node build scripts and deliberately has no imports, as its header says. `DamCatalogEntry` in
 * `dams.ts` is structurally the same, so a result drops straight into the catalogue.
 */
export interface OsmDamResult {
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
  type: string;
  approximate: boolean;
}

async function nominatim(q: string, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<NominatimPlace[]> {
  const url = `${NOMINATIM}?q=${encodeURIComponent(q)}&countrycodes=in&format=jsonv2&addressdetails=1&limit=25`;
  const res = await fetchImpl(url, { signal, headers: { Accept: 'application/json', 'User-Agent': 'Cascade/1.0 (dam-break model)' } });
  if (!res.ok) throw new Error(`OpenStreetMap search returned ${res.status}`);
  return (await res.json()) as NominatimPlace[];
}

export async function searchOsmDams(name: string, fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<OsmDamResult[]> {
  const q = name.trim();
  if (q.length < 3) return [];
  let places = await nominatim(q, fetchImpl, signal);
  // People type the dam's name, not "<name> Dam", and a bare name ranks the district above the
  // structure — "Idukki" returns the district, "Idukki Dam" returns Idukki Arch Dam. Asking again
  // with the word costs one round trip and is the difference between finding it and not.
  if (!/(dam|reservoir|barrage|weir|sagar)/i.test(q)) {
    const withWord = await nominatim(`${q} dam`, fetchImpl, signal);
    const known = new Set(places.map((p) => `${p.osm_type}${p.osm_id}`));
    places = [...withWord, ...places.filter((p) => !known.has(`${p.osm_type}${p.osm_id}`))];
  }
  const out: OsmDamResult[] = [];
  for (const p of places) {
    const label = (p.name || p.display_name?.split(',')[0] || '').trim();
    const lat = Number(p.lat);
    const lng = Number(p.lon);
    if (!label || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    // Either the feature is tagged as water, or its name says what it is — "Hatnur Dam" mapped as
    // a locality is still the dam somebody is looking for.
    const watery =
      WATER_CLASSES.has(p.category ?? p.class ?? '') ||
      WATER_TYPES.has(p.type ?? '') ||
      /dam|reservoir|barrage|weir|sagar|bandh/i.test(label);
    if (!watery) continue;
    // One dam is routinely mapped twice — the wall and the water behind it — a kilometre or two
    // apart. Measuring the gap merges those; rounding coordinates into buckets does not, because
    // two points a kilometre apart still fall either side of a boundary often enough to show the
    // same dam twice.
    const bare = label.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (out.some((d) => d.name.toLowerCase().replace(/[^a-z0-9]/g, '') === bare && haversineKm(d.lat, d.lng, lat, lng) < 15)) continue;
    const a = p.address ?? {};
    out.push({
      id: `osm-${(p.osm_type ?? 'n')[0]}${p.osm_id ?? out.length}`,
      name: label,
      river: '',
      state: a.state ?? '',
      district: a.state_district ?? a.county ?? '',
      nearestCity: a.city ?? a.town ?? a.village ?? '',
      lng: Number(lng.toFixed(5)),
      lat: Number(lat.toFixed(5)),
      // OpenStreetMap almost never carries these; the builder asks for them and says why.
      height: 30,
      crestLength: 300,
      volumeMCM: 50,
      type: p.type ?? 'Unknown',
      approximate: true,
    });
  }
  return out;
}
