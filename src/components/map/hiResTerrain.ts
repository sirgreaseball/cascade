// 3D terrain with imagery down to about half a metre per pixel.
//
// deck.gl's TerrainLayer drapes one 256-px image over each 512-px terrain tile and stops at the
// elevation data's last zoom, so close up the imagery was stretched 4–8 times. This layer:
//  · goes deeper than the elevation data: tiles past Terrarium's zoom 15 cut their heights out
//    of the zoom-15 tile (bilinear, re-encoded as Terrarium), so the mesh stays smooth;
//  · stitches each tile's texture from the 2 × 2 imagery tiles one zoom deeper, up to the
//    imagery's last real zoom, so a 512-px tile carries 512 px of imagery.
// Anything that fails falls back to TerrainLayer's plain single-image tile.

import { TerrainLayer } from '@deck.gl/geo-layers';

/** Last zoom of the AWS Terrarium elevation tiles. */
const TERRARIUM_MAX_ZOOM = 15;
/** As in TerrainLayer: tiles overlap by one pixel so their meshes leave no cracks. */
const TILE_OVERLAP_PIXELS = 1;

const fill = (template: string, x: number, y: number, z: number) => template.replace('{x}', String(x)).replace('{y}', String(y)).replace('{z}', String(z));

async function bitmapWithRetry(url: string, signal?: AbortSignal, maxRetries = 2): Promise<ImageBitmap> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, { signal, mode: 'cors' });
      if (res.ok) {
        const blob = await res.blob();
        return await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      }
      if (res.status === 404) throw new Error(`HTTP 404`);
      if (attempt < maxRetries && (res.status === 429 || res.status >= 500)) {
        await new Promise((r) => setTimeout(r, 120 * (attempt + 1)));
        continue;
      }
      throw new Error(`HTTP ${res.status}`);
    } catch (err: unknown) {
      if ((err as Error)?.name === 'AbortError' || signal?.aborted) throw err;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 120 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Tile fetch failed');
}

// In-flight promise map and LRU cache for tile bitmaps
const tileBitmapCache = new Map<string, Promise<ImageBitmap>>();

function cachedBitmap(url: string, signal?: AbortSignal): Promise<ImageBitmap> {
  let p = tileBitmapCache.get(url);
  if (!p) {
    p = bitmapWithRetry(url, signal);
    tileBitmapCache.set(url, p);
    p.catch(() => tileBitmapCache.delete(url));
    if (tileBitmapCache.size > 240) {
      tileBitmapCache.delete(tileBitmapCache.keys().next().value as string);
    }
  }
  return p;
}

let fallbackSatelliteBitmap: ImageBitmap | null = null;
let fallbackMapBitmap: ImageBitmap | null = null;

/** Natural terrain color texture when all network tile attempts fail, so deck.gl never renders untextured pure white geometry. */
function getFallbackTexture(isSatellite: boolean): ImageBitmap {
  if (isSatellite && fallbackSatelliteBitmap) return fallbackSatelliteBitmap;
  if (!isSatellite && fallbackMapBitmap) return fallbackMapBitmap;
  const canvas = new OffscreenCanvas(64, 64);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = isSatellite ? '#384435' : '#1c1f24';
  ctx.fillRect(0, 0, 64, 64);
  const bmp = canvas.transferToImageBitmap();
  if (isSatellite) fallbackSatelliteBitmap = bmp;
  else fallbackMapBitmap = bmp;
  return bmp;
}

// Decoded zoom-15 heights, shared by the (up to 16) deeper tiles cut from each.
const heightCache = new Map<string, Promise<Float32Array>>();

function parentHeights(url: string, signal?: AbortSignal): Promise<Float32Array> {
  let p = heightCache.get(url);
  if (!p) {
    p = cachedBitmap(url, signal).then((img) => {
      const canvas = new OffscreenCanvas(256, 256);
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0, 256, 256);
      const d = ctx.getImageData(0, 0, 256, 256).data;
      const h = new Float32Array(256 * 256);
      for (let i = 0; i < h.length; i++) h[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
      return h;
    });
    heightCache.set(url, p);
    p.catch(() => heightCache.delete(url));
    if (heightCache.size > 48) heightCache.delete(heightCache.keys().next().value as string);
  }
  return p;
}

/** A Terrarium PNG (as an object URL) for a tile deeper than the elevation data goes. */
async function deeperTerrarium(template: string, x: number, y: number, z: number, signal?: AbortSignal): Promise<string> {
  const k = z - TERRARIUM_MAX_ZOOM;
  const n = 1 << k;
  const px = x >> k;
  const py = y >> k;
  const h = await parentHeights(fill(template, px, py, TERRARIUM_MAX_ZOOM), signal);
  const ox = ((x - px * n) * 256) / n;
  const oy = ((y - py * n) * 256) / n;
  const step = 1 / n;
  const canvas = new OffscreenCanvas(256, 256);
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(256, 256);
  const d = img.data;
  for (let j = 0; j < 256; j++) {
    const sy = Math.min(255, Math.max(0, oy + (j + 0.5) * step - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(255, y0 + 1);
    const fy = sy - y0;
    for (let i = 0; i < 256; i++) {
      const sx = Math.min(255, Math.max(0, ox + (i + 0.5) * step - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(255, x0 + 1);
      const fx = sx - x0;
      const top = h[y0 * 256 + x0] * (1 - fx) + h[y0 * 256 + x1] * fx;
      const bottom = h[y1 * 256 + x0] * (1 - fx) + h[y1 * 256 + x1] * fx;
      const v = top * (1 - fy) + bottom * fy + 32768;
      const r = Math.floor(v / 256);
      const g = Math.floor(v - r * 256);
      const o = (j * 256 + i) * 4;
      d[o] = r;
      d[o + 1] = g;
      d[o + 2] = Math.floor((v - r * 256 - g) * 256);
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return URL.createObjectURL(await canvas.convertToBlob({ type: 'image/png' }));
}

/** The tile's texture from the imagery one zoom deeper (2 × 2 tiles), or scaled up from the imagery's last zoom. */
async function stitchedTexture(template: string, x: number, y: number, z: number, maxZoom: number, signal?: AbortSignal): Promise<ImageBitmap> {
  const canvas = new OffscreenCanvas(512, 512);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  if (z + 1 <= maxZoom) {
    const subCoords = [
      { dx: 0, dy: 0, sx: x * 2, sy: y * 2 },
      { dx: 1, dy: 0, sx: x * 2 + 1, sy: y * 2 },
      { dx: 0, dy: 1, sx: x * 2, sy: y * 2 + 1 },
      { dx: 1, dy: 1, sx: x * 2 + 1, sy: y * 2 + 1 },
    ];
    const results = await Promise.allSettled(
      subCoords.map(async ({ dx, dy, sx, sy }) => {
        const img = await cachedBitmap(fill(template, sx, sy, z + 1), signal);
        return { img, dx, dy };
      }),
    );

    let anyDrawn = false;
    let anyMissing = false;
    for (let i = 0; i < results.length; i++) {
      const res = results[i];
      if (res.status === 'fulfilled') {
        const { img, dx, dy } = res.value;
        ctx.drawImage(img, dx * 256, dy * 256, 256, 256);
        anyDrawn = true;
      } else {
        anyMissing = true;
      }
    }

    if (!anyMissing) {
      return canvas.transferToImageBitmap();
    }

    // For any missing quadrant, sample from the parent tile at zoom z
    try {
      const parentImg = await cachedBitmap(fill(template, x, y, Math.min(z, maxZoom)), signal);
      for (let i = 0; i < results.length; i++) {
        if (results[i].status !== 'fulfilled') {
          const { dx, dy } = subCoords[i];
          ctx.drawImage(parentImg, dx * 128, dy * 128, 128, 128, dx * 256, dy * 256, 256, 256);
        }
      }
      return canvas.transferToImageBitmap();
    } catch {
      if (anyDrawn) return canvas.transferToImageBitmap();
      throw new Error('All sub-tiles and zoom z tile failed');
    }
  } else {
    // Past the imagery's last zoom: enlarge the matching part of its deepest tile.
    const k = z - maxZoom;
    const n = 1 << k;
    const px = x >> k;
    const py = y >> k;
    const img = await cachedBitmap(fill(template, px, py, maxZoom), signal);
    const size = 256 / n;
    ctx.drawImage(img, (x - px * n) * size, (y - py * n) * size, size, size, 0, 0, 512, 512);
    return canvas.transferToImageBitmap();
  }
}

/** Sharp, filtered imagery at grazing angles: trilinear mipmaps with 16× anisotropy. */
const TEXTURE_PARAMETERS = {
  minFilter: 'linear',
  magFilter: 'linear',
  mipmapFilter: 'linear',
  addressModeU: 'clamp-to-edge',
  addressModeV: 'clamp-to-edge',
  maxAnisotropy: 16,
};

type Mesh = {
  attributes: { POSITION: { value: Float32Array }; NORMAL?: { value: Float32Array; size: number } };
  indices?: { value: Uint32Array | Uint16Array };
};

/**
 * Per-vertex normals for a terrain tile, so it is lit as a smooth surface rather than triangle
 * by triangle (deck.gl falls back to flat shading without them, which drew every facet). Computed
 * in metres east, north and up — the space deck.gl's project_normal expects. Near-vertical
 * triangles (the skirts that hide seams between tiles) are left out and skirt bottoms point up,
 * so skirts are lit like the ground next to them instead of showing as dark slivers.
 */
function addNormals(mesh: Mesh | null, metresPerUnit: number): Mesh | null {
  const idx = mesh?.indices?.value;
  if (!mesh || !idx) return mesh;
  const pos = mesh.attributes.POSITION.value;
  const acc = new Float32Array(pos.length);
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const a = idx[t] * 3;
    const b = idx[t + 1] * 3;
    const c = idx[t + 2] * 3;
    const e1x = (pos[b] - pos[a]) * metresPerUnit;
    const e1y = (pos[b + 1] - pos[a + 1]) * metresPerUnit;
    const e1z = pos[b + 2] - pos[a + 2];
    const e2x = (pos[c] - pos[a]) * metresPerUnit;
    const e2y = (pos[c + 1] - pos[a + 1]) * metresPerUnit;
    const e2z = pos[c + 2] - pos[a + 2];
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz);
    if (len === 0) continue;
    if (nz < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    if (nz / len < 0.2) continue;
    // Area-weighted: larger triangles count for more.
    for (const v of [a, b, c]) {
      acc[v] += nx;
      acc[v + 1] += ny;
      acc[v + 2] += nz;
    }
  }
  for (let v = 0; v < acc.length; v += 3) {
    const len = Math.hypot(acc[v], acc[v + 1], acc[v + 2]);
    if (len > 0) {
      acc[v] /= len;
      acc[v + 1] /= len;
      acc[v + 2] /= len;
    } else {
      acc[v + 2] = 1;
    }
  }
  mesh.attributes.NORMAL = { value: acc, size: 3 };
  return mesh;
}

type TileLoad = Parameters<TerrainLayer['getTiledTerrainData']>[0];
type SubLayerProps = Parameters<TerrainLayer['renderSubLayers']>[0];

export class HiResTerrainLayer extends TerrainLayer<{ textureMaxZoom?: number }> {
  static layerName = 'HiResTerrainLayer';

  // Replaces TerrainLayer's loader; deck's declared return type is internal, hence `any`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getTiledTerrainData(tile: TileLoad): any {
    const { elevationData, texture, elevationDecoder, meshMaxError, tileSize } = this.props;
    const textureMaxZoom = this.props.textureMaxZoom ?? 18;
    const { x, y, z } = tile.index;
    const { signal } = tile;
    const { viewport } = this.context;
    // Map tiles are always geographic here.
    const bbox = tile.bbox as { west: number; south: number; east: number; north: number };
    const bl = viewport.projectFlat([bbox.west, bbox.south]);
    const tr = viewport.projectFlat([bbox.east, bbox.north]);
    const xPad = ((tr[0] - bl[0]) / tileSize) * TILE_OVERLAP_PIXELS;
    const yPad = ((tr[1] - bl[1]) / tileSize) * TILE_OVERLAP_PIXELS;
    const bounds = [bl[0] - xPad, bl[1] - yPad, tr[0] + xPad, tr[1] + yPad];
    const elevationTemplate = elevationData as string;
    // Metres per projected unit across this tile, for the normals.
    const midLat = ((bbox.north + bbox.south) / 2) * (Math.PI / 180);
    const metresPerUnit = ((bbox.east - bbox.west) * 111_320 * Math.cos(midLat)) / Math.max(tr[0] - bl[0], 1e-12);
    // Finer meshes near the camera (deep tiles), coarser far away: the error doubles every two
    // zoom levels above Terrarium's last.
    const tileError = (meshMaxError as number) * 2 ** (Math.max(0, TERRARIUM_MAX_ZOOM - z) / 2);

    const terrain = (z <= TERRARIUM_MAX_ZOOM ? Promise.resolve(fill(elevationTemplate, x, y, z)) : deeperTerrarium(elevationTemplate, x, y, z, signal))
      .then((url) => {
        const mesh = Promise.resolve(this.loadTerrain({ elevationData: url, bounds, elevationDecoder, meshMaxError: tileError, signal } as never)).then((m) =>
          addNormals(m as unknown as Mesh | null, metresPerUnit),
        );
        if (url.startsWith('blob:')) {
          // Free the cut-out image whether the tile loads or is cancelled (a cancelled load must
          // not surface as an unhandled rejection).
          const revoke = () => URL.revokeObjectURL(url);
          Promise.resolve(mesh).then(revoke, revoke);
        }
        return mesh;
      })
      .catch((err) => {
        if (signal?.aborted || (err as Error)?.name === 'AbortError') throw err;
        // If a deeper terrarium tile fails, fall back to zoom 15 elevation
        if (z > TERRARIUM_MAX_ZOOM) {
          const k = z - TERRARIUM_MAX_ZOOM;
          const px = x >> k;
          const py = y >> k;
          const fallbackUrl = fill(elevationTemplate, px, py, TERRARIUM_MAX_ZOOM);
          return Promise.resolve(this.loadTerrain({ elevationData: fallbackUrl, bounds, elevationDecoder, meshMaxError: tileError, signal } as never)).then((m) =>
            addNormals(m as unknown as Mesh | null, metresPerUnit),
          );
        }
        throw err;
      });

    const template = typeof texture === 'string' ? texture : null;
    const isSatellite = template ? template.includes('World_Imagery') : false;
    const surface = template
      ? stitchedTexture(template, x, y, z, textureMaxZoom, signal)
          .catch(() => cachedBitmap(fill(template, x, y, Math.min(z, textureMaxZoom)), signal))
          .catch(() => {
            const pz = Math.max(0, z - 1);
            const px = x >> 1;
            const py = y >> 1;
            return cachedBitmap(fill(template, px, py, Math.min(pz, textureMaxZoom)), signal);
          })
          .catch(() => getFallbackTexture(isSatellite))
      : Promise.resolve(null);
    return Promise.all([terrain, surface]);
  }

  renderSubLayers(props: SubLayerProps) {
    const layer = super.renderSubLayers(props);
    return layer ? layer.clone({ textureParameters: TEXTURE_PARAMETERS } as never) : layer;
  }
}
