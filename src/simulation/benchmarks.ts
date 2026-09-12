// Analytical benchmarks for the grid solver. The verification script runs them headless and the
// Model tab runs them live in the browser, so the numbers a jury sees are computed on the spot.
//  · Ritter (1892): instantaneous dam break onto a dry, frictionless bed, with an exact solution,
//    and the same case on finer and coarser cells to show the error shrinking (convergence).
//  · Stoker (1957): the same break onto still water downstream, which forms a moving bore (a
//    shock) whose height and speed are known exactly. Real rivers are wet, so this is the case
//    that tests the scheme's shock capturing.
//  · Lake at rest over rough terrain: a well-balanced scheme must keep the water perfectly still.

import { ShallowWaterSolver } from './swe.ts';
import type { EngineConfig, SourceCell } from './types.ts';

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

/** A one-cell-wide channel between two high walls, 4 km long: depth h0 behind a dam at x0, h1 ahead. */
function channel(h0: number, h1: number, dx: number, x0: number) {
  const cols = Math.round((2 * x0) / dx);
  const rows = 3;
  const z = new Float32Array(cols * rows);
  for (let c = 0; c < cols; c++) {
    z[c] = 1000;
    z[2 * cols + c] = 1000;
  }
  const s = new ShallowWaterSolver(flatConfig(cols, rows, dx, z));
  for (let c = 0; c < cols; c++) s.h[cols + c] = c < x0 / dx ? h0 : h1;
  const volume = () => {
    let v = 0;
    for (let c = 0; c < cols; c++) v += s.h[cols + c];
    return v;
  };
  return { s, cols, volume };
}

/** Ritter's dam break: depth h0 behind a dam at x0, dry frictionless bed ahead, after t seconds. */
function ritter(h0: number, t: number, dx: number): RitterErrors {
  const x0 = 2000;
  const { s, cols, volume } = channel(h0, 0, dx, x0);
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

/**
 * Stoker's (1957) exact solution for a dam break onto still water: the depth hm and speed um of
 * the plateau between the rarefaction and the bore, and the bore's speed.
 */
function stokerPlateau(h0: number, h1: number) {
  const c0 = Math.sqrt(G * h0);
  // The rarefaction gives u = 2(c0 − cm); the bore into still water gives
  // u = (hm − h1)·√(g(hm + h1)/(2·hm·h1)). The plateau is where the two agree.
  const gap = (hm: number) => 2 * (c0 - Math.sqrt(G * hm)) - (hm - h1) * Math.sqrt((G * (hm + h1)) / (2 * hm * h1));
  let lo = h1;
  let hi = h0;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (gap(mid) > 0) lo = mid;
    else hi = mid;
  }
  const hm = (lo + hi) / 2;
  const um = 2 * (c0 - Math.sqrt(G * hm));
  return { hm, um, bore: (hm * um) / (hm - h1) };
}

/** Stoker's dam break: depth h0 released onto h1 of still water, frictionless, after t seconds. */
export function stokerBenchmark(h0 = 10, h1 = 2, t = 60, dx = 10): BenchmarkResult {
  const x0 = 2000;
  const { s, cols, volume } = channel(h0, h1, dx, x0);
  const v0 = volume();
  while (s.t < t - 1e-9) s.step(t - s.t);

  const c0 = Math.sqrt(G * h0);
  const { hm, um, bore } = stokerPlateau(h0, h1);
  const cm = Math.sqrt(G * hm);
  const exact = (x: number) => {
    const xi = (x - x0) / t;
    if (xi <= -c0) return h0;
    if (xi <= um - cm) return (2 * c0 - xi) ** 2 / (9 * G);
    if (xi <= bore) return hm;
    return h1;
  };
  // The bore sits where the depth crosses halfway between the plateau and the still water.
  const half = (hm + h1) / 2;
  let se = 0;
  let n = 0;
  let front = x0;
  for (let c = 0; c < cols; c++) {
    const x = (c + 0.5) * dx;
    const hn = s.h[cols + c];
    if (hn >= half) front = x;
    if (x < x0 - c0 * t - 50 || x > x0 + bore * t + 50) continue;
    se += (hn - exact(x)) ** 2;
    n++;
  }
  const rmse = Math.sqrt(se / n) / h0;
  const travel = bore * t;
  const frontError = front + dx / 2 - (x0 + travel);
  const plateau = s.h[cols + Math.floor((x0 + ((um - cm + bore) / 2) * t) / dx)];
  const heightError = Math.abs(plateau - hm) / hm;
  const massError = Math.abs(volume() - v0) / v0;
  return {
    name: 'Stoker dam break onto water (analytical)',
    detail: `${h0} m of water released onto ${h1} m of still water, ${dx} m cells, ${t} s later: bore ${plateau.toFixed(2)} m deep (exact ${hm.toFixed(2)} m); depth RMSE ${pct(rmse)} of h₀; bore ${frontError >= 0 ? '+' : '−'}${Math.abs(frontError).toFixed(0)} m from the exact ${Math.round(travel)} m (${pct(Math.abs(frontError) / travel)}); volume error ${massError.toExponential(1)}.`,
    pass: rmse < 0.05 && heightError < 0.02 && Math.abs(frontError) / travel < 0.05 && massError < 1e-9,
  };
}

/**
 * Momentum conservation over a small obstruction, after test 3 of the Environment Agency's
 * benchmark suite for 2D hydraulic packages (Néelz & Pender, 2013). A wave runs down a 1:200
 * slope into a depression; the inflow volume is only just enough to fill that depression, yet a
 * scheme that carries momentum pushes part of it over the 0.25 m obstruction beyond, where it
 * settles in a second depression. Schemes without inertia leave that second depression dry, which
 * is exactly what the test is designed to separate.
 *
 * The Agency distributes its own DEM and inflow files, which are not redistributable here, so the
 * terrain is rebuilt from the published description and the inflow is scaled to fill the first
 * depression exactly. That makes the pass condition independent of the rebuilt geometry: what is
 * checked is that water crosses the obstruction at all, that both ponds end level, and that no
 * volume is lost.
 */
export function momentumObstacleBenchmark(duration = 900): BenchmarkResult {
  const dx = 5;
  const cols = 60; // 300 m along the channel
  const rows = 20; // 100 m across
  const crest = 10.0; // obstruction crest at x = 200 m
  /** Long profile: 1:200 slope, depression, 0.25 m obstruction, second depression, closed end. */
  const bed = (x: number) => {
    if (x <= 150) return 10.5 - x / 200;
    if (x <= 200) return 9.75 + ((x - 150) / 50) * 0.25;
    if (x <= 250) return crest - ((x - 200) / 50) * 0.3;
    return 9.7 + ((x - 250) / 50) * 1.0;
  };
  const z = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const wall = r === 0 || r === rows - 1 || c === 0;
      z[r * cols + c] = wall ? 100 : bed((c + 0.5) * dx);
    }
  }

  // Volume the first depression holds up to the obstruction crest.
  const cellArea = dx * dx;
  let storage = 0;
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols; c++) {
      const x = (c + 0.5) * dx;
      if (x > 200) continue;
      storage += Math.max(0, crest - z[r * cols + c]) * cellArea;
    }
  }
  // Trapezoidal hydrograph (0 → peak over 15 s, held to 25 s, back to 0 at 35 s) carrying exactly
  // that volume: 22.5 s of peak discharge.
  const peak = storage / 22.5;
  const sources: SourceCell[] = [];
  for (let r = 1; r < rows - 1; r++) sources.push({ index: r * cols + 1, weight: 1 / (rows - 2) });
  const s = new ShallowWaterSolver({
    ...flatConfig(cols, rows, dx, z),
    sources,
    hydrograph: { t: [0, 15, 25, 35, duration], q: [0, peak, peak, 0, 0] },
    manning: 0.01,
    wetThreshold: 0.01,
    duration,
  });
  while (s.t < duration - 1e-9) s.step(duration - s.t);

  // Water beyond the obstruction, and how level each pond ended.
  let beyond = 0;
  const levels = (from: number, to: number) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let r = 1; r < rows - 1; r++) {
      for (let c = 1; c < cols; c++) {
        const x = (c + 0.5) * dx;
        if (x < from || x > to) continue;
        const k = r * cols + c;
        if (s.h[k] < 0.01) continue;
        const surface = s.z[k] + s.h[k];
        if (surface < lo) lo = surface;
        if (surface > hi) hi = surface;
      }
    }
    return hi > lo ? hi - lo : 0;
  };
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols; c++) {
      const x = (c + 0.5) * dx;
      if (x > 200 && s.h[r * cols + c] > beyond) beyond = s.h[r * cols + c];
    }
  }
  const pond1 = levels(0, 200);
  const pond2 = levels(200, 300);
  const massError = Math.abs(s.inflowVolume - s.outflowVolume - s.measure().storedVolume) / Math.max(s.inflowVolume, 1);
  return {
    name: 'Momentum over an obstruction (EA test 3)',
    detail: `${Math.round(storage)} m³ released onto a 1:200 slope — just enough to fill the first depression — ${duration / 60} min later: ${(beyond * 100).toFixed(1)} cm of water has carried over the 0.25 m obstruction; ponds level to ${(Math.max(pond1, pond2) * 1000).toFixed(1)} mm; volume error ${massError.toExponential(1)}.`,
    pass: beyond >= 0.01 && Math.max(pond1, pond2) < 0.02 && massError < 1e-9,
  };
}

/**
 * A sudden inflow onto a dry bed must not create water. The water in a closed basin at the end
 * has to equal the volume released into it, to rounding. This guards the moment a run is most
 * exposed: the domain is dry, so there is no wave speed anywhere to size the first time step
 * from, and the whole of it is decided by the inflow that is about to arrive.
 */
export function dryBedInflowBenchmark(duration = 120): BenchmarkResult {
  const cols = 40;
  const rows = 20;
  const dx = 5;
  const peak = 50;
  const z = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // A closed basin: walls all round, so every drop released has to still be there.
      z[r * cols + c] = r === 0 || c === 0 || r === rows - 1 || c === cols - 1 ? 100 : 10;
    }
  }
  const s = new ShallowWaterSolver({
    ...flatConfig(cols, rows, dx, z),
    sources: [{ index: cols + 1, weight: 1 }],
    hydrograph: { t: [0, 7.5, 15, 22.5, duration], q: [0, peak, peak, 0, 0] },
    manning: 0.03,
    duration,
    wetThreshold: 0.01,
  });
  while (s.t < duration - 1e-9) s.step(duration - s.t);
  let water = 0;
  for (let k = 0; k < s.h.length; k++) water += s.h[k] * dx * dx;
  const error = Math.abs(water + s.outflowVolume - s.inflowVolume) / Math.max(s.inflowVolume, 1);
  return {
    name: 'Sudden inflow onto a dry bed (mass)',
    detail: `${Math.round(s.inflowVolume)} m³ released into a dry closed basin, rising from nothing to ${peak} m³/s in 7.5 s: ${Math.round(water)} m³ present ${duration} s later, error ${error.toExponential(1)}.`,
    pass: error < 1e-9,
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
  return [ritterBenchmark(), ritterConvergence(), stokerBenchmark(), momentumObstacleBenchmark(), dryBedInflowBenchmark(), lakeAtRestBenchmark()];
}
