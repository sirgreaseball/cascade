// One place that turns (scenario grid + DEM + dam + event parameters) into solver configs.
// The dashboard and the headless verification script both call this, so what is verified is
// exactly what runs in the browser.

import { gridGeometry } from '../lib/geo/grid.ts';
import type { BBox, GridGeometry } from '../lib/geo/grid.ts';
import { computeHydrograph } from './hydrograph.ts';
import type { EventParams, Hydrograph } from './hydrograph.ts';
import { prepareDamSite } from './damSite.ts';
import type { DamSite } from './damSite.ts';
import type { EngineConfig, EngineId } from './types.ts';

export type Resolution = 'fast' | 'standard' | 'high';

export const PARTICLE_BUDGET: Record<Resolution, number> = {
  fast: 3_000,
  standard: 6_000,
  high: 12_000,
};

export interface SetupInput {
  cols: number;
  rows: number;
  bbox: BBox;
  dem: Float32Array;
  dam: {
    lng: number;
    lat: number;
    height: number;
    crestLength: number;
    snapRadius?: number;
    axis?: [[number, number], [number, number]];
  };
  event: EventParams;
  manning: number;
  duration: number;
  resolution: Resolution;
  /** Target number of frames over the run (sets the output interval). */
  frames?: number;
  wetThreshold?: number;
}

export interface SimulationSetup {
  grid: GridGeometry;
  site: DamSite;
  hydrograph: Hydrograph;
  outputInterval: number;
  configs: Record<EngineId, EngineConfig>;
}

export function outputIntervalFor(duration: number, frames = 120): number {
  const raw = duration / frames;
  return Math.max(30, Math.round(raw / 30) * 30);
}

export function setupSimulation(input: SetupInput): SimulationSetup {
  const grid = gridGeometry({ cols: input.cols, rows: input.rows, bbox: input.bbox });
  const site = prepareDamSite(grid, input.dem, {
    lng: input.dam.lng,
    lat: input.dam.lat,
    height: input.dam.height,
    crestLength: input.dam.crestLength,
    breachWidth: input.event.breachWidth,
    snapRadius: input.dam.snapRadius,
    axis: input.dam.axis,
  });
  const hydrograph = computeHydrograph(input.event, input.duration);
  const outputInterval = outputIntervalFor(input.duration, input.frames);
  const base = {
    cols: grid.cols,
    rows: grid.rows,
    bbox: grid.bbox,
    dx: grid.dx,
    dy: grid.dy,
    elevation: site.elevation,
    sources: site.sources,
    sourceDirection: site.direction,
    hydrograph: { t: hydrograph.t, q: hydrograph.q },
    breach:
      input.event.kind === 'controlled-release'
        ? undefined
        : {
            event: input.event,
            datumElevation: site.bed.elevation + Math.max(input.event.damHeight - input.event.breachDepth, 0),
          },
    manning: input.manning,
    duration: input.duration,
    outputInterval,
    wetThreshold: input.wetThreshold ?? 0.1,
  };
  return {
    grid,
    site,
    hydrograph,
    outputInterval,
    configs: {
      swe: { ...base, engine: 'swe' },
      sph: { ...base, engine: 'sph', sph: { targetParticles: PARTICLE_BUDGET[input.resolution] } },
    },
  };
}
