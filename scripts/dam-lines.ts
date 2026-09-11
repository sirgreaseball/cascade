// Aligns bundled dam-break scenarios with the real dam: looks up each dam's crest in
// OpenStreetMap and stores it as dam.crestLine in public/scenarios/<id>.json.
//   node scripts/dam-lines.ts [id …]

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchDamLine } from '../src/lib/osm.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const index: { id: string }[] = JSON.parse(await readFile(path.join(root, 'public', 'scenarios', 'index.json'), 'utf8'));
const ids = process.argv.length > 2 ? process.argv.slice(2) : index.map((m) => m.id);

for (const id of ids) {
  const file = path.join(root, 'public', 'scenarios', `${id}.json`);
  const scenario = JSON.parse(await readFile(file, 'utf8'));
  if (scenario.event === 'lake-outburst') {
    console.log(`${id}: lake outburst, no dam to align`);
    continue;
  }
  let line: [number, number][] | null;
  try {
    line = await fetchDamLine(scenario.dam.lng, scenario.dam.lat, scenario.dam.crestLength);
  } catch (err) {
    console.log(`${id}: OpenStreetMap lookup failed (${err instanceof Error ? err.message : err}); left unchanged`);
    continue;
  }
  scenario.dam.crestLine = line;
  await writeFile(file, JSON.stringify(scenario, null, 2) + '\n');
  if (!line) {
    console.log(`${id}: no dam mapped in OpenStreetMap near the site; the axis will be detected from the DEM`);
    continue;
  }
  const k = 111_320 * Math.cos((line[0][1] * Math.PI) / 180);
  let length = 0;
  for (let i = 1; i < line.length; i++) length += Math.hypot((line[i][0] - line[i - 1][0]) * k, (line[i][1] - line[i - 1][1]) * 110_574);
  console.log(`${id}: crest line of ${line.length} points, ${Math.round(length)} m (catalogue crest ${scenario.dam.crestLength} m)`);
}
