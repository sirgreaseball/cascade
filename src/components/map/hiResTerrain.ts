// 3D terrain with imagery down to about half a metre per pixel.
//
// deck.gl's TerrainLayer drapes one 256-px image over each 512-px terrain tile and stops at the
// elevation data's last zoom, so close up the imagery was stretched 4–8 times. This layer:
//  · goes deeper than the elevation data: tiles past Terrarium's zoom 15 cut their heights out
//    of the zoom-15 tile (bilinear, re-encoded as Terrarium), so the mesh stays smooth;
//  · stitches each tile's texture from the 2 × 2 imagery tiles one zoom deeper, up to the
//    imagery's last real zoom, so a 512-px tile carries 512 px of imagery.
//
// And it never leaves a tile blank. Downloads share one queue per server that retries transient
// failures and cancels a download only once no tile still wants it (one tile scrolling away used
// to cancel images its neighbours were waiting for). A tile whose imagery or heights cannot be
// fetched is drawn from coarser data, marked low quality and reloaded once the missing pieces
// arrive. A tile the camera has left is rejected rather than resolved: deck.gl keeps any tile that
// resolves as finished, which is how blank squares used to stick until the tile left the cache.

import type { Layer } from '@deck.gl/core';
import { TerrainLayer } from '@deck.gl/geo-layers';
import { terrainStats } from '@/lib/perfMonitor';

/** Last zoom of the AWS Terrarium elevation tiles. */
const TERRARIUM_MAX_ZOOM = 15;
/** As in TerrainLayer: tiles overlap by one pixel so their meshes leave no cracks. */
const TILE_OVERLAP_PIXELS = 1;
/** Downloads in flight per server: fills the view quickly without inviting throttling. */
const PER_HOST = 10;
/** Network errors, 429 and 5xx responses are retried this many times, backing off. */
const RETRIES = 3;
/** Compressed tiles kept in memory, so neighbouring tiles and reloads skip the network. */
const BLOB_CACHE = 600;
/** A low-quality tile is reloaded at most this many times, the first after this delay. */
const RELOAD_ATTEMPTS = 3;
const RELOAD_DELAY_MS = 4000;

const fill = (template: string, x: number, y: number, z: number) => template.replace('{x}', String(x)).replace('{y}', String(y)).replace('{z}', String(z));

const abortError = () => new DOMException('The tile is no longer needed.', 'AbortError');
const isAbort = (err: unknown) => (err as { name?: string } | null)?.name === 'AbortError';

class HttpError extends Error {
  status: number;
  constructor(status: number) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

/** Resolves after `ms`, or rejects as soon as `signal` fires. */
function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const stop = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', stop);
      resolve();
    }, ms);
    signal?.addEventListener('abort', stop, { once: true });
  });
}

/** `promise`, unless `signal` fires first. */
function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(abortError());
    signal.addEventListener('abort', stop, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', stop);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', stop);
        reject(err);
      },
    );
  });
}

// ---- Downloads ----------------------------------------------------------------------------------

interface Job {
  url: string;
  host: string;
  controller: AbortController;
  /** Tiles still waiting for this download. */
  waiters: number;
  started: boolean;
  settled: boolean;
  promise: Promise<Blob>;
  resolve: (blob: Blob) => void;
  reject: (err: unknown) => void;
}

const blobs = new Map<string, Blob>();
/** URLs that answered 404 or served a placeholder: asking again would get the same answer. */
const gone = new Set<string>();
const inflight = new Map<string, Job>();
const queues = new Map<string, Job[]>();
const running = new Map<string, number>();

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
};

function remember(url: string, blob: Blob): void {
  blobs.delete(url);
  blobs.set(url, blob);
  if (blobs.size > BLOB_CACHE) blobs.delete(blobs.keys().next().value as string);
}

async function download(job: Job): Promise<Blob> {
  const { signal } = job.controller;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(job.url, { signal, mode: 'cors' });
      if (res.ok) return await res.blob();
      throw new HttpError(res.status);
    } catch (err) {
      if (isAbort(err) || signal.aborted) throw abortError();
      const status = err instanceof HttpError ? err.status : 0;
      if (status === 404) gone.add(job.url);
      if (!(status === 0 || status === 429 || status >= 500) || attempt >= RETRIES) throw err;
      terrainStats.retried++;
      await wait(300 * 2 ** attempt * (0.75 + Math.random() * 0.5), signal);
    }
  }
}

function settle(job: Job, finish: () => void): void {
  if (job.settled) return;
  job.settled = true;
  if (inflight.get(job.url) === job) inflight.delete(job.url);
  if (job.started) running.set(job.host, (running.get(job.host) ?? 1) - 1);
  finish();
  pump(job.host);
}

function pump(host: string): void {
  const queue = queues.get(host);
  while (queue && queue.length > 0 && (running.get(host) ?? 0) < PER_HOST) {
    const job = queue.shift() as Job;
    job.started = true;
    running.set(host, (running.get(host) ?? 0) + 1);
    download(job).then(
      (blob) => {
        remember(job.url, blob);
        settle(job, () => job.resolve(blob));
      },
      (err) => settle(job, () => job.reject(err)),
    );
  }
}

/** Nobody wants this download any more: drop it from the queue, or stop it mid-flight. */
function cancel(job: Job): void {
  if (job.settled) return;
  if (inflight.get(job.url) === job) inflight.delete(job.url);
  if (job.started) {
    job.controller.abort();
    return;
  }
  const queue = queues.get(job.host);
  const i = queue ? queue.indexOf(job) : -1;
  if (queue && i >= 0) queue.splice(i, 1);
  settle(job, () => job.reject(abortError()));
}

/**
 * A tile image, downloaded once however many tiles ask for it. The promise rejects with an
 * AbortError when the caller's `signal` fires; the download itself stops only when every tile
 * that asked for it has gone.
 */
function fetchBlob(url: string, signal?: AbortSignal): Promise<Blob> {
  const cached = blobs.get(url);
  if (cached) {
    remember(url, cached);
    return Promise.resolve(cached);
  }
  if (gone.has(url)) return Promise.reject(new HttpError(404));
  if (signal?.aborted) return Promise.reject(abortError());
  let job = inflight.get(url);
  if (!job) {
    let resolve!: (blob: Blob) => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<Blob>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    promise.catch(() => undefined);
    const host = hostOf(url);
    job = { url, host, controller: new AbortController(), waiters: 0, started: false, settled: false, promise, resolve, reject };
    inflight.set(url, job);
    if (!queues.has(host)) queues.set(host, []);
    (queues.get(host) as Job[]).push(job);
  }
  const shared = job;
  shared.waiters++;
  pump(shared.host);
  return new Promise<Blob>((resolve, reject) => {
    let done = false;
    const leave = () => {
      done = true;
      shared.waiters--;
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      if (done) return;
      leave();
      if (shared.waiters === 0) cancel(shared);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    shared.promise.then(
      (blob) => {
        if (done) return;
        leave();
        resolve(blob);
      },
      (err) => {
        if (done) return;
        leave();
        reject(err);
      },
    );
  });
}

// ---- Heights ------------------------------------------------------------------------------------

const decode = (blob: Blob) => createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });

/** Decoded heights of a Terrarium tile, shared by every tile cut from it. */
const heights = new Map<string, Promise<Float32Array>>();

function tileHeights(url: string, signal?: AbortSignal): Promise<Float32Array> {
  let p = heights.get(url);
  if (!p) {
    // Not tied to any one tile's signal: several tiles are cut from the same heights.
    p = fetchBlob(url).then(async (blob) => {
      const img = await decode(blob);
      const canvas = new OffscreenCanvas(256, 256);
      const ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
      ctx.drawImage(img, 0, 0, 256, 256);
      img.close();
      const d = ctx.getImageData(0, 0, 256, 256).data;
      const h = new Float32Array(256 * 256);
      for (let i = 0; i < h.length; i++) h[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
      return h;
    });
    heights.set(url, p);
    p.catch(() => heights.delete(url));
    if (heights.size > 32) heights.delete(heights.keys().next().value as string);
  }
  return raceAbort(p, signal);
}

/** A Terrarium PNG for tile (z, x, y), cut bilinearly from the heights of its ancestor at zoom `az`. */
async function cutTerrarium(h: Float32Array, z: number, x: number, y: number, az: number): Promise<Blob> {
  const k = z - az;
  const n = 2 ** k;
  const px = Math.floor(x / n);
  const py = Math.floor(y / n);
  const ox = ((x - px * n) * 256) / n;
  const oy = ((y - py * n) * 256) / n;
  const step = 1 / n;
  const canvas = new OffscreenCanvas(256, 256);
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
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
  return canvas.convertToBlob({ type: 'image/png' });
}

/** Part of a tile: the data, whether it had to come from coarser data, and which downloads failed. */
interface Piece<T> {
  value: T;
  degraded: boolean;
  missing: string[];
}

/**
 * Heights for a tile: its own Terrarium tile, or cut from the nearest ancestor that loads (every
 * tile past zoom 15 is cut from zoom 15 by design). When nothing loads it waits and tries again
 * rather than failing, because deck.gl never retries a tile that errored and would leave a hole.
 */
async function tileElevation(template: string, z: number, x: number, y: number, signal: AbortSignal): Promise<Piece<Blob>> {
  for (let round = 0; ; round++) {
    const missing: string[] = [];
    if (z <= TERRARIUM_MAX_ZOOM) {
      const url = fill(template, x, y, z);
      try {
        return { value: await fetchBlob(url, signal), degraded: false, missing };
      } catch (err) {
        if (signal.aborted || isAbort(err)) throw abortError();
        missing.push(url);
      }
    }
    const first = Math.min(z - 1, TERRARIUM_MAX_ZOOM);
    for (let az = first; az >= Math.max(0, first - 4); az--) {
      const n = 2 ** (z - az);
      const url = fill(template, Math.floor(x / n), Math.floor(y / n), az);
      try {
        const h = await tileHeights(url, signal);
        return { value: await cutTerrarium(h, z, x, y, az), degraded: z <= TERRARIUM_MAX_ZOOM || az < first, missing };
      } catch (err) {
        if (signal.aborted || isAbort(err)) throw abortError();
        missing.push(url);
      }
    }
    if (round >= 2) throw new Error(`No elevation for tile ${z}/${x}/${y}`);
    await wait(RELOAD_DELAY_MS * 2 ** round, signal);
  }
}

// ---- Imagery ------------------------------------------------------------------------------------

/** A decoded imagery tile, or null when it is missing or the server's "no imagery here" placeholder. */
async function imagery(url: string, signal: AbortSignal): Promise<ImageBitmap | null> {
  try {
    const blob = await fetchBlob(url, signal);
    const img = await decode(blob);
    if (blob.size <= PLACEHOLDER_MAX_BYTES && isPlaceholder(img)) {
      img.close();
      gone.add(url);
      blobs.delete(url);
      return null;
    }
    return img;
  } catch (err) {
    if (signal.aborted || isAbort(err)) throw abortError();
    return null;
  }
}

/**
 * The tile's 512-px texture from the 2 × 2 imagery tiles one zoom deeper. Quadrants that cannot be
 * fetched come from the nearest coarser imagery, cropped to the tile; only if none loads is a
 * quadrant filled with a plain ground colour.
 */
async function tileTexture(template: string, z: number, x: number, y: number, maxZoom: number, blank: string, signal: AbortSignal): Promise<Piece<ImageBitmap>> {
  const canvas = new OffscreenCanvas(512, 512);
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
  ctx.imageSmoothingQuality = 'high';
  const missing: string[] = [];
  const note = (url: string) => {
    if (!gone.has(url)) missing.push(url);
  };
  // Quadrants still to draw, as row * 2 + column.
  let pending = [0, 1, 2, 3];
  let degraded = false;
  if (z + 1 <= maxZoom) {
    const urls = pending.map((q) => fill(template, x * 2 + (q & 1), y * 2 + (q >> 1), z + 1));
    const images = await Promise.all(urls.map((url) => imagery(url, signal).catch(() => null)));
    if (signal.aborted) {
      for (const img of images) img?.close();
      throw abortError();
    }
    pending = [];
    images.forEach((img, q) => {
      if (img) {
        ctx.drawImage(img, (q & 1) * 256, (q >> 1) * 256, 256, 256);
        img.close();
      } else {
        pending.push(q);
        note(urls[q]);
      }
    });
    degraded = pending.length > 0;
  }
  const top = Math.min(z, maxZoom);
  for (let a = top; pending.length > 0 && a >= Math.max(0, top - 5); a--) {
    const n = 2 ** (z - a);
    const px = Math.floor(x / n);
    const py = Math.floor(y / n);
    const url = fill(template, px, py, a);
    const img = await imagery(url, signal);
    if (!img) {
      note(url);
      continue;
    }
    const size = 256 / n;
    const sx = (x - px * n) * size;
    const sy = (y - py * n) * size;
    for (const q of pending) ctx.drawImage(img, sx + ((q & 1) * size) / 2, sy + ((q >> 1) * size) / 2, size / 2, size / 2, (q & 1) * 256, (q >> 1) * 256, 256, 256);
    img.close();
    if (a < top) degraded = true;
    pending = [];
  }
  if (pending.length > 0) {
    ctx.fillStyle = blank;
    for (const q of pending) ctx.fillRect((q & 1) * 256, (q >> 1) * 256, 256, 256);
    degraded = true;
  }
  return { value: canvas.transferToImageBitmap(), degraded, missing };
}

/** Esri answers for a place without imagery at some zoom with a small flat-grey "Map data not yet available" tile. */
const PLACEHOLDER_MAX_BYTES = 4096;
let sampler: OffscreenCanvasRenderingContext2D | null = null;

/** The placeholder is flat grey (204) nearly everywhere; ground, water and cloud never are. */
function isPlaceholder(img: ImageBitmap): boolean {
  sampler ??= new OffscreenCanvas(32, 32).getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
  sampler.clearRect(0, 0, 32, 32);
  sampler.drawImage(img, 0, 0, 32, 32);
  const d = sampler.getImageData(0, 0, 32, 32).data;
  let flat = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (Math.abs(d[i] - d[i + 1]) <= 6 && Math.abs(d[i + 1] - d[i + 2]) <= 6 && d[i] >= 192 && d[i] <= 216) flat++;
  }
  return flat >= 0.85 * 1024;
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

// ---- Layer --------------------------------------------------------------------------------------

type TileLoad = Parameters<TerrainLayer['getTiledTerrainData']>[0];
type SubLayerProps = Parameters<TerrainLayer['renderSubLayers']>[0];
/** What a tile resolves to: deck.gl's [mesh, texture], plus what it lacked when low quality. */
type TileContent = [Mesh | null, ImageBitmap | null] & { degraded?: boolean; missing?: string[] };
interface TileHeader {
  index: { x: number; y: number; z: number };
  content: unknown;
  setNeedsReload(): void;
}

/** Reloads so far per low-quality tile, so a tile that cannot be repaired stops trying. */
const reloads = new Map<string, number>();

export class HiResTerrainLayer extends TerrainLayer<{ textureMaxZoom?: number }> {
  static layerName = 'HiResTerrainLayer';

  // Replaces TerrainLayer's loader; deck's declared return type is internal, hence `any`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getTiledTerrainData(tile: TileLoad): any {
    const { elevationData, texture, elevationDecoder, meshMaxError, tileSize } = this.props;
    const textureMaxZoom = this.props.textureMaxZoom ?? 18;
    const { x, y, z } = tile.index;
    const signal = tile.signal ?? new AbortController().signal;
    const { viewport } = this.context;
    // Map tiles are always geographic here.
    const bbox = tile.bbox as { west: number; south: number; east: number; north: number };
    const bl = viewport.projectFlat([bbox.west, bbox.south]);
    const tr = viewport.projectFlat([bbox.east, bbox.north]);
    const xPad = ((tr[0] - bl[0]) / tileSize) * TILE_OVERLAP_PIXELS;
    const yPad = ((tr[1] - bl[1]) / tileSize) * TILE_OVERLAP_PIXELS;
    const bounds = [bl[0] - xPad, bl[1] - yPad, tr[0] + xPad, tr[1] + yPad];
    // Metres per projected unit across this tile, for the normals.
    const midLat = ((bbox.north + bbox.south) / 2) * (Math.PI / 180);
    const metresPerUnit = ((bbox.east - bbox.west) * 111_320 * Math.cos(midLat)) / Math.max(tr[0] - bl[0], 1e-12);
    // Finer meshes near the camera (deep tiles), coarser far away: the error doubles every two
    // zoom levels above Terrarium's last.
    const tileError = (meshMaxError as number) * 2 ** (Math.max(0, TERRARIUM_MAX_ZOOM - z) / 2);

    const mesh = tileElevation(elevationData as string, z, x, y, signal).then(async (elevation) => {
      // deck.gl's loader keys its resource cache by URL string, so the heights go in as an object URL.
      const url = URL.createObjectURL(elevation.value);
      try {
        const m = await this.loadTerrain({ elevationData: url, bounds, elevationDecoder, meshMaxError: tileError, signal } as never);
        return { mesh: addNormals(m as unknown as Mesh | null, metresPerUnit), elevation };
      } finally {
        URL.revokeObjectURL(url);
      }
    });
    const template = typeof texture === 'string' ? texture : null;
    const blank = template?.includes('World_Imagery') ? '#39432f' : '#1b1e23';
    const surface = template ? tileTexture(template, z, x, y, textureMaxZoom, blank, signal) : Promise.resolve(null);

    const content = Promise.allSettled([mesh, surface]).then(([m, s]) => {
      const bitmap = s.status === 'fulfilled' ? (s.value?.value ?? null) : null;
      if (signal.aborted || m.status === 'rejected' || s.status === 'rejected') {
        bitmap?.close();
        if (signal.aborted) throw abortError();
        throw m.status === 'rejected' ? m.reason : (s as PromiseRejectedResult).reason;
      }
      const out = [m.value.mesh, bitmap] as TileContent;
      if (m.value.elevation.degraded || s.value?.degraded) {
        out.degraded = true;
        out.missing = [...m.value.elevation.missing, ...(s.value?.missing ?? [])];
      }
      return out;
    });
    content.catch((err) => {
      if (isAbort(err)) terrainStats.cancelled++;
    });
    return content;
  }

  /** Counts the tile and, when it is low quality, fetches what it lacked and reloads it from the cache. */
  private tileLoaded(tile: TileHeader): void {
    terrainStats.loaded++;
    const content = tile.content as TileContent | null;
    const key = `${tile.index.z}/${tile.index.x}/${tile.index.y}`;
    if (content?.degraded) {
      terrainStats.degraded++;
      const attempt = (reloads.get(key) ?? 0) + 1;
      const urls = content.missing ?? [];
      if (attempt <= RELOAD_ATTEMPTS && urls.length > 0) {
        reloads.set(key, attempt);
        this.repair(tile, urls, attempt);
      }
    } else {
      reloads.delete(key);
    }
    if (reloads.size > 4000) reloads.clear();
    const layer = (this.getCurrentLayer() as HiResTerrainLayer | null) ?? this;
    (layer.props.onTileLoad as ((t: unknown) => void) | null | undefined)?.(tile);
  }

  private repair(tile: TileHeader, urls: string[], attempt: number): void {
    setTimeout(() => {
      Promise.all(urls.map((url) => fetchBlob(url))).then(
        () => {
          try {
            tile.setNeedsReload();
            // The tile layer picks up reloads when it next updates.
            this.getSubLayers()[0]?.setNeedsUpdate();
          } catch {
            // The layer has been removed: nothing left to repair.
          }
        },
        () => {
          if (attempt < RELOAD_ATTEMPTS) this.repair(tile, urls, attempt + 1);
        },
      );
    }, RELOAD_DELAY_MS * 2 ** (attempt - 1));
  }

  renderLayers() {
    const layer = super.renderLayers();
    if (!layer || Array.isArray(layer) || !(this.state as { isTiled?: boolean }).isTiled) return layer;
    // The callback lives in state rather than on this instance, so the tile layer's props stay
    // identical from one render to the next.
    const state = this.state as { onHiResTileLoad?: (tile: TileHeader) => void };
    state.onHiResTileLoad ??= (t) => ((this.getCurrentLayer() as HiResTerrainLayer | null) ?? this).tileLoaded(t);
    return (layer as Layer).clone({ onTileLoad: state.onHiResTileLoad } as never);
  }

  renderSubLayers(props: SubLayerProps) {
    const layer = super.renderSubLayers(props);
    return layer ? layer.clone({ textureParameters: TEXTURE_PARAMETERS } as never) : layer;
  }
}
