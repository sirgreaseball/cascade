// One place that turns (scenario grid + DEM + dam + event parameters) into solver configs.
// The dashboard and the headless verification script both call this, so what is verified is
// exactly what runs in the browser.

import { gridGeometry } from '../lib/geo/grid.ts';
import type { BBox, GridGeometry } from '../lib/geo/grid.ts';
import { computeHydrograph } from './hydrograph.ts';
import type { EventParams, Hydrograph } from './hydrograph.ts';
import { prepareDamSite } from './damSite.ts';
import type { DamSite, DamSiteInput } from './damSite.ts';
import type { EngineConfig, EngineId } from './types.ts';

export type Resolution = 'fast' | 'standard' | 'high';

export const PARTICLE_BUDGET: Record<Resolution, number> = {
  fast: 3_000,
  standard: 6_000,
  high: 12_000,
};

/** The Fast setting runs the grid solver on cells this many times larger (≈ factor³ faster). */
export const FAST_GRID_FACTOR = 2;

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
    crestLine?: [number, number][] | null;
  };
  event: EventParams;
  manning: number;
  duration: number;
  resolution: Resolution;
  /** Target number of frames over the run (sets the output interval). */
  frames?: number;
  wetThreshold?: number;
  /** Run the grid solver on the GPU when WebGPU is available (default true). */
  gpu?: boolean;
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

/** Box-averages a DEM onto cells `f` times larger; edge blocks average the cells they cover. */
function coarsen(dem: Float32Array, cols: number, rows: number, f: number): { dem: Float32Array; cols: number; rows: number } {
  const cc = Math.ceil(cols / f);
  const rc = Math.ceil(rows / f);
  const out = new Float32Array(cc * rc);
  for (let r = 0; r < rc; r++) {
    for (let c = 0; c < cc; c++) {
      let sum = 0;
      let n = 0;
      for (let rr = r * f; rr < Math.min(rows, (r + 1) * f); rr++) {
        for (let k = c * f; k < Math.min(cols, (c + 1) * f); k++) {
          sum += dem[rr * cols + k];
          n++;
        }
      }
      out[r * cc + c] = sum / n;
    }
  }
  return { dem: out, cols: cc, rows: rc };
}

export function setupSimulation(input: SetupInput): SimulationSetup {
  const grid = gridGeometry({ cols: input.cols, rows: input.rows, bbox: input.bbox });
  const damInput: DamSiteInput = {
    lng: input.dam.lng,
    lat: input.dam.lat,
    height: input.dam.height,
    crestLength: input.dam.crestLength,
    breachWidth: input.event.breachWidth,
    snapRadius: input.dam.snapRadius,
    axis: input.dam.axis,
    crestLine: input.dam.crestLine,
  };
  const site = prepareDamSite(grid, input.dem, damInput);
  const hydrograph = computeHydrograph(input.event, input.duration);
  const outputInterval = outputIntervalFor(input.duration, input.frames);
  const invertAboveBed = Math.max(input.event.damHeight - input.event.breachDepth, 0);
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
    breach: input.event.kind === 'controlled-release' ? undefined : { event: input.event, datumElevation: site.bed.elevation + invertAboveBed },
    manning: input.manning,
    duration: input.duration,
    outputInterval,
    wetThreshold: input.wetThreshold ?? 0.1,
  };

  let swe: EngineConfig = { ...base, engine: 'swe' };
  if (input.resolution === 'fast') {
    // Cells twice the size: a quarter of the cells and twice the stable time step. The dam is
    // rebuilt on the coarse grid; results are repeated back onto the scenario grid for display.
    const f = FAST_GRID_FACTOR;
    const coarse = coarsen(input.dem, grid.cols, grid.rows, f);
    const cbbox: BBox = [grid.bbox[0], grid.bbox[3] - coarse.rows * f * grid.latStep, grid.bbox[0] + coarse.cols * f * grid.lngStep, grid.bbox[3]];
    const cgrid = gridGeometry({ cols: coarse.cols, rows: coarse.rows, bbox: cbbox });
    // The dam itself is grid-independent: reuse the scenario grid's downstream direction, bed and
    // crest rather than re-deriving them from the averaged DEM, which used to flip the downstream
    // test in narrow gorges and send the whole flood backwards into the reservoir.
    const csite = prepareDamSite(cgrid, coarse.dem, {
      ...damInput,
      reference: { direction: site.direction, bedElevation: site.bed.elevation, crestElevation: site.crestElevation },
    });
    swe = {
      ...base,
      engine: 'swe',
      cols: cgrid.cols,
      rows: cgrid.rows,
      bbox: cgrid.bbox,
      dx: cgrid.dx,
      dy: cgrid.dy,
      elevation: csite.elevation,
      sources: csite.sources,
      sourceDirection: csite.direction,
      // The breach invert is the real one, from the scenario grid.
      display: { cols: grid.cols, rows: grid.rows, factor: f },
    };
  }
  swe = { ...swe, gpu: input.gpu ?? true };

  return {
    grid,
    site,
    hydrograph,
    outputInterval,
    configs: {
      swe,
      sph: { ...base, engine: 'sph', sph: { targetParticles: PARTICLE_BUDGET[input.resolution] } },
    },
  };
}
