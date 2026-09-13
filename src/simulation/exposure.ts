// Sampling of exposure assets and road cells during simulation runs (worker or main thread).

export const FLOOD_THRESHOLD = 0.1;

export interface ExposureAsset {
  footprint: Int32Array;
}

export interface ExposureIndex {
  assets: ExposureAsset[];
  roadCells: Int32Array;
  roads?: unknown[];
  roadCellRoad?: Int32Array;
  roadCellLength?: Float32Array;
  cellToRoads?: Map<number, string[]>;
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
