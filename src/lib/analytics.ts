// Exposure analytics: which places, facilities, bridges and roads the flood reaches, when,
// how deep and how fast — the evacuation-priority view. Settlements are assessed over a
// footprint of cells sized by place type (a town is not a point), so "people exposed" is the
// population times the flooded share of the settlement's footprint.

import { haversine, lngLatToCell } from './geo/grid';
import type { GridGeometry } from './geo/grid';
import type { AssetCollection, AssetKind, RoadCollection } from './osm';
import { assetLoss, hazardClass, roadLoss } from './damage';
import { grahamFatalityRate } from './lifeLoss';
import type { SummaryMessage } from '@/simulation/types';

export const FLOOD_THRESHOLD = 0.1;
/** Depth at which a road is treated as cut. */
export const ROAD_CUT_DEPTH = 0.3;

const FOOTPRINT_RADIUS: Record<string, number> = { city: 1500, town: 700, suburb: 450, village: 250, hamlet: 120 };

export interface AssetRecord {
  id: string;
  name: string;
  kind: AssetKind;
  subtype: string;
  population: number;
  populationEstimated: boolean;
  lng: number;
  lat: number;
  cell: number;
  footprint: Int32Array;
  /** Straight-line distance from the dam (km). */
  distanceKm: number;
}

export interface RoadRecord {
  id: string;
  name: string;
  highway: string;
  bridge: boolean;
  lengthM: number;
  path: [number, number][];
}

export interface ExposureIndex {
  assets: AssetRecord[];
  roads: RoadRecord[];
  /** Grid cells crossed by roads, with the road index and road length inside the cell. */
  roadCells: Int32Array;
  roadCellRoad: Int32Array;
  roadCellLength: Float32Array;
}

export function buildExposureIndex(g: GridGeometry, assets: AssetCollection, roads: RoadCollection, dam: [number, number]): ExposureIndex {
  const records: AssetRecord[] = [];
  for (const f of assets.features) {
    const [lng, lat] = f.geometry.coordinates;
    const cell = lngLatToCell(g, lng, lat);
    if (!cell) continue;
    const p = f.properties;
    const radius = p.kind === 'settlement' ? FOOTPRINT_RADIUS[p.subtype] ?? 200 : 0;
    const cells: number[] = [];
    if (radius > 0) {
      const rc = Math.ceil(radius / g.dx);
      const rr = Math.ceil(radius / g.dy);
      for (let dr = -rr; dr <= rr; dr++) {
        for (let dc = -rc; dc <= rc; dc++) {
          const r = cell.row + dr;
          const c = cell.col + dc;
          if (r < 0 || c < 0 || r >= g.rows || c >= g.cols) continue;
          if ((dc * g.dx) ** 2 + (dr * g.dy) ** 2 > radius * radius) continue;
          cells.push(r * g.cols + c);
        }
      }
    }
    if (cells.length === 0) cells.push(cell.index);
    records.push({
      id: p.id,
      name: p.name,
      kind: p.kind,
      subtype: p.subtype,
      population: p.population,
      populationEstimated: p.populationEstimated,
      lng,
      lat,
      cell: cell.index,
      footprint: Int32Array.from(cells),
      distanceKm: haversine(dam, [lng, lat]) / 1000,
    });
  }

  const roadRecords: RoadRecord[] = [];
  const cellsOut: number[] = [];
  const roadOut: number[] = [];
  const lenOut: number[] = [];
  const stepM = Math.min(g.dx, g.dy) / 2;
  for (const f of roads.features) {
    const coords = f.geometry.coordinates;
    const ri = roadRecords.length;
    let total = 0;
    const perCell = new Map<number, number>();
    for (let i = 1; i < coords.length; i++) {
      const a = coords[i - 1];
      const b = coords[i];
      const seg = haversine(a, b);
      total += seg;
      const n = Math.max(1, Math.ceil(seg / stepM));
      for (let s = 0; s < n; s++) {
        const t = (s + 0.5) / n;
        const cell = lngLatToCell(g, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
        if (cell) perCell.set(cell.index, (perCell.get(cell.index) ?? 0) + seg / n);
      }
    }
    if (perCell.size === 0) continue;
    roadRecords.push({
      id: f.properties.id,
      name: f.properties.name,
      highway: f.properties.highway,
      bridge: f.properties.bridge,
      lengthM: total,
      path: coords,
    });
    for (const [cell, len] of perCell) {
      cellsOut.push(cell);
      roadOut.push(ri);
      lenOut.push(len);
    }
  }
  return {
    assets: records,
    roads: roadRecords,
    roadCells: Int32Array.from(cellsOut),
    roadCellRoad: Int32Array.from(roadOut),
    roadCellLength: Float32Array.from(lenOut),
  };
}

/** Exposure sampled from one frame, carrying running maxima ("so far") forward. */
export interface FrameExposure {
  /** Current mean depth over the flooded part of each asset footprint (m). */
  depth: Float32Array;
  /** Current flooded share of each footprint (0–1). */
  share: Float32Array;
  maxDepth: Float32Array;
  maxShare: Float32Array;
  /** Running maximum depth on each road cell (cm). */
  roadMaxCm: Uint16Array;
}

export function sampleExposure(index: ExposureIndex, depthCm: Uint16Array, prev: FrameExposure | null): FrameExposure {
  const n = index.assets.length;
  const depth = new Float32Array(n);
  const share = new Float32Array(n);
  const maxDepth = prev ? Float32Array.from(prev.maxDepth) : new Float32Array(n);
  const maxShare = prev ? Float32Array.from(prev.maxShare) : new Float32Array(n);
  const thresholdCm = FLOOD_THRESHOLD * 100;
  for (let i = 0; i < n; i++) {
    const fp = index.assets[i].footprint;
    let wet = 0;
    let sum = 0;
    for (let j = 0; j < fp.length; j++) {
      const d = depthCm[fp[j]];
      if (d >= thresholdCm) {
        wet++;
        sum += d;
      }
    }
    const s = wet / fp.length;
    const dm = wet > 0 ? sum / wet / 100 : 0;
    depth[i] = dm;
    share[i] = s;
    if (dm > maxDepth[i]) maxDepth[i] = dm;
    if (s > maxShare[i]) maxShare[i] = s;
  }
  const roadMaxCm = prev ? Uint16Array.from(prev.roadMaxCm) : new Uint16Array(index.roadCells.length);
  for (let k = 0; k < index.roadCells.length; k++) {
    const d = depthCm[index.roadCells[k]];
    if (d > roadMaxCm[k]) roadMaxCm[k] = d;
  }
  return { depth, share, maxDepth, maxShare, roadMaxCm };
}

export interface AssetStatus {
  /** Seconds after the breach when the footprint first floods; -1 if not (yet). */
  arrival: number;
  maxDepth: number;
  depthNow: number;
  share: number;
  maxSpeed: number;
  maxDepthVelocity: number;
  hazard: number;
  loss: number;
  peopleExposed: number;
  /** Expected fatalities among the people exposed, with Graham's (1999) low–high range. */
  lifeLoss: number;
  lifeLossLow: number;
  lifeLossHigh: number;
}

export function assessAssets(
  index: ExposureIndex,
  frames: FrameExposure[],
  times: number[],
  upTo: number,
  summary: SummaryMessage | null,
): AssetStatus[] {
  const tNow = times[upTo] ?? 0;
  const cur = frames[upTo];
  const out: AssetStatus[] = [];
  for (let i = 0; i < index.assets.length; i++) {
    const a = index.assets[i];
    let arrival = -1;
    let maxSpeed = 0;
    let maxDV = 0;
    if (summary) {
      for (let j = 0; j < a.footprint.length; j++) {
        const k = a.footprint[j];
        const t = summary.arrival[k];
        if (t >= 0 && t <= tNow && (arrival < 0 || t < arrival)) arrival = t;
        if (t >= 0 && t <= tNow) {
          if (summary.maxSpeed[k] > maxSpeed) maxSpeed = summary.maxSpeed[k];
          if (summary.maxDepthVelocity[k] > maxDV) maxDV = summary.maxDepthVelocity[k];
        }
      }
    }
    const maxDepth = cur ? cur.maxDepth[i] : 0;
    const share = cur ? cur.maxShare[i] : 0;
    if (arrival < 0 && maxDepth > 0) {
      for (let f = 0; f <= upTo; f++) {
        if (frames[f].share[i] > 0) {
          arrival = times[f];
          break;
        }
      }
    }
    const hazard = maxDepth > 0 ? Math.max(1, hazardClass(maxDepth, maxSpeed, maxDV)) : 0;
    const people = a.kind === 'settlement' ? Math.round(a.population * share) : 0;
    const fatality = people > 0 ? grahamFatalityRate(maxDV, arrival, arrival) : null;
    out.push({
      arrival,
      maxDepth,
      depthNow: cur ? cur.depth[i] : 0,
      share,
      maxSpeed,
      maxDepthVelocity: maxDV,
      hazard,
      loss: assetLoss(a.kind, a.population, maxDepth, share, maxDV),
      peopleExposed: people,
      lifeLoss: fatality ? people * fatality.rate : 0,
      lifeLossLow: fatality ? people * fatality.low : 0,
      lifeLossHigh: fatality ? people * fatality.high : 0,
    });
  }
  return out;
}

/**
 * Loss of life over the flooded settlements for a given warning: issued `warningLead` seconds
 * before the breach (0: as it begins), or none at all when negative. The Impact panel uses it
 * to show what an earlier warning would change.
 */
export function lossOfLife(index: ExposureIndex, statuses: AssetStatus[], warningLead: number): { low: number; central: number; high: number } {
  let low = 0;
  let central = 0;
  let high = 0;
  statuses.forEach((s, i) => {
    if (index.assets[i].kind !== 'settlement' || s.maxDepth < FLOOD_THRESHOLD || s.peopleExposed <= 0) return;
    const arrival = Math.max(0, s.arrival);
    const r = grahamFatalityRate(s.maxDepthVelocity, warningLead < 0 ? 0 : arrival + warningLead, arrival);
    low += s.peopleExposed * r.low;
    central += s.peopleExposed * r.rate;
    high += s.peopleExposed * r.high;
  });
  return { low, central, high };
}

export interface ImpactSummary {
  peopleExposed: number;
  /** Graham (1999) loss-of-life estimate and range, warning issued as the breach begins. */
  lossOfLife: number;
  lossOfLifeLow: number;
  lossOfLifeHigh: number;
  settlementsFlooded: number;
  facilitiesFlooded: number;
  bridgesFlooded: number;
  roadKmCut: number;
  loss: number;
  firstArrival: number | null;
  firstArrivalPlace: string | null;
  /** Per-road: true when any part is under ≥ ROAD_CUT_DEPTH so far. */
  roadCut: Uint8Array;
}

export function summarizeImpacts(index: ExposureIndex, statuses: AssetStatus[], frame: FrameExposure | undefined): ImpactSummary {
  let people = 0;
  let lol = 0;
  let lolLow = 0;
  let lolHigh = 0;
  let settlements = 0;
  let facilities = 0;
  let bridges = 0;
  let loss = 0;
  let first: number | null = null;
  let firstPlace: string | null = null;
  statuses.forEach((s, i) => {
    const a = index.assets[i];
    if (s.maxDepth < FLOOD_THRESHOLD) return;
    loss += s.loss;
    if (a.kind === 'settlement') {
      settlements++;
      people += s.peopleExposed;
      lol += s.lifeLoss;
      lolLow += s.lifeLossLow;
      lolHigh += s.lifeLossHigh;
      if (s.arrival >= 0 && (first === null || s.arrival < first)) {
        first = s.arrival;
        firstPlace = a.name;
      }
    } else if (a.kind === 'bridge') bridges++;
    else facilities++;
  });
  const roadCut = new Uint8Array(index.roads.length);
  let roadM = 0;
  if (frame) {
    const cut = ROAD_CUT_DEPTH * 100;
    const roadDepthMax = new Float32Array(index.roads.length);
    for (let k = 0; k < index.roadCells.length; k++) {
      const d = frame.roadMaxCm[k];
      if (d >= cut) {
        const r = index.roadCellRoad[k];
        roadCut[r] = 1;
        roadM += index.roadCellLength[k];
        loss += roadLoss(index.roads[r].highway, index.roadCellLength[k], d / 100);
        if (d / 100 > roadDepthMax[r]) roadDepthMax[r] = d / 100;
      }
    }
  }
  return {
    peopleExposed: people,
    lossOfLife: lol,
    lossOfLifeLow: lolLow,
    lossOfLifeHigh: lolHigh,
    settlementsFlooded: settlements,
    facilitiesFlooded: facilities,
    bridgesFlooded: bridges,
    roadKmCut: roadM / 1000,
    loss,
    firstArrival: first,
    firstArrivalPlace: firstPlace,
    roadCut,
  };
}
