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

async function bitmap(url: string, signal?: AbortSignal): Promise<ImageBitmap> {
  const res = await fetch(url, { signal, mode: 'cors' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
}

// Decoded zoom-15 heights, shared by the (up to 16) deeper tiles cut from each.
const heightCache = new Map<string, Promise<Float32Array>>();

function parentHeights(url: string): Promise<Float32Array> {
  let p = heightCache.get(url);
  if (!p) {
    p = bitmap(url).then((img) => {
      const canvas = new OffscreenCanvas(256, 256);
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0, 256, 256);
      img.close();
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
async function deeperTerrarium(template: string, x: number, y: number, z: number): Promise<string> {
  const k = z - TERRARIUM_MAX_ZOOM;
  const n = 1 << k;
  const px = x >> k;
  const py = y >> k;
  const h = await parentHeights(fill(template, px, py, TERRARIUM_MAX_ZOOM));
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
    const tiles = await Promise.all(
      [0, 1].flatMap((dy) => [0, 1].map((dx) => bitmap(fill(template, x * 2 + dx, y * 2 + dy, z + 1), signal).then((img) => ({ img, dx, dy })))),
    );
    for (const { img, dx, dy } of tiles) {
      ctx.drawImage(img, dx * 256, dy * 256, 256, 256);
      img.close();
    }
  } else {
    // Past the imagery's last zoom: enlarge the matching part of its deepest tile.
    const k = z - maxZoom;
    const n = 1 << k;
    const px = x >> k;
    const py = y >> k;
    const img = await bitmap(fill(template, px, py, maxZoom), signal);
    const size = 256 / n;
    ctx.drawImage(img, (x - px * n) * size, (y - py * n) * size, size, size, 0, 0, 512, 512);
    img.close();
  }
  return canvas.transferToImageBitmap();
}

type TileLoad = Parameters<TerrainLayer['getTiledTerrainData']>[0];

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

    const terrain = (z <= TERRARIUM_MAX_ZOOM ? Promise.resolve(fill(elevationTemplate, x, y, z)) : deeperTerrarium(elevationTemplate, x, y, z)).then((url) => {
      const mesh = this.loadTerrain({ elevationData: url, bounds, elevationDecoder, meshMaxError, signal } as never);
      if (url.startsWith('blob:')) {
        // Free the cut-out image whether the tile loads or is cancelled (a cancelled load must
        // not surface as an unhandled rejection).
        const revoke = () => URL.revokeObjectURL(url);
        Promise.resolve(mesh).then(revoke, revoke);
      }
      return mesh;
    });
    const template = typeof texture === 'string' ? texture : null;
    const surface = template
      ? stitchedTexture(template, x, y, z, textureMaxZoom, signal).catch(() => bitmap(fill(template, x, y, Math.min(z, textureMaxZoom)), signal).catch(() => null))
      : Promise.resolve(null);
    return Promise.all([terrain, surface]);
  }
}
