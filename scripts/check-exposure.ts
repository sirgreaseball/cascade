// Checks the scenario builder's exposure source: fetchOsmExposure (OpenFreeMap vector tiles plus one
// Nominatim lookup) against the exposure bundled with each scenario, which build-scenario.ts once
// built from Overpass. OpenStreetMap keeps changing, so it checks agreement, not equality. Needs
// the network.
//
//   node scripts/check-exposure.ts             # every bundled scenario
//   node scripts/check-exposure.ts machchhu    # one scenario

import { readFile } from 'node:fs/promises';
import { fetchOsmExposure, type AssetCollection, type RoadCollection } from '../src/lib/osm.ts';

type XY = [number, number];

/** Road km inside the box, and the share of it in the largest network, joined as evacuation.ts joins roads. */
function network(roads: RoadCollection, bbox: number[]): { km: number; largest: number } {
  const key = (p: XY) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let root = k;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(k, root);
    return root;
  };
  for (const f of roads.features) for (const p of f.geometry.coordinates) parent.set(key(p), key(p));
  for (const f of roads.features) {
    const c = f.geometry.coordinates;
    for (let i = 1; i < c.length; i++) parent.set(find(key(c[i - 1])), find(key(c[i])));
  }
  const kx = 111.32 * Math.cos((((bbox[1] + bbox[3]) / 2) * Math.PI) / 180);
  const byNetwork = new Map<string, number>();
  let km = 0;
  for (const f of roads.features) {
    const c = f.geometry.coordinates;
    let inside = 0;
    for (let i = 1; i < c.length; i++) {
      const [x, y] = [(c[i - 1][0] + c[i][0]) / 2, (c[i - 1][1] + c[i][1]) / 2];
      if (x >= bbox[0] && x <= bbox[2] && y >= bbox[1] && y <= bbox[3]) inside += Math.hypot((c[i][0] - c[i - 1][0]) * kx, (c[i][1] - c[i - 1][1]) * 110.574);
    }
    km += inside;
    const root = find(key(c[0]));
    byNetwork.set(root, (byNetwork.get(root) ?? 0) + inside);
  }
  return { km, largest: Math.max(...byNetwork.values()) / km };
}

const settlements = (a: AssetCollection) => a.features.filter((f) => f.properties.kind === 'settlement');
const people = (a: AssetCollection) => settlements(a).reduce((s, f) => s + f.properties.population, 0);
const facilities = (a: AssetCollection) => a.features.filter((f) => ['hospital', 'school', 'emergency'].includes(f.properties.kind)).length;
const bridges = (a: AssetCollection) => a.features.filter((f) => f.properties.kind === 'bridge');
const near = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance * Math.max(a, b);

let failed = false;
for (const id of process.argv.length > 2 ? process.argv.slice(2) : ['bhakra', 'machchhu', 'rishi-ganga', 'tehri']) {
  const { bbox } = JSON.parse(await readFile(`public/scenarios/${id}.json`, 'utf8'));
  const bundled = {
    assets: JSON.parse(await readFile(`public/data/${id}/assets.geojson`, 'utf8')) as AssetCollection,
    roads: JSON.parse(await readFile(`public/data/${id}/roads.geojson`, 'utf8')) as RoadCollection,
  };
  const started = performance.now();
  const tiles = await fetchOsmExposure(bbox);
  const seconds = (performance.now() - started) / 1000;
  const names = new Set(settlements(tiles.assets).map((f) => f.properties.name));
  const found = settlements(bundled.assets).filter((f) => names.has(f.properties.name)).length / settlements(bundled.assets).length;
  const [was, now] = [network(bundled.roads, bbox), network(tiles.roads, bbox)];
  // A bridge counted twice (one way split into several lines) inflates "bridges under water". The
  // tiles merge a bridge mapped as consecutive ways into one, so fewer is fine; missing is not.
  const tileBridges = bridges(tiles.assets);
  const repeats = tileBridges.length - new Set(tileBridges.map((f) => f.properties.id)).size;
  const kx = 111_320 * Math.cos((((bbox[1] + bbox[3]) / 2) * Math.PI) / 180);
  const bridgeVertices = tiles.roads.features.filter((f) => f.properties.bridge).flatMap((f) => f.geometry.coordinates);
  const missed = bridges(bundled.assets).filter(({ geometry: { coordinates: [x, y] } }) => !bridgeVertices.some(([u, v]) => Math.hypot((u - x) * kx, (v - y) * 110_574) < 50)).length;
  const checks: [string, boolean][] = [
    [`settlements ${settlements(tiles.assets).length} (bundled ${settlements(bundled.assets).length}, ${(found * 100).toFixed(0)}% of its names found)`, found >= 0.95],
    [`people ${people(tiles.assets)} (bundled ${people(bundled.assets)})`, near(people(tiles.assets), people(bundled.assets), 0.1)],
    [`facilities ${facilities(tiles.assets)} (bundled ${facilities(bundled.assets)})`, near(facilities(tiles.assets), facilities(bundled.assets), 0.1)],
    [`bridges ${tileBridges.length} (bundled ${bridges(bundled.assets).length}, ${missed} of them not on a tile bridge), ${repeats} repeating a way`, repeats === 0 && missed <= 0.05 * bridges(bundled.assets).length],
    [`road km ${now.km.toFixed(0)} (bundled ${was.km.toFixed(0)})`, near(now.km, was.km, 0.05)],
    [`largest road network ${(now.largest * 100).toFixed(0)}% (bundled ${(was.largest * 100).toFixed(0)}%)`, now.largest >= was.largest - 0.05],
  ];
  console.log(`${id}: ${seconds.toFixed(1)} s`);
  for (const [label, ok] of checks) console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`);
  failed ||= checks.some(([, ok]) => !ok);
}
process.exit(failed ? 1 : 0);
