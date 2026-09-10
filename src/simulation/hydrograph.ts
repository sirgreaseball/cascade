// Breach outflow hydrograph: "how much water leaves the dam, and when".
//
// Dam breach / lake outburst: level-pool reservoir routing through a trapezoidal breach that
// grows linearly over the formation time (the NWS-BREACH / HEC-RAS "user-defined breach"
// approach). Breach geometry and formation time default to Froehlich (2008), the regression
// most widely used for embankment dams; outflow uses the broad-crested weir equation in SI units.
// Controlled release: a ramped spillway discharge on top of base flow.
//
// Self-contained on purpose (no runtime imports) so Node verification scripts can run it.

export type EventKind = 'dam-break' | 'controlled-release' | 'lake-outburst';
export type FailureMode = 'overtopping' | 'piping';

export interface EventParams {
  kind: EventKind;
  /** Reservoir / lake volume at the start of the event (m³). */
  volume: number;
  /** Structural height of the dam or blockage (m). */
  damHeight: number;
  /** Water depth against the dam at t = 0, measured from the dam base (m). */
  waterDepth: number;
  /** Vertical extent of the final breach, measured down from the crest (m). */
  breachDepth: number;
  /** Final average breach width (m). */
  breachWidth: number;
  /** Time for the breach to develop fully (s). */
  formationTime: number;
  failureMode: FailureMode;
  /** River base flow that keeps entering the reach (m³/s). */
  baseFlow: number;
  /** Controlled-release discharge (m³/s). */
  releaseDischarge: number;
  /** Time to ramp the release gates fully open (s). */
  releaseRamp: number;
  /** Exponent m of the stage-storage power law V(h) = V0 (h / h0)^m. 2–3 fits V-shaped valleys. */
  storageExponent: number;
}

export interface Hydrograph {
  /** Seconds since the start of the event. */
  t: number[];
  /** Outflow into the downstream reach (m³/s). */
  q: number[];
  /** Reservoir water depth above the final breach invert (m); empty for releases. */
  level: number[];
  peak: number;
  timeToPeak: number;
  /** Volume that has left the reservoir by the end of the record (m³). */
  volumeReleased: number;
  /** Froehlich (1995) peak-outflow regression, for cross-checking the routed peak. */
  froehlichPeak: number | null;
}

const G = 9.81;
/** SI broad-crested weir coefficients for the rectangular and side-slope parts of a trapezoid. */
const C_WEIR = 1.7;
const C_SIDE = 1.35;

export interface FroehlichBreach {
  width: number;
  formationTime: number;
  sideSlope: number;
}

/** Froehlich (2008): average breach width, formation time and side slope. */
export function froehlich2008(volume: number, breachDepth: number, mode: FailureMode): FroehlichBreach {
  const k0 = mode === 'overtopping' ? 1.3 : 1.0;
  const hb = Math.max(breachDepth, 1);
  return {
    width: 0.27 * k0 * volume ** 0.32 * hb ** 0.04,
    formationTime: 63.2 * Math.sqrt(volume / (G * hb * hb)),
    sideSlope: mode === 'overtopping' ? 1.0 : 0.7,
  };
}

/** Froehlich (1995) peak outflow Qp = 0.607 Vw^0.295 Hw^1.24. */
export function froehlichPeak(volume: number, headOverBreach: number): number {
  return 0.607 * volume ** 0.295 * Math.max(headOverBreach, 0) ** 1.24;
}

export function interpolateHydrograph(h: Pick<Hydrograph, 't' | 'q'>, time: number): number {
  const { t, q } = h;
  if (t.length === 0) return 0;
  if (time <= t[0]) return q[0];
  if (time >= t[t.length - 1]) return q[q.length - 1];
  let lo = 0;
  let hi = t.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= time) lo = mid;
    else hi = mid;
  }
  const f = (time - t[lo]) / (t[hi] - t[lo]);
  return q[lo] + (q[hi] - q[lo]) * f;
}

/**
 * Level-pool reservoir draining through a growing trapezoidal breach. Levels are metres above
 * the final breach invert ("datum"). Used on its own for the free-outflow preview hydrograph,
 * and inside the solvers as an internal boundary where the tailwater comes from the 2D flow,
 * with Fread's (1988, NWS BREACH) submergence correction for a drowned breach.
 */
export class BreachReservoir {
  readonly headAtStart: number;
  readonly releasableVolume: number;
  private readonly hb: number;
  private readonly m: number;
  private readonly bottomWidth: number;
  private readonly tf: number;
  private readonly sideSlope: number;
  volume: number;
  released = 0;

  constructor(p: EventParams) {
    this.sideSlope = p.failureMode === 'overtopping' ? 1.0 : 0.7;
    this.hb = Math.min(Math.max(p.breachDepth, 1), p.damHeight);
    // Water below the final invert never leaves through the breach.
    const invertAboveBase = p.damHeight - this.hb;
    this.headAtStart = Math.max(p.waterDepth - invertAboveBase, 0);
    this.m = Math.max(p.storageExponent, 1);
    this.releasableVolume = p.volume * (p.waterDepth > 0 ? (this.headAtStart / p.waterDepth) ** this.m : 0);
    this.bottomWidth = Math.max(p.breachWidth - this.sideSlope * this.hb, 0.25 * p.breachWidth);
    this.tf = Math.max(p.formationTime, 60);
    this.volume = this.releasableVolume;
  }

  /** Reservoir water level above the final invert for a stored volume. */
  level(vol = this.volume): number {
    return vol > 0 && this.releasableVolume > 0 ? this.headAtStart * (vol / this.releasableVolume) ** (1 / this.m) : 0;
  }

  /** Head of the reservoir over the breach invert at a time (m). */
  headOverInvert(time: number): number {
    const progress = Math.min(Math.max(time, 0) / this.tf, 1);
    return Math.max(this.level() - this.hb * (1 - progress), 0);
  }

  /** Breach outflow (m³/s). `tailwater` is the downstream water level above the final invert. */
  outflow(time: number, vol: number, tailwater: number): number {
    const h = this.level(vol);
    const progress = Math.min(Math.max(time, 0) / this.tf, 1);
    const invert = this.hb * (1 - progress);
    const b = this.bottomWidth * progress;
    const head = h - invert;
    if (head <= 0) return 0;
    let q = C_WEIR * b * head ** 1.5 + C_SIDE * this.sideSlope * head ** 2.5;
    if (tailwater > invert) {
      const r = (tailwater - invert) / head;
      if (r >= 1) return 0;
      if (r > 0.67) q *= Math.max(0, 1 - 27.8 * (r - 0.67) ** 3);
    }
    return q;
  }

  /** Midpoint (RK2) step of dV/dt = −Q; returns the mean outflow over the step. */
  advance(time: number, dt: number, tailwater: number): number {
    const a = this.outflow(time, this.volume, tailwater);
    const vMid = Math.max(this.volume - a * dt * 0.5, 0);
    const b = this.outflow(time + dt * 0.5, vMid, tailwater);
    const q = Math.min(b, this.volume / dt);
    this.volume = Math.max(this.volume - q * dt, 0);
    this.released += q * dt;
    return q;
  }
}

/** Free-outflow (no tailwater) hydrograph: the upper bound shown before a run. */
export function computeHydrograph(p: EventParams, duration: number, sampleEvery = 30): Hydrograph {
  if (p.kind === 'controlled-release') return releaseHydrograph(p, duration, sampleEvery);

  const reservoir = new BreachReservoir(p);
  const t: number[] = [];
  const q: number[] = [];
  const level: number[] = [];
  let peak = 0;
  let timeToPeak = 0;
  let nextSample = 0;
  const dt = 1;
  for (let time = 0; time <= duration + 1e-9; time += dt) {
    const qNow = reservoir.outflow(time, reservoir.volume, -Infinity) + p.baseFlow;
    if (time >= nextSample - 1e-9) {
      t.push(time);
      q.push(qNow);
      level.push(reservoir.level());
      nextSample += sampleEvery;
    }
    if (qNow > peak) {
      peak = qNow;
      timeToPeak = time;
    }
    reservoir.advance(time, dt, -Infinity);
  }
  return {
    t,
    q,
    level,
    peak,
    timeToPeak,
    volumeReleased: reservoir.released + p.baseFlow * duration,
    froehlichPeak: froehlichPeak(p.volume, reservoir.headAtStart),
  };
}

function releaseHydrograph(p: EventParams, duration: number, sampleEvery: number): Hydrograph {
  const t: number[] = [];
  const q: number[] = [];
  const ramp = Math.max(p.releaseRamp, 1);
  let volume = 0;
  for (let time = 0; time <= duration + 1e-9; time += sampleEvery) {
    const value = p.baseFlow + p.releaseDischarge * Math.min(time / ramp, 1);
    t.push(time);
    q.push(value);
  }
  for (let i = 1; i < t.length; i++) volume += 0.5 * (q[i] + q[i - 1]) * (t[i] - t[i - 1]);
  const peak = Math.max(...q);
  return { t, q, level: [], peak, timeToPeak: Math.min(ramp, duration), volumeReleased: volume, froehlichPeak: null };
}

/** Sensible starting parameters for a structure, with the breach sized by Froehlich (2008). */
export function defaultEventParams(
  kind: EventKind,
  dam: { height: number; volumeM3: number; waterDepth?: number },
  mode: FailureMode = kind === 'lake-outburst' ? 'overtopping' : 'overtopping',
): EventParams {
  const waterDepth = dam.waterDepth ?? dam.height * 0.95;
  const breachDepth = dam.height;
  const fr = froehlich2008(dam.volumeM3, breachDepth, mode);
  return {
    kind,
    volume: dam.volumeM3,
    damHeight: dam.height,
    waterDepth,
    breachDepth,
    breachWidth: Math.round(fr.width),
    formationTime: Math.round(fr.formationTime),
    failureMode: mode,
    baseFlow: 150,
    releaseDischarge: 5_000,
    releaseRamp: 1_800,
    storageExponent: 2.5,
  };
}
