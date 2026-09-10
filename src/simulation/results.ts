// Frame storage for completed and in-progress runs. Kept outside React/Zustand: the arrays are
// large and immutable once received, and components read them through the small version
// counters in the simulation store.

import type { EngineId, FrameMessage, FrameStats, SummaryMessage } from './types';
import { sampleExposure } from '@/lib/analytics';
import type { ExposureIndex, FrameExposure } from '@/lib/analytics';

export interface EngineResult {
  times: number[];
  depth: Uint16Array[];
  stats: FrameStats[];
  particles: (FrameMessage['particles'] | undefined)[];
  exposure: FrameExposure[];
  summary: SummaryMessage | null;
}

/** An imported result from an external model (Delft3D, HEC-RAS, …): a max-depth envelope. */
export interface ExternalResult {
  name: string;
  source: string;
  maxDepth: Float32Array;
}

function emptyResult(): EngineResult {
  return { times: [], depth: [], stats: [], particles: [], exposure: [], summary: null };
}

class ResultsStore {
  private data: Partial<Record<EngineId, EngineResult>> = {};
  external: ExternalResult | null = null;
  exposureIndex: ExposureIndex | null = null;

  clear(): void {
    this.data = {};
  }

  get(engine: EngineId): EngineResult | undefined {
    return this.data[engine];
  }

  addFrame(msg: FrameMessage): number {
    const r = (this.data[msg.engine] ??= emptyResult());
    // Frames arrive in order; guard against a late message from a cancelled run.
    if (msg.index !== r.times.length) return r.times.length;
    r.times.push(msg.t);
    r.depth.push(msg.depth);
    r.stats.push(msg.stats);
    r.particles.push(msg.particles);
    if (this.exposureIndex) {
      const prev = r.exposure.length ? r.exposure[r.exposure.length - 1] : null;
      r.exposure.push(sampleExposure(this.exposureIndex, msg.depth, prev));
    }
    return r.times.length;
  }

  setSummary(msg: SummaryMessage): void {
    const r = (this.data[msg.engine] ??= emptyResult());
    r.summary = msg;
  }

  /** Index of the last frame at or before t, plus the interpolation weight to the next frame. */
  locate(engine: EngineId, t: number): { i0: number; i1: number; f: number } | null {
    const r = this.data[engine];
    if (!r || r.times.length === 0) return null;
    const times = r.times;
    if (t <= times[0]) return { i0: 0, i1: 0, f: 0 };
    const last = times.length - 1;
    if (t >= times[last]) return { i0: last, i1: last, f: 0 };
    let lo = 0;
    let hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (times[mid] <= t) lo = mid;
      else hi = mid;
    }
    return { i0: lo, i1: hi, f: (t - times[lo]) / (times[hi] - times[lo]) };
  }

  /** Latest simulated time available for an engine. */
  latestTime(engine: EngineId): number {
    const r = this.data[engine];
    return r && r.times.length ? r.times[r.times.length - 1] : 0;
  }
}

export const results = new ResultsStore();
