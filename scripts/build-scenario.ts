// Builds the offline data for bundled scenarios: the DEM grid (from AWS Terrain Tiles,
// SRTM-derived) and exposure layers (from OpenStreetMap via Overpass). Uses the exact same
// sampling and parsing code as the in-app scenario builder.
//
//   node scripts/build-scenario.ts            # every scenario in public/scenarios/index.json
//   node scripts/build-scenario.ts tehri      # one scenario
//   node scripts/build-scenario.ts tehri --no-osm
//
// Requires Node 22.18+ (built-in TypeScript type stripping).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { gridForBBox } from '../src/lib/geo/grid.ts';
import { sampleTerrariumGrid, TERRARIUM_ATTRIBUTION, TERRARIUM_URL } from '../src/lib/geo/terrarium.ts';
import { fetchOsmExposure, OSM_ATTRIBUTION } from '../src/lib/osm.ts';
import { decodePng } from './lib/png.ts';

const root = path.resolve(import.meta.dirname, '..');
const cacheDir = path.join(root, 'scripts', '.cache', 'terrarium');

async function fetchTile(z: number, x: number, y: number) {
  const file = path.join(cacheDir, `${z}-${x}-${y}.png`);
  let bytes: Uint8Array;
  if (existsSync(file)) {
    bytes = await readFile(file);
  } else {
    const url = TERRARIUM_URL.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
    let res: Response | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        res = await fetch(url);
        if (res.ok) break;
      } catch (err) {
        if (attempt === 4) console.warn(`  tile ${z}/${x}/${y}: ${(err as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
    if (!res || !res.ok) {
      console.warn(`  tile ${z}/${x}/${y} failed (${res?.status ?? 'network error'})`);
      return null;
    }
    bytes = new Uint8Array(await res.arrayBuffer());
    await mkdir(cacheDir, { recursive: true });
    await writeFile(file, bytes);
  }
  const png = decodePng(bytes);
  return { width: png.width, height: png.height, data: png.data, channels: png.channels };
}

async function build(id: string, withOsm: boolean) {
  const jsonPath = path.join(root, 'public', 'scenarios', `${id}.json`);
  const scenario = JSON.parse(await readFile(jsonPath, 'utf8'));
  const spec = gridForBBox(scenario.bbox, scenario.cellSize);
  const outDir = path.join(root, 'public', 'data', id);
  await mkdir(outDir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);

  console.log(`\n▸ ${scenario.name}: ${spec.cols} × ${spec.rows} cells (${(spec.cols * spec.rows).toLocaleString()})`);
  let lastPct = -1;
  const { elevation, zoom, missingTiles } = await sampleTerrariumGrid(spec, fetchTile, {
    concurrency: 4,
    onProgress: ({ loaded, total }) => {
      const pct = Math.floor((loaded / total) * 10) * 10;
      if (pct !== lastPct) {
        lastPct = pct;
        process.stdout.write(`  DEM tiles ${loaded}/${total}\r`);
      }
    },
  });
  if (missingTiles > 0) throw new Error(`${missingTiles} DEM tiles could not be downloaded; rerun to retry (downloaded tiles are cached).`);
  let min = Infinity;
  let max = -Infinity;
  for (const v of elevation) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  await writeFile(path.join(outDir, 'elevation.bin'), new Uint8Array(elevation.buffer));
  console.log(`  DEM z${zoom}: ${min.toFixed(0)}–${max.toFixed(0)} m, ${missingTiles} missing tiles`);

  scenario.grid = { cols: spec.cols, rows: spec.rows };
  scenario.dem = {
    url: `/data/${id}/elevation.bin`,
    source: `${TERRARIUM_ATTRIBUTION}, zoom ${zoom}, box-filtered to ${scenario.cellSize} m`,
    retrieved: today,
    min: Math.round(min),
    max: Math.round(max),
  };

  if (withOsm) {
    const { assets, roads } = await fetchOsmExposure(scenario.bbox, fetch, undefined, (m) => console.log(`  ${m}`));
    await writeFile(path.join(outDir, 'assets.geojson'), JSON.stringify(assets));
    await writeFile(path.join(outDir, 'roads.geojson'), JSON.stringify(roads));
    const counts = assets.features.reduce<Record<string, number>>((acc, f) => {
      acc[f.properties.kind] = (acc[f.properties.kind] ?? 0) + 1;
      return acc;
    }, {});
    console.log(`  OSM: ${JSON.stringify(counts)}, ${roads.features.length} road ways`);
    scenario.exposure = {
      assetsUrl: `/data/${id}/assets.geojson`,
      roadsUrl: `/data/${id}/roads.geojson`,
      source: `${OSM_ATTRIBUTION} (Overpass API)`,
      retrieved: today,
    };
  }
  await writeFile(jsonPath, JSON.stringify(scenario, null, 2) + '\n');
}

const args = process.argv.slice(2);
const withOsm = !args.includes('--no-osm');
let ids = args.filter((a) => !a.startsWith('--'));
if (ids.length === 0) {
  const index = JSON.parse(await readFile(path.join(root, 'public', 'scenarios', 'index.json'), 'utf8'));
  ids = index.map((s: { id: string }) => s.id);
}
for (const id of ids) await build(id, withOsm);
console.log('\nDone.');
