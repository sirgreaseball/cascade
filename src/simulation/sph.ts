// Smoothed Particle Hydrodynamics for the 2D shallow-water equations (SPH-SWE), after
// Ata & Soulaïmani (2005) and Vacondio et al. (2012, J. Hydraul. Eng.), the SPH formulation
// used for practical dam-break flood inundation.
//
// Each particle carries a fixed water volume V. Depth is the kernel sum of neighbouring
// volumes, h_i = Σ_j V_j W(r_ij, ℓ_i), with a variable smoothing length ℓ_i = k·√(V/h_i).
// With "density" = h and "pressure" = g h²/2 the symmetric SPH momentum equation reduces to
//   dv_i/dt = −g Σ_j V_j ∇W_ij − g ∇z(x_i) − Monaghan viscosity − g n² |v| v / h^(4/3)
// (bed slope from the DEM, Manning friction integrated implicitly). Particles are emitted at
// the breach cells at the coupled breach outflow rate and removed when they leave the domain,
// so mass is conserved to one particle volume. For maps, analytics and comparison against the
// grid solver, particles are interpolated back onto the same grid with a mass-normalised kernel.
//
// Neighbour search uses a counting-sort hash grid; the inner loops are written out inline
// (no per-pair function calls) because they dominate the run time.

import { InflowBoundary } from './boundary.ts';
import type { EngineConfig } from './types.ts';

const G = 9.81;
const K_ELL = 1.3;
const SIGMA_2D = 10 / (7 * Math.PI);

function kernel(r: number, ell: number): number {
  const q = r / ell;
  if (q >= 2) return 0;
  const sigma = SIGMA_2D / (ell * ell);
  if (q < 1) return sigma * (1 - 1.5 * q * q + 0.75 * q * q * q);
  const t = 2 - q;
  return sigma * 0.25 * t * t * t;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class SPHSolver {
  readonly cols: number;
  readonly rows: number;
  readonly dx: number;
  readonly dy: number;
  readonly width: number;
  readonly height: number;
  readonly particleVolume: number;
  readonly capacity: number;

  // Particle state.
  n = 0;
  readonly px: Float64Array;
  readonly py: Float64Array;
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  readonly depth: Float64Array;
  readonly ell: Float64Array;
  private readonly ax: Float64Array;
  private readonly ay: Float64Array;
  private readonly cellOf: Int32Array;

  // Grid-interpolated fields.
  readonly raster: Float32Array;
  private readonly rasterQx: Float32Array;
  private readonly rasterQy: Float32Array;
  readonly maxDepth: Float32Array;
  readonly arrival: Float32Array;
  readonly maxSpeed: Float32Array;
  readonly maxDepthVelocity: Float32Array;

  t = 0;
  steps = 0;
  inflowVolume = 0;
  outflowVolume = 0;
  /** Volume that could not be emitted because the particle budget was exhausted. */
  droppedVolume = 0;
  lastDt = 0;

  private readonly cfg: EngineConfig;
  private readonly boundary: InflowBoundary;
  private readonly z: Float32Array;
  private readonly gradX: Float32Array;
  private readonly gradY: Float32Array;
  private readonly ellMin: number;
  private readonly ellMax: number;
  private readonly n2: number;
  private readonly thalweg: number;
  private readonly rand: () => number;
  private emitCarry = 0;
  private sourceCursor = 0;
  private nextDt = 0.5;
  private lastRasterT = -Infinity;

  // Neighbour hash (counting sort).
  private hashSize = 1;
  private hashCols = 1;
  private hashRows = 1;
  private cellStart: Int32Array = new Int32Array(2);
  private cellFill: Int32Array = new Int32Array(1);
  private readonly sorted: Int32Array;

  constructor(cfg: EngineConfig) {
    this.cfg = cfg;
    this.boundary = new InflowBoundary(cfg);
    const { cols, rows, dx, dy } = cfg;
    this.cols = cols;
    this.rows = rows;
    this.dx = dx;
    this.dy = dy;
    this.width = cols * dx;
    this.height = rows * dy;
    const n = cols * rows;
    this.z = cfg.elevation;
    this.n2 = cfg.manning * cfg.manning;

    // Bed slope (central differences, one-sided at the edges).
    this.gradX = new Float32Array(n);
    this.gradY = new Float32Array(n);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const k = r * cols + c;
        const cw = c > 0 ? k - 1 : k;
        const ce = c < cols - 1 ? k + 1 : k;
        const rn = r > 0 ? k - cols : k;
        const rs = r < rows - 1 ? k + cols : k;
        this.gradX[k] = (this.z[ce] - this.z[cw]) / (dx * (ce - cw || 1));
        this.gradY[k] = (this.z[rs] - this.z[rn]) / (dy * ((rs - rn) / cols || 1));
      }
    }

    let thalweg = cfg.sources[0]?.index ?? 0;
    for (const s of cfg.sources) if (this.z[s.index] < this.z[thalweg]) thalweg = s.index;
    this.thalweg = thalweg;

    // Particle volume from the budget and the volume the breach can release.
    const target = Math.max(1000, cfg.sph?.targetParticles ?? 6_000);
    let total = 0;
    const { t, q } = cfg.hydrograph;
    for (let i = 1; i < t.length && t[i - 1] < cfg.duration; i++) {
      const t1 = Math.min(t[i], cfg.duration);
      total += 0.5 * (q[i] + q[i - 1]) * (t1 - t[i - 1]);
    }
    const minCell = Math.min(dx, dy);
    // Particles no finer than the grid: at 0.5 m depth ℓ is about one cell.
    const volumeFloor = ((0.9 * minCell) / K_ELL) ** 2 * 0.5;
    this.particleVolume = Math.max(total / target, volumeFloor, 1);
    this.capacity = Math.ceil(total / this.particleVolume) + 64;
    this.ellMin = Math.max(0.9 * minCell, K_ELL * Math.sqrt(this.particleVolume / 200));
    this.ellMax = Math.max(this.ellMin * 1.5, Math.min(K_ELL * Math.sqrt(this.particleVolume / 0.4), 6 * Math.max(dx, dy)));

    const cap = this.capacity;
    this.px = new Float64Array(cap);
    this.py = new Float64Array(cap);
    this.vx = new Float64Array(cap);
    this.vy = new Float64Array(cap);
    this.depth = new Float64Array(cap);
    this.ell = new Float64Array(cap);
    this.ax = new Float64Array(cap);
    this.ay = new Float64Array(cap);
    this.cellOf = new Int32Array(cap);
    this.sorted = new Int32Array(cap);

    this.raster = new Float32Array(n);
    this.rasterQx = new Float32Array(n);
    this.rasterQy = new Float32Array(n);
    this.maxDepth = new Float32Array(n);
    this.arrival = new Float32Array(n).fill(-1);
    this.maxSpeed = new Float32Array(n);
    this.maxDepthVelocity = new Float32Array(n);
    this.rand = mulberry32(0x5eed);
  }

  /** Breach inflow over the last step (m³/s). */
  get inflowRate(): number {
    return this.boundary.lastRate;
  }

  /** Water-surface elevation at the lowest breach cell, from the latest particle interpolation. */
  private tailwater(): number {
    return this.z[this.thalweg] + this.raster[this.thalweg];
  }

  bedElevation(x: number, y: number): number {
    const fx = Math.min(Math.max(x / this.dx - 0.5, 0), this.cols - 1);
    const fy = Math.min(Math.max(y / this.dy - 0.5, 0), this.rows - 1);
    const c0 = Math.floor(fx);
    const r0 = Math.floor(fy);
    const c1 = Math.min(c0 + 1, this.cols - 1);
    const r1 = Math.min(r0 + 1, this.rows - 1);
    const tx = fx - c0;
    const ty = fy - r0;
    const z = this.z;
    const cols = this.cols;
    return (z[r0 * cols + c0] * (1 - tx) + z[r0 * cols + c1] * tx) * (1 - ty) + (z[r1 * cols + c0] * (1 - tx) + z[r1 * cols + c1] * tx) * ty;
  }

  private buildHash(): void {
    const n = this.n;
    let sumEll = 0;
    for (let i = 0; i < n; i++) sumEll += this.ell[i];
    const meanEll = n > 0 ? sumEll / n : this.ellMin;
    this.hashSize = Math.max(2 * meanEll, 2 * this.ellMin);
    this.hashCols = Math.ceil(this.width / this.hashSize) + 1;
    this.hashRows = Math.ceil(this.height / this.hashSize) + 1;
    const cells = this.hashCols * this.hashRows;
    if (this.cellStart.length < cells + 1) {
      this.cellStart = new Int32Array(cells + 1);
      this.cellFill = new Int32Array(cells);
    }
    const start = this.cellStart;
    start.fill(0, 0, cells + 1);
    const { px, py, cellOf, hashSize, hashCols, hashRows } = this;
    for (let i = 0; i < n; i++) {
      let hc = Math.floor(px[i] / hashSize);
      let hr = Math.floor(py[i] / hashSize);
      if (hc < 0) hc = 0;
      else if (hc >= hashCols) hc = hashCols - 1;
      if (hr < 0) hr = 0;
      else if (hr >= hashRows) hr = hashRows - 1;
      const cell = hr * hashCols + hc;
      cellOf[i] = cell;
      start[cell + 1]++;
    }
    for (let c = 0; c < cells; c++) start[c + 1] += start[c];
    const fill = this.cellFill;
    fill.set(start.subarray(0, cells));
    for (let i = 0; i < n; i++) this.sorted[fill[cellOf[i]]++] = i;
  }

  step(limit: number): number {
    const dt = Math.max(Math.min(this.nextDt, limit), 1e-3);
    const n0 = this.n;
    if (n0 > 0) {
      this.buildHash();
      const { px, py, vx, vy, depth, ell, ax, ay, sorted, cellStart, hashSize, hashCols, hashRows, gradX, gradY, cols, rows, dx, dy } = this;
      const V = this.particleVolume;

      // 1. Depth by kernel summation (gather with each particle's own ℓ).
      for (let i = 0; i < n0; i++) {
        const li = ell[i];
        const R = 2 * li;
        const R2 = R * R;
        const inv = 1 / li;
        const xi = px[i];
        const yi = py[i];
        const hc0 = Math.max(0, Math.floor((xi - R) / hashSize));
        const hc1 = Math.min(hashCols - 1, Math.floor((xi + R) / hashSize));
        const hr0 = Math.max(0, Math.floor((yi - R) / hashSize));
        const hr1 = Math.min(hashRows - 1, Math.floor((yi + R) / hashSize));
        let s = 0;
        for (let hr = hr0; hr <= hr1; hr++) {
          const rowBase = hr * hashCols;
          for (let hc = hc0; hc <= hc1; hc++) {
            const cell = rowBase + hc;
            const end = cellStart[cell + 1];
            for (let q = cellStart[cell]; q < end; q++) {
              const j = sorted[q];
              const ex = xi - px[j];
              const ey = yi - py[j];
              const r2 = ex * ex + ey * ey;
              if (r2 >= R2) continue;
              const qq = Math.sqrt(r2) * inv;
              if (qq < 1) s += 1 - 1.5 * qq * qq + 0.75 * qq * qq * qq;
              else {
                const t = 2 - qq;
                s += 0.25 * t * t * t;
              }
            }
          }
        }
        const h = (V * SIGMA_2D * s) / (li * li);
        depth[i] = h > 1e-4 ? h : 1e-4;
      }
      for (let i = 0; i < n0; i++) {
        const target = K_ELL * Math.sqrt(V / depth[i]);
        const l = 0.5 * ell[i] + 0.5 * target;
        ell[i] = l < this.ellMin ? this.ellMin : l > this.ellMax ? this.ellMax : l;
      }

      // 2. Forces: pressure gradient + Monaghan viscosity (averaged kernel gradients), bed slope.
      const alphaVisc = 0.4;
      for (let i = 0; i < n0; i++) {
        const li = ell[i];
        const R = 2.2 * li;
        const R2 = R * R;
        const hi = depth[i];
        const xi = px[i];
        const yi = py[i];
        const vxi = vx[i];
        const vyi = vy[i];
        const sigI = SIGMA_2D / (li * li * li);
        let axi = 0;
        let ayi = 0;
        const hc0 = Math.max(0, Math.floor((xi - R) / hashSize));
        const hc1 = Math.min(hashCols - 1, Math.floor((xi + R) / hashSize));
        const hr0 = Math.max(0, Math.floor((yi - R) / hashSize));
        const hr1 = Math.min(hashRows - 1, Math.floor((yi + R) / hashSize));
        for (let hr = hr0; hr <= hr1; hr++) {
          const rowBase = hr * hashCols;
          for (let hc = hc0; hc <= hc1; hc++) {
            const cell = rowBase + hc;
            const end = cellStart[cell + 1];
            for (let q = cellStart[cell]; q < end; q++) {
              const j = sorted[q];
              if (j === i) continue;
              const ex = xi - px[j];
              const ey = yi - py[j];
              const r2 = ex * ex + ey * ey;
              if (r2 >= R2 || r2 < 1e-8) continue;
              const r = Math.sqrt(r2);
              const lj = ell[j];
              let gW = 0;
              let qq = r / li;
              if (qq < 2) gW += qq < 1 ? sigI * (-3 * qq + 2.25 * qq * qq) : -sigI * 0.75 * (2 - qq) * (2 - qq);
              qq = r / lj;
              if (qq < 2) {
                const sigJ = SIGMA_2D / (lj * lj * lj);
                gW += qq < 1 ? sigJ * (-3 * qq + 2.25 * qq * qq) : -sigJ * 0.75 * (2 - qq) * (2 - qq);
              }
              if (gW === 0) continue;
              gW *= 0.5;
              let coef = -G * V * gW;
              const vr = (vxi - vx[j]) * ex + (vyi - vy[j]) * ey;
              if (vr < 0) {
                const lb = 0.5 * (li + lj);
                const hb = 0.5 * (hi + depth[j]);
                const mu = (lb * vr) / (r2 + 0.01 * lb * lb);
                coef += (V * alphaVisc * Math.sqrt(G * hb) * mu * gW) / hb;
              }
              const cr = coef / r;
              axi += cr * ex;
              ayi += cr * ey;
            }
          }
        }
        // Bed slope, bilinear from cell-centred gradients.
        const fx = Math.min(Math.max(xi / dx - 0.5, 0), cols - 1);
        const fy = Math.min(Math.max(yi / dy - 0.5, 0), rows - 1);
        const c0 = fx | 0;
        const r0 = fy | 0;
        const c1 = c0 + 1 < cols ? c0 + 1 : c0;
        const r1 = r0 + 1 < rows ? r0 + 1 : r0;
        const tx = fx - c0;
        const ty = fy - r0;
        const k00 = r0 * cols + c0;
        const k01 = r0 * cols + c1;
        const k10 = r1 * cols + c0;
        const k11 = r1 * cols + c1;
        const gx = (gradX[k00] * (1 - tx) + gradX[k01] * tx) * (1 - ty) + (gradX[k10] * (1 - tx) + gradX[k11] * tx) * ty;
        const gy = (gradY[k00] * (1 - tx) + gradY[k01] * tx) * (1 - ty) + (gradY[k10] * (1 - tx) + gradY[k11] * tx) * ty;
        ax[i] = axi - G * gx;
        ay[i] = ayi - G * gy;
      }

      // 3. Symplectic Euler with implicit Manning friction; remove particles leaving the domain.
      const n2 = this.n2;
      let maxRate = 0;
      for (let i = 0; i < this.n; ) {
        let u = vx[i] + ax[i] * dt;
        let v = vy[i] + ay[i] * dt;
        const hi = depth[i] > 0.05 ? depth[i] : 0.05;
        const speed0 = Math.sqrt(u * u + v * v);
        const damp = 1 + (dt * G * n2 * speed0) / (hi * Math.cbrt(hi));
        u /= damp;
        v /= damp;
        const speed = speed0 / damp;
        if (speed > 40) {
          u *= 40 / speed;
          v *= 40 / speed;
        }
        vx[i] = u;
        vy[i] = v;
        px[i] += u * dt;
        py[i] += v * dt;
        if (px[i] < 0 || py[i] < 0 || px[i] >= this.width || py[i] >= this.height) {
          this.outflowVolume += V;
          this.removeParticle(i);
          continue;
        }
        const rate = (Math.sqrt(G * depth[i]) + Math.min(speed, 40)) / ell[i];
        if (rate > maxRate) maxRate = rate;
        i++;
      }
      this.nextDt = Math.min(5, maxRate > 0 ? 0.35 / maxRate : 5);
    } else {
      this.nextDt = 1;
    }

    this.emit(dt);
    this.t += dt;
    this.steps++;
    this.lastDt = dt;
    if (this.t - this.lastRasterT >= 20) this.rasterize();
    return dt;
  }

  private removeParticle(i: number): void {
    const last = --this.n;
    if (i !== last) {
      this.px[i] = this.px[last];
      this.py[i] = this.py[last];
      this.vx[i] = this.vx[last];
      this.vy[i] = this.vy[last];
      this.depth[i] = this.depth[last];
      this.ell[i] = this.ell[last];
    }
  }

  private emit(dt: number): void {
    const q = this.boundary.step(this.t, dt, this.tailwater());
    if (q <= 0) return;
    const V = this.particleVolume;
    this.inflowVolume += q * dt;
    this.emitCarry += (q * dt) / V;
    const sources = this.cfg.sources;
    const [dirX, dirY] = this.cfg.sourceDirection;
    const jet = this.boundary.jetVelocity();
    // Cumulative weights for picking breach cells in proportion to their share of the outflow.
    const cumulative: number[] = [];
    let acc = 0;
    for (const s of sources) cumulative.push((acc += s.weight));
    while (this.emitCarry >= 1) {
      this.emitCarry -= 1;
      if (this.n >= this.capacity) {
        this.droppedVolume += V;
        continue;
      }
      // Low-discrepancy pick of a breach cell by weight.
      const u = ((this.sourceCursor++ * 0.618033988749895) % 1) * acc;
      let si = 0;
      while (si < cumulative.length - 1 && cumulative[si] < u) si++;
      const s = sources[si];
      const c = s.index % this.cols;
      const r = Math.floor(s.index / this.cols);
      const i = this.n++;
      this.px[i] = (c + 0.5 + (this.rand() - 0.5) * 0.9) * this.dx;
      this.py[i] = (r + 0.5 + (this.rand() - 0.5) * 0.9) * this.dy;
      this.vx[i] = dirX * jet;
      this.vy[i] = dirY * jet;
      this.depth[i] = 1;
      this.ell[i] = Math.min(this.ellMax, Math.max(this.ellMin, K_ELL * Math.sqrt(V)));
    }
  }

  /** Mass-normalised kernel interpolation of particles onto the grid; updates envelopes. */
  rasterize(): void {
    const { cols, rows, dx, dy, raster, rasterQx, rasterQy } = this;
    raster.fill(0);
    rasterQx.fill(0);
    rasterQy.fill(0);
    const V = this.particleVolume;
    const cellArea = dx * dy;
    const idx: number[] = [];
    const wts: number[] = [];
    for (let i = 0; i < this.n; i++) {
      const l = Math.max(this.ell[i], 0.6 * Math.min(dx, dy));
      const x = this.px[i];
      const y = this.py[i];
      const c0 = Math.max(0, Math.floor((x - 2 * l) / dx));
      const c1 = Math.min(cols - 1, Math.floor((x + 2 * l) / dx));
      const r0 = Math.max(0, Math.floor((y - 2 * l) / dy));
      const r1 = Math.min(rows - 1, Math.floor((y + 2 * l) / dy));
      idx.length = 0;
      wts.length = 0;
      let sum = 0;
      for (let r = r0; r <= r1; r++) {
        const cy = (r + 0.5) * dy - y;
        for (let c = c0; c <= c1; c++) {
          const cx = (c + 0.5) * dx - x;
          const w = kernel(Math.sqrt(cx * cx + cy * cy), l);
          if (w > 0) {
            idx.push(r * cols + c);
            wts.push(w);
            sum += w;
          }
        }
      }
      if (sum === 0) {
        const c = Math.min(cols - 1, Math.floor(x / dx));
        const r = Math.min(rows - 1, Math.floor(y / dy));
        idx.push(r * cols + c);
        wts.push(1);
        sum = 1;
      }
      const scale = V / (sum * cellArea);
      const u = this.vx[i];
      const v = this.vy[i];
      for (let m = 0; m < idx.length; m++) {
        const d = wts[m] * scale;
        raster[idx[m]] += d;
        rasterQx[idx[m]] += d * u;
        rasterQy[idx[m]] += d * v;
      }
    }
    const wet = this.cfg.wetThreshold;
    const { maxDepth, arrival, maxSpeed, maxDepthVelocity } = this;
    for (let k = 0; k < raster.length; k++) {
      const h = raster[k];
      if (h <= 0) continue;
      if (h > maxDepth[k]) maxDepth[k] = h;
      if (h >= wet) {
        if (arrival[k] < 0) arrival[k] = this.t;
        const hv = Math.hypot(rasterQx[k], rasterQy[k]);
        if (hv > maxDepthVelocity[k]) maxDepthVelocity[k] = hv;
        const s = Math.min(hv / h, 30);
        if (s > maxSpeed[k]) maxSpeed[k] = s;
      }
    }
    this.lastRasterT = this.t;
  }

  depthCentimetres(): Uint16Array {
    if (this.lastRasterT !== this.t) this.rasterize();
    const out = new Uint16Array(this.raster.length);
    for (let k = 0; k < out.length; k++) {
      const v = Math.round(this.raster[k] * 100);
      out[k] = v > 65535 ? 65535 : v;
    }
    return out;
  }

  measure(): { storedVolume: number; wetArea: number; maxDepth: number } {
    if (this.lastRasterT !== this.t) this.rasterize();
    let wetCells = 0;
    let maxDepth = 0;
    const wet = this.cfg.wetThreshold;
    for (let k = 0; k < this.raster.length; k++) {
      const v = this.raster[k];
      if (v >= wet) wetCells++;
      if (v > maxDepth) maxDepth = v;
    }
    return { storedVolume: this.n * this.particleVolume, wetArea: wetCells * this.dx * this.dy, maxDepth };
  }

  /** Particle positions as local metres + speeds, subsampled to at most `limit`. */
  particleSnapshot(limit: number): { x: Float32Array; y: Float32Array; z: Float32Array; speed: Float32Array } {
    const n = this.n;
    const stride = Math.max(1, Math.ceil(n / limit));
    const m = Math.ceil(n / stride);
    const x = new Float32Array(m);
    const y = new Float32Array(m);
    const z = new Float32Array(m);
    const speed = new Float32Array(m);
    for (let i = 0, o = 0; i < n && o < m; i += stride, o++) {
      x[o] = this.px[i];
      y[o] = this.py[i];
      z[o] = this.bedElevation(this.px[i], this.py[i]) + this.depth[i];
      speed[o] = Math.hypot(this.vx[i], this.vy[i]);
    }
    return { x, y, z, speed };
  }
}
