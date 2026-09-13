/// <reference types="@webgpu/types" />
// Performance on this device, measured rather than guessed: which graphics chip draws the map and
// which runs the flood solver, how evenly frames arrive, and whether the browser has put the map on
// an integrated chip while a graphics card sits idle. The Model tab shows it and copies it as a
// plain-text report, so a slow machine can be diagnosed from numbers.

export type GpuKind = 'discrete' | 'integrated' | 'software' | 'unknown';

export interface MapGpuInfo {
  vendor: string;
  renderer: string;
  /** Family as luma.gl identifies it: nvidia, amd, intel, apple, software or unknown. */
  gpu: string;
  backend?: string;
}

export interface AdapterDescription {
  vendor: string;
  architecture: string;
  description: string;
}

export interface AdapterProbe {
  webgpu: boolean;
  adapter: AdapterDescription | null;
}

export interface FrameSnapshot {
  fps: number;
  /** 95th-percentile time between frames (ms). */
  p95: number;
  worst: number;
  /** Frames that took more than twice the usual interval: the hitches people notice. */
  hitches: number;
  /** Share of the window the main thread spent in tasks longer than 50 ms. */
  blocked: number;
  /** Median time between frames (ms): the display's interval when the page keeps up. */
  median: number;
  seconds: number;
}

// ---- Frames -------------------------------------------------------------------------------------

const RING = 1024;
const stamps = new Float64Array(RING);
let stampCount = 0;
const longTasks: { start: number; duration: number }[] = [];
let monitoring = false;

/** Starts sampling animation frames and long tasks; cheap enough to leave running for the session. */
export function startFrameMonitor(): void {
  if (monitoring || typeof window === 'undefined') return;
  monitoring = true;
  const tick = (t: number) => {
    stamps[stampCount % RING] = t;
    stampCount++;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        longTasks.push({ start: e.startTime, duration: e.duration });
        if (longTasks.length > 200) longTasks.shift();
      }
    }).observe({ type: 'longtask', buffered: false });
  } catch {
    // Long-task timing exists only in Chromium; frame timing works everywhere.
  }
}

export function frameSnapshot(seconds = 5): FrameSnapshot | null {
  const n = Math.min(stampCount, RING);
  if (typeof performance === 'undefined' || n < 12) return null;
  const from = performance.now() - seconds * 1000;
  const times: number[] = [];
  for (let i = 1; i <= n; i++) {
    const t = stamps[(stampCount - i) % RING];
    if (t < from) break;
    times.push(t);
  }
  if (times.length < 12) return null;
  times.reverse();
  const gaps = times
    .slice(1)
    .map((t, i) => t - times[i])
    .sort((a, b) => a - b);
  const median = gaps[gaps.length >> 1];
  let blocked = 0;
  for (const task of longTasks) if (task.start >= from) blocked += task.duration;
  return {
    fps: (times.length - 1) / ((times[times.length - 1] - times[0]) / 1000),
    p95: gaps[Math.floor(gaps.length * 0.95)],
    worst: gaps[gaps.length - 1],
    hitches: gaps.filter((g) => g > Math.max(2 * median, 25)).length,
    blocked: blocked / (seconds * 1000),
    median,
    seconds,
  };
}

// ---- Graphics chips -----------------------------------------------------------------------------

/**
 * Discrete or integrated, from the renderer string. luma.gl's own guess counts every Radeon as a
 * graphics card, but "AMD Radeon(TM) Graphics" is the chip built into Ryzen processors.
 */
export function classifyGpu(renderer: string): GpuKind {
  if (/SwiftShader|llvmpipe|Basic Render|Software/i.test(renderer)) return 'software';
  if (/Intel.*\bArc\b/i.test(renderer)) return 'discrete';
  if (/Radeon\(TM\) Graphics|Radeon Graphics|Radeon Vega|Vega \d+ Graphics|Radeon \d+M\b|Intel|UHD|Iris|Apple M\d|Apple GPU|Mali|Adreno/i.test(renderer)) return 'integrated';
  if (/NVIDIA|GeForce|RTX|GTX|Quadro|Radeon RX|Radeon Pro|FirePro/i.test(renderer)) return 'discrete';
  return 'unknown';
}

/** "ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 (0x00001F99) Direct3D11 vs_5_0 ps_5_0, D3D11)" → "NVIDIA GeForce GTX 1650 · Direct3D 11". */
export function prettyRenderer(renderer: string): string {
  const m = /^ANGLE \((.*)\)\s*$/.exec(renderer.trim());
  if (!m) return renderer.trim() || 'Unknown';
  const parts = m[1].split(', ');
  let name = (parts.length > 1 ? parts[1] : parts[0])
    .replace(/\s*\(0x[0-9a-f]+\)/gi, '')
    .replace(/\s+(Direct3D\S*|vs_\S+|ps_\S+)/gi, '')
    .trim();
  let api = parts[2] ?? '';
  if (/Metal Renderer:/i.test(name)) {
    name = name.replace(/^.*Metal Renderer:\s*/i, '');
    api = 'Metal';
  }
  api = api.replace(/^D3D(\d+)/, 'Direct3D $1').replace(/^(OpenGL|Vulkan|Metal).*/, '$1');
  return api ? `${name} · ${api}` : name;
}

const VENDORS: Record<string, string> = { nvidia: 'NVIDIA', amd: 'AMD', intel: 'Intel', apple: 'Apple', qualcomm: 'Qualcomm', arm: 'Arm' };

export function adapterLabel(a: AdapterDescription | null): string {
  if (!a) return 'no adapter';
  if (a.description) return a.description;
  return [VENDORS[a.vendor.toLowerCase()] ?? a.vendor, a.architecture].filter(Boolean).join(' ') || 'unnamed adapter';
}

let mapGpu: MapGpuInfo | null = null;
const listeners = new Set<() => void>();

/** Called once the map's WebGL device exists. */
export function setMapGpu(info: { vendor: string; renderer: string; gpu: string; gpuBackend?: string }): void {
  mapGpu = { vendor: info.vendor, renderer: info.renderer, gpu: info.gpu, backend: info.gpuBackend };
  for (const listener of listeners) listener();
}

export function getMapGpu(): MapGpuInfo | null {
  return mapGpu;
}

export function onPerfChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

let probe: Promise<AdapterProbe> | null = null;

/** The WebGPU adapter the solver would get (the same request the solver makes). */
export function probeAdapters(): Promise<AdapterProbe> {
  probe ??= (async () => {
    const gpu = typeof navigator !== 'undefined' ? navigator.gpu : undefined;
    if (!gpu) return { webgpu: false, adapter: null };
    try {
      const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
      const info = adapter?.info as GPUAdapterInfo | undefined;
      return { webgpu: true, adapter: info ? { vendor: info.vendor ?? '', architecture: info.architecture ?? '', description: info.description ?? '' } : null };
    } catch {
      return { webgpu: true, adapter: null };
    }
  })();
  return probe;
}

/**
 * The name of a faster chip when the map is on an integrated one and WebGPU reports a graphics card
 * from another vendor: the browser has split the two, and the map is paying for it.
 */
export function gpuMismatch(adapters: AdapterProbe | null): string | null {
  if (!mapGpu || !adapters?.adapter) return null;
  if (classifyGpu(mapGpu.renderer) !== 'integrated') return null;
  const vendor = adapters.adapter.vendor.toLowerCase();
  if (!vendor || vendor === mapGpu.gpu.toLowerCase()) return null;
  return vendor === 'nvidia' || (vendor === 'amd' && mapGpu.gpu === 'intel') ? adapterLabel(adapters.adapter) : null;
}

// ---- Terrain ------------------------------------------------------------------------------------

/** Terrain tile outcomes this session, counted by the terrain layer. */
export const terrainStats = { loaded: 0, retried: 0, degraded: 0, cancelled: 0 };

// ---- Report -------------------------------------------------------------------------------------

export interface ReportContext {
  scenario: string;
  grid: string;
  readout: [string, string][];
  engines: string[];
}

export function buildReport(ctx: ReportContext, adapters: AdapterProbe | null): string {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const f = frameSnapshot(5);
  const adapter = adapters?.adapter;
  return [
    `Cascade performance report · ${new Date().toISOString()}`,
    '',
    ...ctx.readout.map(([k, v]) => `${k}: ${v}`),
    '',
    `Scenario: ${ctx.scenario}`,
    `Grid: ${ctx.grid}`,
    ...ctx.engines,
    '',
    `Map renderer: ${mapGpu ? `${mapGpu.renderer} [${classifyGpu(mapGpu.renderer)}]` : 'not initialised'}`,
    `WebGPU adapter: ${adapter ? `${adapter.vendor} / ${adapter.architecture} / ${adapter.description || '-'}` : adapters?.webgpu ? 'none found' : adapters ? 'WebGPU not available' : 'not checked'}`,
    f
      ? `Frames (5 s): ${f.fps.toFixed(1)} fps, median ${f.median.toFixed(1)} ms, p95 ${f.p95.toFixed(1)} ms, worst ${f.worst.toFixed(1)} ms, ${f.hitches} hitches, main thread blocked ${(f.blocked * 100).toFixed(1)}%`
      : 'Frames: not measured',
    `Terrain tiles: ${terrainStats.loaded} loaded, ${terrainStats.retried} retried, ${terrainStats.degraded} low quality, ${terrainStats.cancelled} cancelled`,
    `Window: ${window.innerWidth}×${window.innerHeight} at ${window.devicePixelRatio}× pixel ratio`,
    `Processor threads: ${navigator.hardwareConcurrency ?? '?'} · memory: ${nav.deviceMemory ? `at least ${nav.deviceMemory} GB` : 'not reported'}`,
    `Browser: ${navigator.userAgent}`,
  ].join('\n');
}
