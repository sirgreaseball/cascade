// GIS deliverables from a run: flood depth bands, arrival-time isochrones and hazard classes as
// polygons, flooded places and cut roads, as KML (Google Earth) and ESRI Shapefile (QGIS /
// ArcGIS), plus GeoJSON, ESRI ASCII rasters and a CSV evacuation table.

import type { GridGeometry } from '../geo/grid';
import { polygonizeBands } from './polygonize';
import type { ClassBand, PolygonFeature, Ring } from './polygonize';
import { buildKml, toAsciiGrid, toCsv, writeShapefile, zipFiles, PRJ_WGS84 } from './formats';
import type { DbfField, KmlFolder, KmlPlacemark, KmlStyle, ShapeGeometry } from './formats';
import { hazardClass, HAZARD_CLASSES } from '../damage';
import type { AssetStatus, ExposureIndex, ImpactSummary } from '../analytics';
import { ARRIVAL_BANDS, HAZARD_COLORS } from '@/components/map/colormaps';

export interface ExportContext {
  scenarioId: string;
  scenarioName: string;
  engineLabel: string;
  grid: GridGeometry;
  maxDepth: Float32Array;
  arrival: Float32Array;
  maxSpeed: Float32Array;
  maxDepthVelocity: Float32Array;
  simulatedSeconds: number;
  exposure: ExposureIndex;
  statuses: AssetStatus[];
  impact: ImpactSummary;
  dam: { name: string; axis: [[number, number], [number, number]] };
  eventSummary: string;
}

export const DEPTH_BANDS: ClassBand[] = [
  { min: 0.1, max: 0.5, label: '0.1–0.5 m', color: '#b7d3f6' },
  { min: 0.5, max: 1.5, label: '0.5–1.5 m', color: '#86b6ef' },
  { min: 1.5, max: 3, label: '1.5–3 m', color: '#5598e7' },
  { min: 3, max: 6, label: '3–6 m', color: '#2a78d6' },
  { min: 6, max: 15, label: '6–15 m', color: '#1c5cab' },
  { min: 15, max: Infinity, label: '> 15 m', color: '#0d366b' },
];

const ARRIVAL_EXPORT_BANDS: ClassBand[] = ARRIVAL_BANDS.map((b, i) => ({
  min: i === 0 ? 0 : ARRIVAL_BANDS[i - 1].max,
  max: b.max,
  label: b.label,
  color: b.color,
}));

const HAZARD_BANDS: ClassBand[] = HAZARD_CLASSES.map((h, i) => ({ min: h.id, max: h.id + 1, label: h.label, color: HAZARD_COLORS[i] }));

export interface ExportLayers {
  depth: PolygonFeature[];
  arrival: PolygonFeature[];
  hazard: PolygonFeature[];
  hazardRaster: Float32Array;
  places: { index: number; status: AssetStatus }[];
  roads: number[];
}

export function buildLayers(ctx: ExportContext): ExportLayers {
  const { grid, maxDepth, arrival, maxSpeed, maxDepthVelocity } = ctx;
  const n = maxDepth.length;
  const arrivalValues = new Float32Array(n);
  const hazardRaster = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    arrivalValues[k] = arrival[k] >= 0 ? arrival[k] : NaN;
    hazardRaster[k] = hazardClass(maxDepth[k], maxSpeed[k], maxDepthVelocity[k]) || NaN;
  }
  const places = ctx.statuses
    .map((status, index) => ({ index, status }))
    .filter((p) => p.status.maxDepth >= 0.1)
    .sort((a, b) => a.status.arrival - b.status.arrival);
  const roads: number[] = [];
  ctx.impact.roadCut.forEach((cut, i) => cut && roads.push(i));
  return {
    depth: polygonizeBands(maxDepth, grid, DEPTH_BANDS, 'max_depth'),
    arrival: polygonizeBands(arrivalValues, grid, ARRIVAL_EXPORT_BANDS, 'arrival'),
    hazard: polygonizeBands(hazardRaster, grid, HAZARD_BANDS, 'hazard'),
    hazardRaster,
    places,
    roads,
  };
}

const minutes = (s: number) => (s >= 0 ? Math.round(s / 6) / 10 : -1);
const round2 = (v: number) => Math.round(v * 100) / 100;

function placeRow(ctx: ExportContext, index: number, s: AssetStatus) {
  const a = ctx.exposure.assets[index];
  return {
    name: a.name,
    kind: a.kind,
    subtype: a.subtype,
    pop: a.population,
    pop_est: a.populationEstimated ? 'yes' : 'no',
    arr_min: minutes(s.arrival),
    depth_m: round2(s.maxDepth),
    speed_ms: round2(s.maxSpeed),
    hazard: s.hazard ? `H${s.hazard}` : '',
    exposed: s.peopleExposed,
    loss_inr: Math.round(s.loss),
    dist_km: round2(a.distanceKm),
  };
}

export function exportKml(ctx: ExportContext, layers = buildLayers(ctx)): string {
  const styles: KmlStyle[] = [];
  const folders: KmlFolder[] = [];
  const polyFolder = (name: string, feats: PolygonFeature[], prefix: string, visible: boolean) => {
    feats.forEach((f, i) => styles.push({ id: `${prefix}${i}`, color: String(f.properties.color), fillOpacity: 0.55, lineWidth: 0.6 }));
    folders.push({
      name,
      visible,
      placemarks: feats.map((f, i) => ({
        name: String(f.properties.class),
        style: `${prefix}${i}`,
        data: { area_km2: f.properties.area_km2 },
        geometry: f.geometry,
      })),
    });
  };
  polyFolder('Maximum flood depth', layers.depth, 'd', true);
  polyFolder('Flood arrival time', layers.arrival, 'a', false);
  polyFolder('Hazard to people (AIDR H1–H6)', layers.hazard, 'h', false);

  styles.push({ id: 'place', color: '#c2261d', icon: true }, { id: 'road', color: '#c2261d', lineWidth: 3 }, { id: 'dam', color: '#1d1d1f', lineWidth: 5 });
  folders.push({
    name: 'Places reached by the flood',
    placemarks: layers.places.map(({ index, status }): KmlPlacemark => {
      const a = ctx.exposure.assets[index];
      const row = placeRow(ctx, index, status);
      return {
        name: a.name,
        style: 'place',
        description: `${a.subtype}; arrival ${row.arr_min} min; max depth ${row.depth_m} m; ${row.hazard}`,
        data: row,
        geometry: { type: 'Point', coordinates: [a.lng, a.lat] },
      };
    }),
  });
  folders.push({
    name: 'Roads cut (≥ 0.3 m)',
    placemarks: layers.roads.map((i) => {
      const r = ctx.exposure.roads[i];
      return {
        name: r.name || r.highway,
        style: 'road',
        data: { highway: r.highway, bridge: r.bridge ? 'yes' : 'no', length_m: Math.round(r.lengthM) },
        geometry: { type: 'LineString', coordinates: r.path as Ring },
      };
    }),
  });
  folders.push({
    name: 'Dam',
    placemarks: [{ name: ctx.dam.name, style: 'dam', geometry: { type: 'LineString', coordinates: ctx.dam.axis as Ring } }],
  });
  return buildKml({
    name: `Cascade · ${ctx.scenarioName}`,
    description: `${ctx.eventSummary}. Engine: ${ctx.engineLabel}. Simulated ${Math.round(ctx.simulatedSeconds / 60)} min. Generated by Cascade.`,
    styles,
    folders,
  });
}

const POLY_FIELDS: DbfField[] = [
  { name: 'layer', type: 'C', length: 16 },
  { name: 'class', type: 'C', length: 24 },
  { name: 'min', type: 'N', length: 12, decimals: 2 },
  { name: 'max', type: 'N', length: 12, decimals: 2 },
  { name: 'area_km2', type: 'N', length: 14, decimals: 3 },
];

const PLACE_FIELDS: DbfField[] = [
  { name: 'name', type: 'C', length: 80 },
  { name: 'kind', type: 'C', length: 12 },
  { name: 'subtype', type: 'C', length: 16 },
  { name: 'pop', type: 'N', length: 10 },
  { name: 'pop_est', type: 'C', length: 3 },
  { name: 'arr_min', type: 'N', length: 10, decimals: 1 },
  { name: 'depth_m', type: 'N', length: 10, decimals: 2 },
  { name: 'speed_ms', type: 'N', length: 10, decimals: 2 },
  { name: 'hazard', type: 'C', length: 4 },
  { name: 'exposed', type: 'N', length: 10 },
  { name: 'loss_inr', type: 'N', length: 16 },
  { name: 'dist_km', type: 'N', length: 10, decimals: 2 },
];

const ROAD_FIELDS: DbfField[] = [
  { name: 'name', type: 'C', length: 80 },
  { name: 'highway', type: 'C', length: 16 },
  { name: 'bridge', type: 'C', length: 3 },
  { name: 'length_m', type: 'N', length: 12, decimals: 1 },
];

export function exportShapefileZip(ctx: ExportContext, layers = buildLayers(ctx)): Uint8Array {
  const files: { name: string; data: Uint8Array | string }[] = [];
  const add = (base: string, kind: 'point' | 'polyline' | 'polygon', geoms: ShapeGeometry[], rows: Record<string, string | number>[], fields: DbfField[]) => {
    if (geoms.length === 0) return;
    const { shp, shx, dbf } = writeShapefile(kind, geoms, rows, fields);
    files.push({ name: `${base}.shp`, data: shp }, { name: `${base}.shx`, data: shx }, { name: `${base}.dbf`, data: dbf }, { name: `${base}.prj`, data: PRJ_WGS84 }, { name: `${base}.cpg`, data: 'UTF-8' });
  };
  const polyRows = (fs: PolygonFeature[]) => fs.map((f) => ({ layer: f.properties.layer, class: f.properties.class, min: f.properties.min, max: f.properties.max, area_km2: f.properties.area_km2 }));
  add('flood_max_depth', 'polygon', layers.depth.map((f) => f.geometry.coordinates), polyRows(layers.depth), POLY_FIELDS);
  add('flood_arrival_time', 'polygon', layers.arrival.map((f) => f.geometry.coordinates), polyRows(layers.arrival), POLY_FIELDS);
  add('flood_hazard', 'polygon', layers.hazard.map((f) => f.geometry.coordinates), polyRows(layers.hazard), POLY_FIELDS);
  add(
    'places_at_risk',
    'point',
    layers.places.map(({ index }) => [ctx.exposure.assets[index].lng, ctx.exposure.assets[index].lat] as [number, number]),
    layers.places.map(({ index, status }) => placeRow(ctx, index, status)),
    PLACE_FIELDS,
  );
  add(
    'roads_cut',
    'polyline',
    layers.roads.map((i) => [ctx.exposure.roads[i].path as Ring]),
    layers.roads.map((i) => {
      const r = ctx.exposure.roads[i];
      return { name: r.name, highway: r.highway, bridge: r.bridge ? 'yes' : 'no', length_m: Math.round(r.lengthM * 10) / 10 };
    }),
    ROAD_FIELDS,
  );
  files.push({ name: 'README.txt', data: readme(ctx) });
  return zipFiles(files);
}

export function exportGeoJson(ctx: ExportContext, layers = buildLayers(ctx)): string {
  const features: unknown[] = [...layers.depth, ...layers.arrival, ...layers.hazard];
  for (const { index, status } of layers.places) {
    const a = ctx.exposure.assets[index];
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [a.lng, a.lat] }, properties: { layer: 'place', ...placeRow(ctx, index, status) } });
  }
  for (const i of layers.roads) {
    const r = ctx.exposure.roads[i];
    features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: r.path }, properties: { layer: 'road_cut', name: r.name, highway: r.highway, bridge: r.bridge } });
  }
  return JSON.stringify({ type: 'FeatureCollection', name: `cascade_${ctx.scenarioId}`, features });
}

export function exportRasterZip(ctx: ExportContext, layers = buildLayers(ctx)): Uint8Array {
  const { grid } = ctx;
  const arrivalMin = new Float32Array(ctx.arrival.length);
  for (let k = 0; k < arrivalMin.length; k++) arrivalMin[k] = ctx.arrival[k] >= 0 ? ctx.arrival[k] / 60 : NaN;
  const depth = Float32Array.from(ctx.maxDepth, (v) => (v >= 0.1 ? v : NaN));
  const speed = Float32Array.from(ctx.maxSpeed, (v, k) => (ctx.maxDepth[k] >= 0.1 ? v : NaN));
  const files = [
    { name: 'max_depth_m.asc', data: toAsciiGrid(depth, grid, 2) },
    { name: 'arrival_time_min.asc', data: toAsciiGrid(arrivalMin, grid, 1) },
    { name: 'max_velocity_ms.asc', data: toAsciiGrid(speed, grid, 2) },
    { name: 'hazard_class.asc', data: toAsciiGrid(layers.hazardRaster, grid, 0) },
  ];
  const withPrj = files.flatMap((f) => [f, { name: f.name.replace('.asc', '.prj'), data: PRJ_WGS84 }]);
  return zipFiles([...withPrj, { name: 'README.txt', data: readme(ctx) }]);
}

export function exportPlacesCsv(ctx: ExportContext, layers = buildLayers(ctx)): string {
  const header = ['name', 'kind', 'subtype', 'population', 'population_estimated', 'arrival_min', 'max_depth_m', 'max_velocity_ms', 'hazard', 'people_exposed', 'loss_inr', 'distance_from_dam_km', 'lng', 'lat'];
  const rows = layers.places.map(({ index, status }) => {
    const r = placeRow(ctx, index, status);
    const a = ctx.exposure.assets[index];
    return [r.name, r.kind, r.subtype, r.pop, r.pop_est, r.arr_min, r.depth_m, r.speed_ms, r.hazard, r.exposed, r.loss_inr, r.dist_km, a.lng, a.lat];
  });
  return toCsv(header, rows);
}

function readme(ctx: ExportContext): string {
  return `Cascade flood simulation export
Scenario: ${ctx.scenarioName}
Event: ${ctx.eventSummary}
Engine: ${ctx.engineLabel}
Simulated duration: ${Math.round(ctx.simulatedSeconds / 60)} min
Coordinate system: WGS 84 (EPSG:4326)
Grid: ${ctx.grid.cols} x ${ctx.grid.rows} cells, ~${Math.round(ctx.grid.dx)} x ${Math.round(ctx.grid.dy)} m

Layers
- flood_max_depth: maximum depth reached, banded
- flood_arrival_time: time after breach when depth first exceeded 0.1 m
- flood_hazard: AIDR (2017) combined depth-velocity hazard classes H1 (safe) to H6 (all buildings vulnerable)
- places_at_risk: settlements, health, education and emergency facilities and bridges reached by the flood
- roads_cut: major roads under at least 0.3 m of water
Rasters (.asc) use GDAL's DX/DY header keys because lon/lat cells are not square.

Exposure data (c) OpenStreetMap contributors. Terrain: AWS Terrain Tiles (SRTM).
Losses are indicative (JRC depth-damage curve for Asia, indicative replacement values).
`;
}
