// Headless checks for the flood engines, run with plain Node (no browser):
//
//   node scripts/verify-engines.ts                 # synthetic tests + Tehri with both engines
//   node scripts/verify-engines.ts bhakra --swe    # one scenario, grid solver only
//   node scripts/verify-engines.ts tehri --duration 7200 --resolution fast
//
// Synthetic tests: lake-at-rest (well-balanced, water must stay still over rough terrain) and
// mass conservation. Scenario runs report wall time, mass balance, peak discharge, flood extent
// and flood arrival times at the largest settlements.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { EngineRuntime } from '../src/simulation/runtime.ts';
import { ShallowWaterSolver } from '../src/simulation/swe.ts';
import { setupSimulation } from '../src/simulation/setup.ts';
import { ritterBenchmark, stokerBenchmark } from '../src/simulation/benchmarks.ts';
import type { Resolution } from '../src/simulation/setup.ts';
import { defaultEventParams } from '../src/simulation/hydrograph.ts';
import type { EventKind, FailureMode } from '../src/simulation/hydrograph.ts';
import { gridGeometry, lngLatToCell } from '../src/lib/geo/grid.ts';
import type { EngineConfig, EngineId, SummaryMessage, WorkerOutbound } from '../src/simulation/types.ts';

const root = path.resolve(import.meta.dirname, '..');
const fmtTime = (s: number) => (s < 0 ? '—' : `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`);
let failures = 0;
const check = (ok: boolean, label: string) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
};

function syntheticConfig(cols: number, rows: number, elevation: Float32Array, q: number): EngineConfig {
  return {
    engine: 'swe',
    cols,
    rows,
    bbox: [78, 30, 78 + cols * 0.001, 30 + rows * 0.0009],
    dx: 96.3,
    dy: 99.5,
    elevation,
    sources: [{ index: Math.floor(rows / 2) * cols + 2, weight: 1 }],
    sourceDirection: [1, 0],
    hydrograph: { t: [0, 1e9], q: [q, q] },
    manning: 0.035,
    duration: 3600,
    outputInterval: 600,
    wetThreshold: 0.1,
  };
}

function syntheticTests() {
  console.log('\nSynthetic tests');
  // Lake at rest: bumpy bed, flat water surface at 50 m, no inflow.
  const cols = 60;
  const rows = 40;
  const z = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) z[r * cols + c] = 20 + 10 * Math.sin(c / 4) * Math.cos(r / 5);
  const lake = new ShallowWaterSolver({ ...syntheticConfig(cols, rows, z, 0), sources: [{ index: 0, weight: 1 }] });
  for (let k = 0; k < z.length; k++) lake.h[k] = Math.max(0, 50 - z[k]);
  // Keep the lake off the open boundary so nothing drains.
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (r < 2 || c < 2 || r >= rows - 2 || c >= cols - 2) lake.z[r * cols + c] = 100;
  for (let k = 0; k < z.length; k++) if (lake.z[k] >= 100) lake.h[k] = 0;
  (lake as unknown as { r0: number; r1: number; c0: number; c1: number }).r0 = 0;
  (lake as unknown as { r1: number }).r1 = rows - 1;
  (lake as unknown as { c0: number }).c0 = 0;
  (lake as unknown as { c1: number }).c1 = cols - 1;
  const v0 = lake.measure().storedVolume;
  while (lake.t < 1800) lake.step(1800 - lake.t);
  let maxDev = 0;
  for (let k = 0; k < z.length; k++) if (lake.h[k] > 0) maxDev = Math.max(maxDev, Math.abs(lake.z[k] + lake.h[k] - 50));
  const v1 = lake.measure().storedVolume;
  check(maxDev < 1e-6, `lake at rest stays flat (max surface deviation ${maxDev.toExponential(2)} m)`);
  check(Math.abs(v1 - v0) / v0 < 1e-12, `lake at rest conserves volume (relative change ${(Math.abs(v1 - v0) / v0).toExponential(2)})`);

  // Mass conservation with inflow on a tilted, rough plane that drains through the edges.
  const zt = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) zt[r * cols + c] = 100 - c * 0.3 + 2 * Math.sin(r / 3);
  const messages: WorkerOutbound[] = [];
  const rt = new EngineRuntime(syntheticConfig(cols, rows, zt, 800), (m) => messages.push(m));
  while (!rt.runSlice(1e9));
  const mb = rt.massBalance();
  check(Math.abs(mb.error) / mb.inflow < 1e-9, `inflow = stored + outflow (relative error ${(Math.abs(mb.error) / mb.inflow).toExponential(2)})`);
  check(mb.outflow > 0, `water leaves through the open boundary (${(mb.outflow / 1e6).toFixed(2)} of ${(mb.inflow / 1e6).toFixed(2)} Mm³)`);

  const ritter = ritterBenchmark();
  check(ritter.pass, `${ritter.name}: ${ritter.detail}`);
  const stoker = stokerBenchmark();
  check(stoker.pass, `${stoker.name}: ${stoker.detail}`);
}

async function scenarioRun(id: string, engines: EngineId[], durationOverride: number | null, resolution: Resolution) {
  const scenario = JSON.parse(await readFile(path.join(root, 'public', 'scenarios', `${id}.json`), 'utf8'));
  const buf = await readFile(path.join(root, 'public', scenario.dem.url));
  const dem = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const assets = JSON.parse(await readFile(path.join(root, 'public', scenario.exposure.assetsUrl), 'utf8'));
  const duration = durationOverride ?? scenario.defaults.duration;
  const event = {
    ...defaultEventParams(scenario.event as EventKind, {
      height: scenario.dam.height,
      volumeM3: scenario.dam.volumeMCM * 1e6,
      waterDepth: scenario.dam.waterDepth,
    }, (scenario.defaults.failureMode ?? 'overtopping') as FailureMode),
    ...(scenario.defaults.breachWidth ? { breachWidth: scenario.defaults.breachWidth } : {}),
    ...(scenario.defaults.formationTime ? { formationTime: scenario.defaults.formationTime } : {}),
  };
  const setup = setupSimulation({
    cols: scenario.grid.cols,
    rows: scenario.grid.rows,
    bbox: scenario.bbox,
    dem,
    dam: scenario.dam,
    event,
    manning: scenario.defaults.manning,
    duration,
    resolution,
  });
  const g = gridGeometry({ cols: scenario.grid.cols, rows: scenario.grid.rows, bbox: scenario.bbox });
  const h = setup.hydrograph;
  console.log(`\n${scenario.name} — ${g.cols}×${g.rows} cells at ${g.dx.toFixed(0)}×${g.dy.toFixed(0)} m, ${fmtTime(duration)} simulated`);
  console.log(`  Breach: width ${event.breachWidth} m, formation ${(event.formationTime / 60).toFixed(0)} min, ${event.failureMode}`);
  console.log(`  Hydrograph: peak ${Math.round(h.peak).toLocaleString()} m³/s at ${fmtTime(h.timeToPeak)} (Froehlich 1995 regression: ${h.froehlichPeak ? Math.round(h.froehlichPeak).toLocaleString() : '—'}), released ${(h.volumeReleased / 1e6).toFixed(0)} Mm³`);
  console.log(`  Dam site: bed ${setup.site.bed.elevation.toFixed(0)} m, crest ${setup.site.crestElevation.toFixed(0)} m, ${setup.site.wallCells} wall cells, ${setup.site.sources.length} breach cells, downstream (${setup.site.direction.map((v) => v.toFixed(2)).join(', ')})`);

  const towns = assets.features
    .filter((f: { properties: { kind: string; subtype: string } }) => f.properties.kind === 'settlement' && ['city', 'town'].includes(f.properties.subtype))
    .slice(0, 12);

  const results: Partial<Record<EngineId, SummaryMessage>> = {};
  for (const engine of engines) {
    let summary: SummaryMessage | null = null;
    let frames = 0;
    let peakArea = 0;
    let peakQ = 0;
    let peakQt = 0;
    const t0 = performance.now();
    const rt = new EngineRuntime(setup.configs[engine], (m) => {
      if (m.type === 'summary' && m.final) summary = m;
      if (m.type === 'frame') {
        frames++;
        peakArea = Math.max(peakArea, m.stats.wetArea);
        if (m.stats.inflowRate > peakQ) {
          peakQ = m.stats.inflowRate;
          peakQt = m.t;
        }
      }
    });
    while (!rt.runSlice(1e9));
    const wall = (performance.now() - t0) / 1000;
    const mb = rt.massBalance();
    const info = rt.info();
    console.log(`\n  [${engine.toUpperCase()}] ${info.label}${info.particleVolume ? `, ${Math.round(info.particleVolume).toLocaleString()} m³ per particle` : ''}`);
    console.log(`    wall time ${wall.toFixed(1)} s, ${frames} frames, peak flooded area ${(peakArea / 1e6).toFixed(1)} km²`);
    console.log(`    modelled breach outflow (tailwater-coupled): peak ${Math.round(peakQ).toLocaleString()} m³/s at ${fmtTime(peakQt)}`);
    console.log(`    mass balance: in ${(mb.inflow / 1e6).toFixed(1)} Mm³, out ${(mb.outflow / 1e6).toFixed(1)}, stored ${(mb.stored / 1e6).toFixed(1)}, error ${(Math.abs(mb.error) / Math.max(mb.inflow, 1) * 100).toExponential(2)} %`);
    check(Number.isFinite(mb.error) && Math.abs(mb.error) / Math.max(mb.inflow, 1) < (engine === 'swe' ? 1e-6 : 0.02), `${engine} conserves mass`);
    const s = summary as SummaryMessage | null;
    if (s) {
      results[engine] = s;
      let wet = 0;
      let deepest = 0;
      for (let k = 0; k < s.maxDepth.length; k++) {
        if (s.maxDepth[k] >= 0.1) wet++;
        deepest = Math.max(deepest, s.maxDepth[k]);
      }
      console.log(`    inundated (max envelope) ${(wet * g.cellArea / 1e6).toFixed(1)} km², deepest ${deepest.toFixed(1)} m`);
      check(wet > 50, `${engine} floods the valley`);
      for (const t of towns) {
        const cell = lngLatToCell(g, t.geometry.coordinates[0], t.geometry.coordinates[1]);
        if (!cell) continue;
        console.log(`      ${t.properties.name.padEnd(22)} arrival ${fmtTime(s.arrival[cell.index]).padStart(7)}  max depth ${s.maxDepth[cell.index].toFixed(1).padStart(5)} m`);
      }
    }
  }
  if (results.swe && results.sph) {
    let inter = 0;
    let union = 0;
    for (let k = 0; k < results.swe.maxDepth.length; k++) {
      const a = results.swe.maxDepth[k] >= 0.1;
      const b = results.sph.maxDepth[k] >= 0.1;
      if (a && b) inter++;
      if (a || b) union++;
    }
    console.log(`\n  SWE vs SPH extent agreement (critical success index): ${(inter / Math.max(union, 1)).toFixed(2)}`);
  }
}

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith('--')) ?? 'tehri';
const only = args.includes('--swe') ? ['swe'] : args.includes('--sph') ? ['sph'] : ['swe', 'sph'];
const di = args.indexOf('--duration');
const ri = args.indexOf('--resolution');
syntheticTests();
await scenarioRun(id, only as EngineId[], di >= 0 ? Number(args[di + 1]) : null, (ri >= 0 ? args[ri + 1] : 'standard') as Resolution);
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exitCode = failures === 0 ? 0 : 1;
