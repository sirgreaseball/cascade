// Textures for the 3D terrain: the scenario DEM re-encoded as a Terrarium PNG (so the mesh is
// exactly the surface the solvers use), draped with either a satellite snapshot of the study
// area or, offline, a locally computed hillshade.

import { encodeTerrariumRGBA, latToTileY, lngToTileX } from '@/lib/geo/terrarium';
import type { GridGeometry } from '@/lib/geo/grid';

export const IMAGERY_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
export const IMAGERY_ATTRIBUTION = 'Imagery © Esri, Maxar, Earthstar Geographics';
/** Monochrome dark-grey map (Esri Dark Gray Canvas, no key needed): the Map basemap, 2D and 3D. */
export const MAP_TILES_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}';
/** Place names and boundaries drawn over the dark-grey map in 2D. */
export const MAP_LABELS_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}';
export const MAP_ATTRIBUTION = 'Map © Esri, HERE, Garmin, © OpenStreetMap contributors';

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function terrariumDataUrl(dem: Float32Array, cols: number, rows: number): string {
  const c = canvas(cols, rows);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(cols, rows);
  encodeTerrariumRGBA(dem, img.data);
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

/** Soft hillshade with a gentle hypsometric tint, for offline use. */
export function hillshadeDataUrl(dem: Float32Array, g: GridGeometry): string {
  const { cols, rows, dx, dy } = g;
  const c = canvas(cols, rows);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(cols, rows);
  let zMin = Infinity;
  let zMax = -Infinity;
  for (const v of dem) {
    if (v < zMin) zMin = v;
    if (v > zMax) zMax = v;
  }
  const az = (315 * Math.PI) / 180;
  const alt = (45 * Math.PI) / 180;
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const k = r * cols + col;
      const zl = dem[r * cols + Math.max(col - 1, 0)];
      const zr = dem[r * cols + Math.min(col + 1, cols - 1)];
      const zu = dem[Math.max(r - 1, 0) * cols + col];
      const zd = dem[Math.min(r + 1, rows - 1) * cols + col];
      const gx = (zr - zl) / (2 * dx);
      const gy = (zd - zu) / (2 * dy);
      const slope = Math.atan(Math.hypot(gx, gy));
      const aspect = Math.atan2(gy, -gx);
      const shade = Math.max(0, Math.cos(alt) * Math.cos(slope) + Math.sin(alt) * Math.sin(slope) * Math.cos(az - aspect));
      const t = (dem[k] - zMin) / Math.max(zMax - zMin, 1);
      const base = [226 - 30 * t, 224 - 22 * t, 214 - 8 * t];
      const light = 0.55 + 0.45 * shade;
      const o = k * 4;
      img.data[o] = base[0] * light;
      img.data[o + 1] = base[1] * light;
      img.data[o + 2] = base[2] * light;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const up = canvas(cols * 2, rows * 2);
  const uctx = up.getContext('2d')!;
  uctx.imageSmoothingQuality = 'high';
  uctx.drawImage(c, 0, 0, up.width, up.height);
  return up.toDataURL('image/jpeg', 0.9);
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Stitches imagery tiles over the bbox and resamples rows from Web Mercator to the grid's
 * linear-latitude rows, so the texture registers exactly with the DEM mesh.
 */
export async function satelliteDataUrl(bbox: [number, number, number, number], maxPx = 2048): Promise<string | null> {
  let z = 15;
  while (z > 8 && (lngToTileX(bbox[2], z) - lngToTileX(bbox[0], z)) * 256 > maxPx) z--;
  const fx0 = lngToTileX(bbox[0], z);
  const fx1 = lngToTileX(bbox[2], z);
  const fy0 = latToTileY(bbox[3], z);
  const fy1 = latToTileY(bbox[1], z);
  const tx0 = Math.floor(fx0);
  const tx1 = Math.floor(fx1);
  const ty0 = Math.floor(fy0);
  const ty1 = Math.floor(fy1);
  const stitched = canvas((tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256);
  const sctx = stitched.getContext('2d')!;
  const jobs: Promise<boolean>[] = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const url = IMAGERY_URL.replace('{z}', String(z)).replace('{x}', String(tx)).replace('{y}', String(ty));
      jobs.push(
        loadImage(url).then((img) => {
          if (!img) return false;
          sctx.drawImage(img, (tx - tx0) * 256, (ty - ty0) * 256);
          return true;
        }),
      );
    }
  }
  const loaded = await Promise.all(jobs);
  if (loaded.filter(Boolean).length < loaded.length * 0.7) return null;

  const outW = Math.round((fx1 - fx0) * 256);
  const midLat = (bbox[1] + bbox[3]) / 2;
  const aspect = (bbox[3] - bbox[1]) / ((bbox[2] - bbox[0]) * Math.cos((midLat * Math.PI) / 180));
  const outH = Math.round(outW * aspect);
  const out = canvas(outW, outH);
  const octx = out.getContext('2d')!;
  const sx = (fx0 - tx0) * 256;
  const sw = (fx1 - fx0) * 256;
  for (let j = 0; j < outH; j++) {
    const lat = bbox[3] - ((j + 0.5) / outH) * (bbox[3] - bbox[1]);
    const sy = (latToTileY(lat, z) - ty0) * 256;
    octx.drawImage(stitched, sx, Math.floor(sy), sw, 1, 0, j, outW, 1);
  }
  try {
    return out.toDataURL('image/jpeg', 0.88);
  } catch {
    return null;
  }
}
