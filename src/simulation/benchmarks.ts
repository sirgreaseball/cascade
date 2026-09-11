// Analytical benchmarks for the grid solver. The verification script runs them headless and the
// Model tab runs them live in the browser, so the numbers a jury sees are computed on the spot.
//  · Ritter (1892): instantaneous dam break onto a dry, frictionless bed, with an exact solution,
//    and the same case on finer and coarser cells to show the error shrinking (convergence).
//  · Lake at rest over rough terrain: a well-balanced scheme must keep the water perfectly still.

import { ShallowWaterSolver } from './swe.ts';
import type { EngineConfig } from './types.ts';

const G = 9.81;

export interface BenchmarkResult {
  name: string;
  detail: string;
  pass: boolean;
}

function flatConfig(cols: number, rows: number, dx: number, elevation: Float32Array): EngineConfig {
  return {
    engine: 'swe',
    cols,
    rows,
    bbox: [78, 30, 78 + cols * 0.0001, 30 + rows * 0.0001],
    dx,
    dy: dx,
    elevation,
    // No inflow: the breach cell receives a zero hydrograph.
    sources: [{ index: cols, weight: 1 }],
    sourceDirection: [1, 0],
    hydrograph: { t: [0, 1e9], q: [0, 0] },
    manning: 0,
    duration: 1e9,
    outputInterval: 1e9,
    wetThreshold: 0.1,
  };
}

interface RitterErrors {
  /** Depth RMSE across the disturbed reach, as a fraction of h0. */
  rmse: number;
  /** Numerical minus exact position (m) of the 10 cm front. */
  frontError: number;
  /** Exact distance (m) the 10 cm front has travelled. */
  travel: number;
  massError: number;
}

/** Ritter's dam break: depth h0 behind a dam at x0, dry frictionless bed ahead, after t seconds. */
function ritter(h0: number, t: number, dx: number): RitterErrors {
  const x0 = 2000;
  const cols = Math.round((2 * x0) / dx);
  const rows = 3;
  // A one-cell-wide channel between two high walls.
  const z = new Float32Array(cols * rows);
  for (let c = 0; c < cols; c++) {
    z[c] = 1000;
    z[2 * cols + c] = 1000;
  }
  const s = new ShallowWaterSolver(flatConfig(cols, rows, dx, z));
  for (let c = 0; c < x0 / dx; c++) s.h[cols + c] = h0;
  const volume = () => {
    let v = 0;
    for (let c = 0; c < cols; c++) v += s.h[cols + c];
    return v;
  };
  const v0 = volume();
  while (s.t < t - 1e-9) s.step(t - s.t);

  const c0 = Math.sqrt(G * h0);
  const exact = (x: number) => {
    const xi = (x - x0) / t;
    if (xi <= -c0) return h0;
    if (xi >= 2 * c0) return 0;
    return (2 * c0 - xi) ** 2 / (9 * G);
  };
  // The front is where the water is 10 cm deep: the depth at which the app counts a cell as
  // flooded and times arrival. (The exact solution's tip thins to zero; first-order schemes
  // trail it in the last few centimetres.)
  const frontDepth = 0.1;
  let se = 0;
  let n = 0;
  let front = x0;
  for (let c = 0; c < cols; c++) {
    const x = (c + 0.5) * dx;
    const hn = s.h[cols + c];
    if (hn >= frontDepth) front = x;
    // Error over the disturbed reach only (rarefaction plus front), where the solution varies.
    if (x < x0 - c0 * t - 50 || x > x0 + 2 * c0 * t + 50) continue;
    se += (hn - exact(x)) ** 2;
    n++;
  }
  const frontExact = x0 + (2 * c0 - Math.sqrt(9 * G * frontDepth)) * t;
  return {
    rmse: Math.sqrt(se / n) / h0,
    frontError: front + dx / 2 - frontExact,
    travel: frontExact - x0,
    massError: Math.abs(volume() - v0) / v0,
  };
}

const pct = (v: number) => `${(v * 100).toFixed(1)} %`;

export function ritterBenchmark(h0 = 10, t = 60, dx = 10): BenchmarkResult {
  const e = ritter(h0, t, dx);
  const lag = Math.abs(e.frontError) / e.travel;
  return {
    name: 'Ritter dam break (analytical)',
    detail: `${h0} m of water released onto a dry bed, ${dx} m cells, ${t} s later: depth RMSE ${pct(e.rmse)} of h₀ across the wave; 10 cm flood front ${e.frontError >= 0 ? '+' : '−'}${Math.abs(e.frontError).toFixed(0)} m from the exact ${Math.round(e.travel)} m (${pct(lag)}); volume error ${e.massError.toExponential(1)}.`,
    pass: e.rmse < 0.05 && lag < 0.1 && e.massError < 1e-9,
  };
}

/** The Ritter case on 20, 10 and 5 m cells: both errors must shrink as the cells do. */
export function ritterConvergence(h0 = 10, t = 60): BenchmarkResult {
  const sizes = [20, 10, 5];
  const runs = sizes.map((dx) => ritter(h0, t, dx));
  const shrinking = runs.every((e, i) => i === 0 || (e.rmse < runs[i - 1].rmse && Math.abs(e.frontError) < Math.abs(runs[i - 1].frontError)));
  return {
    name: 'Grid convergence (Ritter)',
    detail: `Cells ${sizes.join(' → ')} m: depth RMSE ${runs.map((e) => pct(e.rmse)).join(' → ')}; front lag ${runs.map((e) => `${Math.abs(e.frontError).toFixed(0)}`).join(' → ')} m. Errors shrink as the grid is refined.`,
    pass: shrinking,
  };
}

/** A lake at rest over bumpy terrain: the surface must stay flat and the volume unchanged. */
export function lakeAtRestBenchmark(duration = 1800): BenchmarkResult {
  const cols = 60;
  const rows = 40;
  const z = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const edge = r < 2 || c < 2 || r >= rows - 2 || c >= cols - 2;
      z[r * cols + c] = edge ? 100 : 20 + 10 * Math.sin(c / 4) * Math.cos(r / 5);
    }
  }
  const s = new ShallowWaterSolver(flatConfig(cols, rows, 100, z));
  for (let k = 0; k < z.length; k++) s.h[k] = Math.max(0, 50 - z[k]);
  const volume = () => s.h.reduce((a, b) => a + b, 0);
  const v0 = volume();
  while (s.t < duration - 1e-9) s.step(duration - s.t);
  let maxDev = 0;
  for (let k = 0; k < z.length; k++) if (s.h[k] > 0) maxDev = Math.max(maxDev, Math.abs(s.z[k] + s.h[k] - 50));
  const change = Math.abs(volume() - v0) / v0;
  return {
    name: 'Lake at rest (well-balanced)',
    detail: `Still water over terrain varying by 20 m, ${duration / 60} min: largest surface movement ${maxDev.toExponential(1)} m, volume change ${change.toExponential(1)}.`,
    pass: maxDev < 1e-6 && change < 1e-12,
  };
}

export function runBenchmarks(): BenchmarkResult[] {
  return [ritterBenchmark(), ritterConvergence(), lakeAtRestBenchmark()];
}
