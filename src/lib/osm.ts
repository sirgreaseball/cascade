// Exposure data (settlements, critical facilities, bridges, major roads) from OpenStreetMap
// via the Overpass API. Used both by the in-app scenario builder and by the Node data-build
// script, so it is self-contained (no imports).

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

export function overpassQuery(bbox: [number, number, number, number]): string {
  const b = `${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]}`;
  return `[out:json][timeout:120];
(
  node["place"~"^(city|town|suburb|village|hamlet)$"](${b});
  nwr["amenity"~"^(hospital|clinic|doctors|school|college|university|police|fire_station)$"](${b});
)->.poi;
.poi out center tags;
way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"](${b});
out geom tags;`;
}

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

export function parseOverpass(json: { elements: OverpassElement[] }): { assets: AssetCollection; roads: RoadCollection } {
  const assets: PointFeature<AssetProperties>[] = [];
  const roads: LineFeature<RoadProperties>[] = [];
  const seenBridges = new Set<string>();

  for (const el of json.elements ?? []) {
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs an Overpass query, rotating through public mirrors and backing off when they are busy
 * (HTTP 429 / 5xx are common on the free instances).
 */
async function overpass<T>(
  query: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal | undefined,
  onRetry: ((message: string) => void) | undefined,
  backoff: number[],
): Promise<T> {
  const body = new URLSearchParams({ data: query });
  let lastError: unknown = null;
  for (const wait of backoff) {
    if (wait) {
      onRetry?.(`OpenStreetMap servers are busy — retrying in ${wait / 1000} s`);
      await sleep(wait);
    }
    for (const endpoint of OVERPASS_ENDPOINTS) {
      if (signal?.aborted) throw new Error('Cancelled');
      try {
        const res = await fetchImpl(endpoint, { method: 'POST', body, signal });
        if (!res.ok) throw new Error(`Overpass ${new URL(endpoint).host} returned ${res.status}`);
        return (await res.json()) as T;
      } catch (err) {
        lastError = err;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Overpass request failed');
}

export async function fetchOsmExposure(
  bbox: [number, number, number, number],
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
  onRetry?: (message: string) => void,
): Promise<{ assets: AssetCollection; roads: RoadCollection }> {
  return parseOverpass(await overpass(overpassQuery(bbox), fetchImpl, signal, onRetry, [0, 8_000, 20_000]));
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
  const json = await overpass<{ elements: OverpassElement[] }>(damLineQuery(lng, lat, radius), fetchImpl, signal, undefined, [0, 4_000]);
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
