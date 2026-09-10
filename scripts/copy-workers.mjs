// Copies loaders.gl's self-contained terrain worker into public/ so the 3D terrain meshes tiles
// off the main thread from our own origin (no CDN, works offline). Runs on install, dev and build.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'node_modules', '@loaders.gl', 'terrain', 'dist', 'terrain-worker.js');
const dest = path.join(root, 'public', 'workers', 'terrain-worker.js');
if (existsSync(src)) {
  mkdirSync(path.dirname(dest), { recursive: true });
  copyFileSync(src, dest);
} else {
  console.warn('[cascade] @loaders.gl/terrain worker not found; 3D terrain will mesh on the main thread.');
}
