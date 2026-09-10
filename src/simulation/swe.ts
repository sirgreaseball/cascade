// 2D depth-averaged shallow-water solver (full momentum — the equations Delft3D-FLOW solves in
// 2DH mode), discretised with a shock-capturing Godunov finite-volume scheme:
//   · HLL approximate Riemann fluxes (Harten, Lax & van Leer 1983; Toro 2001),
//   · hydrostatic reconstruction for the bed (Audusse et al. 2004): well-balanced ("lake at
//     rest" stays at rest) and depth-positive on wet/dry fronts,
//   · point-implicit Manning friction,
//   · open outflow boundaries that never let water back in.
// Dam-break flows in Himalayan gorges are strongly supercritical; a Riemann solver handles the
// resulting bores and hydraulic jumps where simplified (local-inertial/diffusive) schemes do not.
//
//   ∂h/∂t  + ∂(hu)/∂x + ∂(hv)/∂y = S
//   ∂(hu)/∂t + ∂(hu² + ½gh²)/∂x + ∂(huv)/∂y = −gh ∂z/∂x − g n² |u| u / h^(1/3)
//   ∂(hv)/∂t + ∂(huv)/∂x + ∂(hv² + ½gh²)/∂y = −gh ∂z/∂y − g n² |u| v / h^(1/3)
//
// Conservative fluxes make mass conservation exact; only the wet bounding box (plus a margin)
// is iterated, and dry–dry faces are skipped.

import { InflowBoundary } from './boundary.ts';
import type { EngineConfig } from './types.ts';

const G = 9.81;
const DRY = 1e-8;
/** Below this depth velocities are not resolved (momentum set to zero). */
const VEL_DEPTH = 1e-3;
const MAX_SPEED = 45;

let F0 = 0;
let F1 = 0;
let F2 = 0;

/**
 * HLL flux across a face with normal velocity u and tangential velocity v.
 * Sets F0 = mass, F1 = normal momentum, F2 = tangential momentum.
 */
function hll(hL: number, uL: number, vL: number, hR: number, uR: number, vR: number): void {
  const cL = Math.sqrt(G * hL);
  const cR = Math.sqrt(G * hR);
  let sL: number;
  let sR: number;
  if (hL <= DRY) {
    sL = uR - 2 * cR;
    sR = uR + cR;
  } else if (hR <= DRY) {
    sL = uL - cL;
    sR = uL + 2 * cL;
  } else {
    sL = Math.min(uL - cL, uR - cR);
    sR = Math.max(uL + cL, uR + cR);
  }
  const qL = hL * uL;
  const qR = hR * uR;
  if (sL >= 0) {
    F0 = qL;
    F1 = qL * uL + 0.5 * G * hL * hL;
    F2 = qL * vL;
  } else if (sR <= 0) {
    F0 = qR;
    F1 = qR * uR + 0.5 * G * hR * hR;
    F2 = qR * vR;
  } else {
    const inv = 1 / (sR - sL);
    const s = sL * sR;
    F0 = (sR * qL - sL * qR + s * (hR - hL)) * inv;
    F1 = (sR * (qL * uL + 0.5 * G * hL * hL) - sL * (qR * uR + 0.5 * G * hR * hR) + s * (qR - qL)) * inv;
    F2 = (sR * qL * vL - sL * qR * vR + s * (hR * vR - hL * vL)) * inv;
  }
}

export class ShallowWaterSolver {
  readonly cols: number;
  readonly rows: number;
  readonly dx: number;
  readonly dy: number;
  readonly cellArea: number;
  readonly z: Float64Array;
  readonly h: Float64Array;
  readonly hu: Float64Array;
  readonly hv: Float64Array;
  readonly maxDepth: Float32Array;
  readonly arrival: Float32Array;
  readonly maxSpeed: Float32Array;
  readonly maxDepthVelocity: Float32Array;

  t = 0;
  steps = 0;
  inflowVolume = 0;
  outflowVolume = 0;
  lastDt = 0;

  private readonly dh: Float64Array;
  private readonly dhu: Float64Array;
  private readonly dhv: Float64Array;
  /** max over wet cells of (|u|+c)/dx + (|v|+c)/dy, for the CFL condition. */
  private rate = 0;
  private r0: number;
  private r1: number;
  private c0: number;
  private c1: number;
  private readonly n2: number;
  private readonly cfl = 0.45;
  private readonly maxDt = 10;
  private readonly wet: number;
  private readonly cfg: EngineConfig;
  private readonly boundary: InflowBoundary;
  /** Lowest-bed breach cell: where the breach reads its tailwater. */
  private readonly thalweg: number;

  constructor(cfg: EngineConfig) {
    this.cfg = cfg;
    this.boundary = new InflowBoundary(cfg);
    const { cols, rows } = cfg;
    const n = cols * rows;
    this.cols = cols;
    this.rows = rows;
    this.dx = cfg.dx;
    this.dy = cfg.dy;
    this.cellArea = cfg.dx * cfg.dy;
    this.z = Float64Array.from(cfg.elevation);
    this.h = new Float64Array(n);
    this.hu = new Float64Array(n);
    this.hv = new Float64Array(n);
    this.dh = new Float64Array(n);
    this.dhu = new Float64Array(n);
    this.dhv = new Float64Array(n);
    this.maxDepth = new Float32Array(n);
    this.arrival = new Float32Array(n).fill(-1);
    this.maxSpeed = new Float32Array(n);
    this.maxDepthVelocity = new Float32Array(n);
    this.n2 = cfg.manning * cfg.manning;
    this.wet = cfg.wetThreshold;

    let r0 = rows;
    let r1 = 0;
    let c0 = cols;
    let c1 = 0;
    let thalweg = cfg.sources[0]?.index ?? 0;
    for (const s of cfg.sources) {
      const r = Math.floor(s.index / cols);
      const c = s.index % cols;
      r0 = Math.min(r0, r);
      r1 = Math.max(r1, r);
      c0 = Math.min(c0, c);
      c1 = Math.max(c1, c);
      if (this.z[s.index] < this.z[thalweg]) thalweg = s.index;
    }
    this.thalweg = thalweg;
    this.r0 = Math.max(0, r0 - 2);
    this.r1 = Math.min(rows - 1, r1 + 2);
    this.c0 = Math.max(0, c0 - 2);
    this.c1 = Math.min(cols - 1, c1 + 2);
  }

  /** Breach inflow over the last step (m³/s). */
  get inflowRate(): number {
    return this.boundary.lastRate;
  }

  private tailwater(): number {
    return this.z[this.thalweg] + this.h[this.thalweg];
  }

  /** Advances one explicit step of at most `limit` seconds; returns the step taken. */
  step(limit: number): number {
    const { cols, rows, dx, dy, z, h, hu, hv, dh, dhu, dhv, cellArea } = this;
    const sources = this.cfg.sources;
    const tail = this.tailwater();

    // CFL time step, tightened for the depth the breach is about to add.
    let dt = Math.min(this.maxDt, limit, this.rate > 0 ? this.cfl / this.rate : this.maxDt);
    const qEst = this.boundary.estimate(this.t, tail);
    if (qEst > 0) {
      const jet = this.boundary.jetVelocity();
      for (let pass = 0; pass < 2; pass++) {
        let hs = 0;
        for (const s of sources) hs = Math.max(hs, h[s.index] + (qEst * dt * s.weight) / cellArea);
        const c = Math.sqrt(G * hs);
        dt = Math.min(dt, this.cfl / ((c + jet) / dx + (c + jet) / dy));
      }
    }
    dt = Math.max(dt, 1e-4);

    const qIn = this.boundary.step(this.t, dt, tail);
    if (qIn > 0) {
      const vol = qIn * dt;
      const jet = this.boundary.jetVelocity();
      const [ex, ey] = this.cfg.sourceDirection;
      for (const s of sources) {
        const add = (vol * s.weight) / cellArea;
        h[s.index] += add;
        hu[s.index] += add * jet * ex;
        hv[s.index] += add * jet * ey;
      }
      this.inflowVolume += vol;
    }

    const { r0, r1, c0, c1 } = this;
    for (let r = r0; r <= r1; r++) {
      const base = r * cols;
      dh.fill(0, base + c0, base + c1 + 1);
      dhu.fill(0, base + c0, base + c1 + 1);
      dhv.fill(0, base + c0, base + c1 + 1);
    }
    const sx = dt / dx;
    const sy = dt / dy;
    const halfG = 0.5 * G;
    let edgeOut = 0;

    // x-direction faces (normal velocity u).
    for (let r = r0; r <= r1; r++) {
      const rowC = r * cols;
      for (let c = c0 + 1; c <= c1; c++) {
        const L = rowC + c - 1;
        const R = L + 1;
        const hL = h[L];
        const hR = h[R];
        if (hL <= DRY && hR <= DRY) continue;
        const zL = z[L];
        const zR = z[R];
        const zF = zL > zR ? zL : zR;
        const hLs = Math.max(0, hL + zL - zF);
        const hRs = Math.max(0, hR + zR - zF);
        const uL = hL > VEL_DEPTH ? hu[L] / hL : 0;
        const vL = hL > VEL_DEPTH ? hv[L] / hL : 0;
        const uR = hR > VEL_DEPTH ? hu[R] / hR : 0;
        const vR = hR > VEL_DEPTH ? hv[R] / hR : 0;
        hll(hLs, uL, vL, hRs, uR, vR);
        dh[L] -= sx * F0;
        dhu[L] -= sx * (F1 + halfG * (hL * hL - hLs * hLs));
        dhv[L] -= sx * F2;
        dh[R] += sx * F0;
        dhu[R] += sx * (F1 + halfG * (hR * hR - hRs * hRs));
        dhv[R] += sx * F2;
      }
      if (c0 === 0) {
        const k = rowC;
        const hk = h[k];
        if (hk > DRY) {
          const uk = hk > VEL_DEPTH ? hu[k] / hk : 0;
          const vk = hk > VEL_DEPTH ? hv[k] / hk : 0;
          hll(hk, Math.min(uk, 0), vk, hk, uk, vk);
          if (F0 > 0) {
            F0 = 0;
            F1 = halfG * hk * hk;
            F2 = 0;
          }
          dh[k] += sx * F0;
          dhu[k] += sx * F1;
          dhv[k] += sx * F2;
          edgeOut -= F0 * dy;
        }
      }
      if (c1 === cols - 1) {
        const k = rowC + cols - 1;
        const hk = h[k];
        if (hk > DRY) {
          const uk = hk > VEL_DEPTH ? hu[k] / hk : 0;
          const vk = hk > VEL_DEPTH ? hv[k] / hk : 0;
          hll(hk, uk, vk, hk, Math.max(uk, 0), vk);
          if (F0 < 0) {
            F0 = 0;
            F1 = halfG * hk * hk;
            F2 = 0;
          }
          dh[k] -= sx * F0;
          dhu[k] -= sx * F1;
          dhv[k] -= sx * F2;
          edgeOut += F0 * dy;
        }
      }
    }

    // y-direction faces (normal velocity v, tangential u).
    for (let r = r0 + 1; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const N = (r - 1) * cols + c;
        const S = N + cols;
        const hN = h[N];
        const hS = h[S];
        if (hN <= DRY && hS <= DRY) continue;
        const zN = z[N];
        const zS = z[S];
        const zF = zN > zS ? zN : zS;
        const hNs = Math.max(0, hN + zN - zF);
        const hSs = Math.max(0, hS + zS - zF);
        const vN = hN > VEL_DEPTH ? hv[N] / hN : 0;
        const uN = hN > VEL_DEPTH ? hu[N] / hN : 0;
        const vS = hS > VEL_DEPTH ? hv[S] / hS : 0;
        const uS = hS > VEL_DEPTH ? hu[S] / hS : 0;
        hll(hNs, vN, uN, hSs, vS, uS);
        dh[N] -= sy * F0;
        dhv[N] -= sy * (F1 + halfG * (hN * hN - hNs * hNs));
        dhu[N] -= sy * F2;
        dh[S] += sy * F0;
        dhv[S] += sy * (F1 + halfG * (hS * hS - hSs * hSs));
        dhu[S] += sy * F2;
      }
    }
    if (r0 === 0) {
      for (let c = c0; c <= c1; c++) {
        const k = c;
        const hk = h[k];
        if (hk <= DRY) continue;
        const vk = hk > VEL_DEPTH ? hv[k] / hk : 0;
        const uk = hk > VEL_DEPTH ? hu[k] / hk : 0;
        hll(hk, Math.min(vk, 0), uk, hk, vk, uk);
        if (F0 > 0) {
          F0 = 0;
          F1 = halfG * hk * hk;
          F2 = 0;
        }
        dh[k] += sy * F0;
        dhv[k] += sy * F1;
        dhu[k] += sy * F2;
        edgeOut -= F0 * dx;
      }
    }
    if (r1 === rows - 1) {
      for (let c = c0; c <= c1; c++) {
        const k = (rows - 1) * cols + c;
        const hk = h[k];
        if (hk <= DRY) continue;
        const vk = hk > VEL_DEPTH ? hv[k] / hk : 0;
        const uk = hk > VEL_DEPTH ? hu[k] / hk : 0;
        hll(hk, vk, uk, hk, Math.max(vk, 0), uk);
        if (F0 < 0) {
          F0 = 0;
          F1 = halfG * hk * hk;
          F2 = 0;
        }
        dh[k] -= sy * F0;
        dhv[k] -= sy * F1;
        dhu[k] -= sy * F2;
        edgeOut += F0 * dx;
      }
    }
    this.outflowVolume += edgeOut * dt;

    // Update, friction, envelopes and the next CFL rate.
    const tNext = this.t + dt;
    const wet = this.wet;
    const n2 = this.n2;
    let rate = 0;
    let wr0 = rows;
    let wr1 = -1;
    let wc0 = cols;
    let wc1 = -1;
    const { maxDepth, arrival, maxSpeed, maxDepthVelocity } = this;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const k = r * cols + c;
        let hk = h[k] + dh[k];
        if (hk <= 0) {
          h[k] = 0;
          hu[k] = 0;
          hv[k] = 0;
          continue;
        }
        let qx = hu[k] + dhu[k];
        let qy = hv[k] + dhv[k];
        let speed = 0;
        if (hk < VEL_DEPTH) {
          qx = 0;
          qy = 0;
        } else {
          let u = qx / hk;
          let v = qy / hk;
          speed = Math.sqrt(u * u + v * v);
          if (speed > MAX_SPEED) {
            u *= MAX_SPEED / speed;
            v *= MAX_SPEED / speed;
            speed = MAX_SPEED;
          }
          const damp = 1 + (dt * G * n2 * speed) / (hk * Math.cbrt(hk));
          u /= damp;
          v /= damp;
          speed /= damp;
          qx = u * hk;
          qy = v * hk;
          const cw = Math.sqrt(G * hk);
          const rr = (Math.abs(u) + cw) / dx + (Math.abs(v) + cw) / dy;
          if (rr > rate) rate = rr;
        }
        h[k] = hk;
        hu[k] = qx;
        hv[k] = qy;
        if (hk > VEL_DEPTH) {
          if (r < wr0) wr0 = r;
          if (r > wr1) wr1 = r;
          if (c < wc0) wc0 = c;
          if (c > wc1) wc1 = c;
        }
        if (hk > maxDepth[k]) maxDepth[k] = hk;
        if (hk >= wet) {
          if (arrival[k] < 0) arrival[k] = tNext;
          const dv = hk * speed;
          if (dv > maxDepthVelocity[k]) maxDepthVelocity[k] = dv;
          if (speed > maxSpeed[k]) maxSpeed[k] = speed;
        }
        hk = 0;
      }
    }
    this.rate = rate;
    if (wr1 >= 0) {
      this.r0 = Math.min(this.r0, Math.max(0, wr0 - 2));
      this.r1 = Math.max(this.r1, Math.min(rows - 1, wr1 + 2));
      this.c0 = Math.min(this.c0, Math.max(0, wc0 - 2));
      this.c1 = Math.max(this.c1, Math.min(cols - 1, wc1 + 2));
    }
    this.t = tNext;
    this.steps++;
    this.lastDt = dt;
    return dt;
  }

  depthCentimetres(): Uint16Array {
    const out = new Uint16Array(this.h.length);
    const { r0, r1, c0, c1, cols } = this;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const k = r * cols + c;
        const v = Math.round(this.h[k] * 100);
        out[k] = v > 65535 ? 65535 : v;
      }
    }
    return out;
  }

  measure(): { storedVolume: number; wetArea: number; maxDepth: number } {
    let stored = 0;
    let wetCells = 0;
    let maxDepth = 0;
    const { r0, r1, c0, c1, cols, h, wet } = this;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const v = h[r * cols + c];
        stored += v;
        if (v >= wet) wetCells++;
        if (v > maxDepth) maxDepth = v;
      }
    }
    return { storedVolume: stored * this.cellArea, wetArea: wetCells * this.cellArea, maxDepth };
  }
}
