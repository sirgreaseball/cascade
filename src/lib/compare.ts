// Agreement metrics between two flood maps on the same grid (model vs model, or model vs
// satellite observation). CSI = hits / (hits + misses + false alarms) is the standard
// flood-extent skill score (Bates & De Roo 2000; used by the Global Flood Awareness System).

export interface ExtentAgreement {
  /** Cells flooded in the reference map (A). */
  a: number;
  /** Cells flooded in the compared map (B). */
  b: number;
  hits: number;
  misses: number;
  falseAlarms: number;
  /** Critical success index, 0–1. */
  csi: number;
  /** Share of A that B also floods. */
  hitRate: number;
  /** Share of B that A does not flood. */
  falseAlarmRatio: number;
  /** B / A extent ratio. */
  bias: number;
}

export function extentAgreement(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  thresholdA = 0.1,
  thresholdB = thresholdA,
): ExtentAgreement {
  let hits = 0;
  let misses = 0;
  let falseAlarms = 0;
  for (let k = 0; k < a.length; k++) {
    const fa = a[k] >= thresholdA;
    const fb = b[k] >= thresholdB;
    if (fa && fb) hits++;
    else if (fa) misses++;
    else if (fb) falseAlarms++;
  }
  const nA = hits + misses;
  const nB = hits + falseAlarms;
  return {
    a: nA,
    b: nB,
    hits,
    misses,
    falseAlarms,
    csi: hits + misses + falseAlarms > 0 ? hits / (hits + misses + falseAlarms) : 0,
    hitRate: nA > 0 ? hits / nA : 0,
    falseAlarmRatio: nB > 0 ? falseAlarms / nB : 0,
    bias: nA > 0 ? nB / nA : 0,
  };
}

export interface DepthDifference {
  /** Cells flooded in either map. */
  n: number;
  meanSigned: number;
  meanAbsolute: number;
  rmse: number;
}

/** Depth differences (b − a) over cells flooded in either map. */
export function depthDifference(a: ArrayLike<number>, b: ArrayLike<number>, threshold = 0.1): DepthDifference {
  let n = 0;
  let sum = 0;
  let sumAbs = 0;
  let sumSq = 0;
  for (let k = 0; k < a.length; k++) {
    if (a[k] < threshold && b[k] < threshold) continue;
    const d = b[k] - a[k];
    n++;
    sum += d;
    sumAbs += Math.abs(d);
    sumSq += d * d;
  }
  return n === 0 ? { n, meanSigned: 0, meanAbsolute: 0, rmse: 0 } : { n, meanSigned: sum / n, meanAbsolute: sumAbs / n, rmse: Math.sqrt(sumSq / n) };
}
