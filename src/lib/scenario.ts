// Scenario configuration: bundled scenarios live in /public (offline-ready), user-built ones
// are stored in IndexedDB on this device.

import { gridGeometry } from './geo/grid';
import type { BBox, GridGeometry } from './geo/grid';
import type { AssetCollection, RoadCollection } from './osm';
import { defaultEventParams } from '@/simulation/hydrograph';
import type { EventKind, EventParams, FailureMode } from '@/simulation/hydrograph';

export interface DamInfo {
  name: string;
  lng: number;
  lat: number;
  height: number;
  crestLength: number;
  type?: string;
  completed?: number;
  reservoir?: string;
  volumeMCM: number;
  waterDepth: number;
  snapRadius?: number;
  /**
   * The real crest, abutment to abutment, as [lng, lat] points from OpenStreetMap, so the model
   * and the map line up with the imagery. null: looked up, none mapped (the axis is detected
   * from the DEM); undefined: not looked up yet.
   */
  crestLine?: [number, number][] | null;
}

/** One place where the real flood was recorded, against which the model can be checked. */
export interface ObservationPoint {
  /** Place name as OpenStreetMap spells it, so the point is matched to a settlement. */
  place: string;
  distanceKm?: number;
  /** Reported arrival window after the failure (minutes, low to high). */
  arrivalMin?: [number, number];
  /** Reported peak depth range (m, low to high). */
  peakDepthM?: [number, number];
  note?: string;
}

export interface ScenarioObservations {
  event: string;
  points: ObservationPoint[];
  sources: string;
  /** Why the comparison is a check rather than a calibration. Always shown with the numbers. */
  caveats: string;
}

export interface ScenarioConfig {
  id: string;
  name: string;
  river: string;
  region?: string;
  event: EventKind;
  summary?: string;
  bbox: BBox;
  cellSize: number;
  grid: { cols: number; rows: number };
  dem: { url?: string; source?: string; retrieved?: string; min?: number; max?: number };
  exposure: { assetsUrl?: string; roadsUrl?: string; source?: string; retrieved?: string };
  dam: DamInfo;
  defaults: {
    manning: number;
    duration: number;
    failureMode?: FailureMode;
    breachWidth?: number;
    formationTime?: number;
  };
  view?: { zoom: number; pitch: number; bearing: number };
  /** What was actually recorded, for scenarios that reconstruct a failure that happened. */
  observations?: ScenarioObservations;
  notes?: string;
  custom?: boolean;
  createdAt?: string;
}

export interface ScenarioMeta {
  id: string;
  name: string;
  river: string;
  event: EventKind;
  custom?: boolean;
}

export interface ScenarioData {
  grid: GridGeometry;
  dem: Float32Array;
  assets: AssetCollection;
  roads: RoadCollection;
  demRange: [number, number];
}

const EMPTY_ASSETS: AssetCollection = { type: 'FeatureCollection', features: [] };
const EMPTY_ROADS: RoadCollection = { type: 'FeatureCollection', features: [] };

export function eventDefaults(s: ScenarioConfig): EventParams {
  const p = defaultEventParams(
    s.event,
    { height: s.dam.height, volumeM3: s.dam.volumeMCM * 1e6, waterDepth: s.dam.waterDepth },
    s.defaults.failureMode ?? 'overtopping',
  );
  if (s.defaults.breachWidth) p.breachWidth = s.defaults.breachWidth;
  if (s.defaults.formationTime) p.formationTime = s.defaults.formationTime;
  return p;
}

function demRange(dem: Float32Array): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < dem.length; i++) {
    const v = dem[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return [min, max];
}

export function makeScenarioData(config: ScenarioConfig, dem: Float32Array, assets?: AssetCollection, roads?: RoadCollection): ScenarioData {
  const grid = gridGeometry({ cols: config.grid.cols, rows: config.grid.rows, bbox: config.bbox });
  if (dem.length !== grid.cols * grid.rows) {
    throw new Error(`Elevation grid has ${dem.length.toLocaleString()} cells; expected ${(grid.cols * grid.rows).toLocaleString()}.`);
  }
  return { grid, dem, assets: assets ?? EMPTY_ASSETS, roads: roads ?? EMPTY_ROADS, demRange: demRange(dem) };
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export async function fetchBundledIndex(): Promise<ScenarioMeta[]> {
  return fetchJson<ScenarioMeta[]>('/scenarios/index.json');
}

export async function loadBundledScenario(id: string): Promise<{ config: ScenarioConfig; data: ScenarioData }> {
  const config = await fetchJson<ScenarioConfig>(`/scenarios/${id}.json`);
  const demUrl = config.dem.url ?? `/data/${id}/elevation.bin`;
  const [demBuf, assets, roads] = await Promise.all([
    fetch(demUrl).then((r) => {
      if (!r.ok) throw new Error(`Elevation data missing for ${config.name} (${demUrl}).`);
      return r.arrayBuffer();
    }),
    config.exposure.assetsUrl ? fetchJson<AssetCollection>(config.exposure.assetsUrl).catch(() => EMPTY_ASSETS) : EMPTY_ASSETS,
    config.exposure.roadsUrl ? fetchJson<RoadCollection>(config.exposure.roadsUrl).catch(() => EMPTY_ROADS) : EMPTY_ROADS,
  ]);
  return { config, data: makeScenarioData(config, new Float32Array(demBuf), assets, roads) };
}

// ---- Custom scenarios (IndexedDB) ------------------------------------------------------------

interface StoredScenario {
  id: string;
  config: ScenarioConfig;
  dem: Float32Array;
  assets: AssetCollection;
  roads: RoadCollection;
}

const DB_NAME = 'cascade';
const STORE = 'scenarios';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export async function listCustomScenarios(): Promise<ScenarioMeta[]> {
  if (typeof indexedDB === 'undefined') return [];
  try {
    const all = await withStore<StoredScenario[]>('readonly', (s) => s.getAll() as IDBRequest<StoredScenario[]>);
    return all
      .map((r) => ({ id: r.id, name: r.config.name, river: r.config.river, event: r.config.event, custom: true }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export async function saveCustomScenario(config: ScenarioConfig, data: ScenarioData): Promise<void> {
  const record: StoredScenario = { id: config.id, config: { ...config, custom: true }, dem: data.dem, assets: data.assets, roads: data.roads };
  await withStore('readwrite', (s) => s.put(record));
}

export async function loadCustomScenario(id: string): Promise<{ config: ScenarioConfig; data: ScenarioData }> {
  const record = await withStore<StoredScenario | undefined>('readonly', (s) => s.get(id) as IDBRequest<StoredScenario | undefined>);
  if (!record) throw new Error('Saved scenario not found on this device.');
  return { config: record.config, data: makeScenarioData(record.config, record.dem, record.assets, record.roads) };
}

export async function deleteCustomScenario(id: string): Promise<void> {
  await withStore('readwrite', (s) => s.delete(id));
}

/** Portable single-file package (JSON; the DEM as base64 Float32) for sharing custom scenarios. */
export function packageScenario(config: ScenarioConfig, data: ScenarioData): string {
  const bytes = new Uint8Array(data.dem.buffer, data.dem.byteOffset, data.dem.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return JSON.stringify({ format: 'cascade-scenario', version: 1, config, dem: btoa(binary), assets: data.assets, roads: data.roads });
}

export function unpackageScenario(text: string): { config: ScenarioConfig; data: ScenarioData } {
  const pkg = JSON.parse(text);
  if (pkg.format !== 'cascade-scenario') throw new Error('Not a Cascade scenario file.');
  const binary = atob(pkg.dem);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const config: ScenarioConfig = { ...pkg.config, custom: true };
  return { config, data: makeScenarioData(config, new Float32Array(bytes.buffer), pkg.assets, pkg.roads) };
}
