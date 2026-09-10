// Message and configuration types shared by the main thread, the flood worker and the
// main-thread fallback. Everything crosses the worker boundary by structured cloning —
// never with a transfer list — so the UI never holds a detached buffer.

import type { EventParams } from './hydrograph.ts';

export type EngineId = 'swe' | 'sph';

export interface SourceCell {
  index: number;
  weight: number;
}

export interface EngineConfig {
  engine: EngineId;
  cols: number;
  rows: number;
  bbox: [number, number, number, number];
  dx: number;
  dy: number;
  /** Bed elevation (m), north-up row-major, with the dam / blockage wall burned in. */
  elevation: Float32Array;
  /** Cells that receive the breach outflow, weights summing to 1. */
  sources: SourceCell[];
  /** Unit vector pointing downstream from the breach, in grid axes (x east, y south). */
  sourceDirection: [number, number];
  /** Free-outflow preview hydrograph; drives the inflow directly only for controlled releases. */
  hydrograph: { t: number[]; q: number[] };
  /** Dam break / outburst: route the reservoir inside the solver against the live tailwater. */
  breach?: {
    event: EventParams;
    /** Elevation (m a.s.l.) of the final breach invert. */
    datumElevation: number;
  };
  /** Manning roughness (s/m^1/3). */
  manning: number;
  /** Simulated duration (s). */
  duration: number;
  /** Simulated seconds between frames sent to the UI. */
  outputInterval: number;
  /** Depth (m) above which a cell counts as flooded. */
  wetThreshold: number;
  sph?: {
    /** Particle budget; particle volume is derived from it and the hydrograph volume. */
    targetParticles: number;
  };
}

export interface FrameStats {
  t: number;
  /** Inflow at the breach now (m³/s). */
  inflowRate: number;
  /** Cumulative inflow (m³). */
  inflowVolume: number;
  /** Cumulative volume that has left the model domain (m³). */
  outflowVolume: number;
  /** Water currently stored in the domain (m³). */
  storedVolume: number;
  /** Flooded area (depth ≥ wet threshold) now (m²). */
  wetArea: number;
  maxDepth: number;
  /** Wall-clock milliseconds spent computing since the previous frame. */
  computeMs: number;
  /** Solver steps taken since the previous frame. */
  steps: number;
  particles?: number;
}

export interface FrameMessage {
  type: 'frame';
  engine: EngineId;
  index: number;
  t: number;
  /** Depth in centimetres (Uint16: 1 cm resolution up to 655 m). */
  depth: Uint16Array;
  stats: FrameStats;
  /** SPH only: particle lng, lat, bed+depth elevation triples and speeds (m/s). */
  particles?: { position: Float32Array; speed: Float32Array };
}

export interface SummaryMessage {
  type: 'summary';
  engine: EngineId;
  t: number;
  final: boolean;
  maxDepth: Float32Array;
  /** Seconds until depth first exceeded the wet threshold; -1 if never. */
  arrival: Float32Array;
  maxSpeed: Float32Array;
  /** Peak depth × velocity (m²/s), the hazard-to-people metric. */
  maxDepthVelocity: Float32Array;
}

export type WorkerOutbound =
  | { type: 'ready'; engine: EngineId; info: EngineInfo }
  | { type: 'progress'; engine: EngineId; t: number; progress: number }
  | FrameMessage
  | SummaryMessage
  | { type: 'done'; engine: EngineId; t: number; wallMs: number }
  | { type: 'error'; engine: EngineId; message: string };

export type WorkerInbound =
  | { type: 'init'; config: EngineConfig }
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'stop' };

export interface EngineInfo {
  label: string;
  cells: number;
  /** SPH: volume carried by each particle (m³). */
  particleVolume?: number;
}
