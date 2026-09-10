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
 * Queries Overpass, rotating through public mirrors and backing off when they are busy
 * (HTTP 429 / 5xx are common on the free instances).
 */
export async function fetchOsmExposure(
  bbox: [number, number, number, number],
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
  onRetry?: (message: string) => void,
): Promise<{ assets: AssetCollection; roads: RoadCollection }> {
  const body = new URLSearchParams({ data: overpassQuery(bbox) });
  let lastError: unknown = null;
  const backoff = [0, 8_000, 20_000];
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
        return parseOverpass(await res.json());
      } catch (err) {
        lastError = err;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Overpass request failed');
}
