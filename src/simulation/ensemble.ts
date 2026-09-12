// Ensemble (Monte Carlo) runs: the same failure computed many times with the inputs nobody knows
// in advance varied over their plausible ranges — how wide the breach ends up, how fast it forms,
// and how rough the valley is. One run gives a line on the map; an ensemble gives the chance of
// each place flooding and a band around every headline number.
//
// The ranges are multiplicative around whatever the Event tab currently shows, and are wide
// because breach predictors are: Wahl (2004) found published breach-parameter formulae scatter by
// roughly a factor of two in width and considerably more in formation time. Manning's n for a
// mountain valley is uncertain by about ±30 %.

import { FLOOD_THRESHOLD } from '@/lib/analytics';
import type { ExposureIndex } from '@/lib/analytics';
import { grahamFatalityRate } from '@/lib/lifeLoss';
import type { SummaryMessage } from './types';

export const ENSEMBLE_RANGES = {
  /** Final average breach width, as a factor of the value in the Event tab. */
  width: [0.6, 1.6],
  /** Breach formation time: the most uncertain breach parameter of the three. */
  formationTime: [0.4, 2.5],
  manning: [0.75, 1.35],
} as const;

export interface MemberParams {
  breachWidth: number;
  formationTime: number;
  manning: number;
}

export interface MemberResult extends MemberParams {
  /** People in the flooded part of each settlement's footprint. */
  people: number;
  /** Flooded area (m²). */
  area: number;
  /** Graham (1999) central estimate, warning issued as the breach begins. */
  lifeLoss: number;
  /** Seconds until the first settlement floods; null if none does. */
  firstArrival: number | null;
}

export interface Band {
  p10: number;
  p50: number;
  p90: number;
  min: number;
  max: number;
}

export interface EnsembleResult {
  members: MemberResult[];
  /** Share of members (0–1) in which each grid cell floods. */
  probability: Float32Array;
  /** Share of members in which each place floods. */
  placeChance: Float32Array;
  /** Median arrival (s) at each place over the members that flood it; −1 if none do. */
  placeArrival: Float32Array;
  people: Band;
  area: Band;
  lifeLoss: Band;
  /** Arrival at the place the flood reaches first, over the members that reach it. */
  firstArrival: Band | null;
  firstPlace: string | null;
}

/** Small deterministic PRNG, so the same ensemble is reproducible run to run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One stratified sample per member per parameter (Latin hypercube), log-uniform in the factor. */
function stratify(count: number, range: readonly [number, number], rand: () => number): number[] {
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order.map((stratum) => {
    const u = (stratum + rand()) / count;
    return range[0] * (range[1] / range[0]) ** u;
  });
}

/**
 * Members spread over the parameter ranges: a Latin hypercube, so every part of each range is
 * sampled once even with only a dozen runs (plain random draws leave gaps at this size).
 */
export function sampleMembers(base: MemberParams, count = 12, seed = 0x5eed): MemberParams[] {
  const rand = mulberry32(seed);
  const w = stratify(count, ENSEMBLE_RANGES.width, rand);
  const f = stratify(count, ENSEMBLE_RANGES.formationTime, rand);
  const n = stratify(count, ENSEMBLE_RANGES.manning, rand);
  return Array.from({ length: count }, (_, i) => ({
    breachWidth: base.breachWidth * w[i],
    formationTime: base.formationTime * f[i],
    manning: base.manning * n[i],
  }));
}

function band(values: number[]): Band {
  const v = [...values].sort((a, b) => a - b);
  const q = (p: number) => {
    if (v.length === 0) return 0;
    const pos = (v.length - 1) * p;
    const i = Math.floor(pos);
    return v[i] + (v[Math.min(v.length - 1, i + 1)] - v[i]) * (pos - i);
  };
  return { p10: q(0.1), p50: q(0.5), p90: q(0.9), min: v[0] ?? 0, max: v[v.length - 1] ?? 0 };
}

/**
 * Folds each finished member into the shared totals as it arrives, so a dozen full-grid envelopes
 * never have to be held in memory at once.
 */
export class EnsembleAccumulator {
  private readonly wet: Uint16Array;
  private readonly placeFloods: Uint16Array;
  private readonly placeArrivals: number[][];
  private readonly members: MemberResult[] = [];
  private readonly firstArrivals: number[] = [];
  private firstCounts = new Map<string, number>();

  constructor(
    private readonly index: ExposureIndex,
    private readonly cells: number,
    /** Area of one grid cell (m²). */
    private readonly cellArea: number,
  ) {
    this.wet = new Uint16Array(cells);
    this.placeFloods = new Uint16Array(index.assets.length);
    this.placeArrivals = index.assets.map(() => []);
  }

  get count(): number {
    return this.members.length;
  }

  add(params: MemberParams, summary: SummaryMessage): void {
    let wetCells = 0;
    for (let k = 0; k < this.cells; k++) {
      if (summary.maxDepth[k] >= FLOOD_THRESHOLD) {
        this.wet[k]++;
        wetCells++;
      }
    }
    let people = 0;
    let lifeLoss = 0;
    let firstArrival: number | null = null;
    let firstPlace: string | null = null;
    this.index.assets.forEach((a, i) => {
      let flooded = 0;
      let arrival = -1;
      let maxDV = 0;
      for (let j = 0; j < a.footprint.length; j++) {
        const k = a.footprint[j];
        if (summary.maxDepth[k] < FLOOD_THRESHOLD) continue;
        flooded++;
        const t = summary.arrival[k];
        if (t >= 0 && (arrival < 0 || t < arrival)) arrival = t;
        if (summary.maxDepthVelocity[k] > maxDV) maxDV = summary.maxDepthVelocity[k];
      }
      if (flooded === 0) return;
      this.placeFloods[i]++;
      if (arrival >= 0) this.placeArrivals[i].push(arrival);
      if (a.kind !== 'settlement') return;
      const exposed = Math.round(a.population * (flooded / a.footprint.length));
      people += exposed;
      const at = Math.max(0, arrival);
      lifeLoss += exposed * grahamFatalityRate(maxDV, at, at).rate;
      if (arrival >= 0 && (firstArrival === null || arrival < firstArrival)) {
        firstArrival = arrival;
        firstPlace = a.name;
      }
    });
    if (firstArrival !== null) {
      this.firstArrivals.push(firstArrival);
      if (firstPlace) this.firstCounts.set(firstPlace, (this.firstCounts.get(firstPlace) ?? 0) + 1);
    }
    this.members.push({ ...params, people, area: wetCells * this.cellArea, lifeLoss, firstArrival });
  }

  result(): EnsembleResult {
    const n = Math.max(1, this.members.length);
    const probability = new Float32Array(this.cells);
    for (let k = 0; k < this.cells; k++) probability[k] = this.wet[k] / n;
    const placeChance = Float32Array.from(this.placeFloods, (c) => c / n);
    const placeArrival = Float32Array.from(this.placeArrivals, (times) => {
      if (times.length === 0) return -1;
      const sorted = [...times].sort((a, b) => a - b);
      return sorted[Math.floor((sorted.length - 1) / 2)];
    });
    let firstPlace: string | null = null;
    let best = 0;
    for (const [name, count] of this.firstCounts) {
      if (count > best) {
        best = count;
        firstPlace = name;
      }
    }
    return {
      members: this.members,
      probability,
      placeChance,
      placeArrival,
      people: band(this.members.map((m) => m.people)),
      area: band(this.members.map((m) => m.area)),
      lifeLoss: band(this.members.map((m) => m.lifeLoss)),
      firstArrival: this.firstArrivals.length > 0 ? band(this.firstArrivals) : null,
      firstPlace,
    };
  }
}
