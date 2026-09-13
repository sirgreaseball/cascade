// Web Worker for calculating evacuation routes off the main thread.
// Uses structured cloning only (no transfer lists) to maintain project architecture invariants.

import { planEvacuationSync } from './evacuation.ts';
import type { EvacuationRoute, EvacuationOptions } from './evacuation.ts';
import type { GridGeometry } from './geo/grid.ts';
import type { ExposureIndex } from './analytics.ts';

export interface EvacuationWorkerRequest {
  id: number;
  exposure: ExposureIndex;
  grid: GridGeometry;
  summary: { arrival: Float32Array; maxDepth: Float32Array };
  options?: EvacuationOptions;
}

export interface EvacuationWorkerResponse {
  id: number;
  routes: EvacuationRoute[];
}

if (typeof self !== 'undefined' && typeof window === 'undefined') {
  self.onmessage = (e: MessageEvent<EvacuationWorkerRequest>) => {
    const { id, exposure, grid, summary, options } = e.data;
    try {
      const routes = planEvacuationSync(exposure, grid, summary, options);
      (self as unknown as Worker).postMessage({ id, routes } satisfies EvacuationWorkerResponse);
    } catch (err) {
      console.warn('[evacuationWorker] Error planning evacuation:', err);
      (self as unknown as Worker).postMessage({ id, routes: [] } satisfies EvacuationWorkerResponse);
    }
  };
}
