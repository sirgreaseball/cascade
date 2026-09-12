// Colour scales for the flood rasters, painted straight into ImageData (one texture per frame
// instead of one object per cell). Sequential = one hue light→dark; ordinal hazard/arrival
// bands use a semantic heat ramp with a labelled legend; difference is diverging blue↔orange
// around a neutral grey, matching the engine identity colours (SWE blue, SPH orange).

import { hazardClass } from '@/lib/damage';

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Engine identity colours (categorical slots 1–3 of the validated palette) + observation. */
export const IDENTITY = {
  swe: '#2a78d6',
  sph: '#eb6834',
  external: '#1baf7a',
  observed: '#4a3aa7',
} as const;

export const DEPTH_STEPS = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'];
export const DEPTH_MIN = 0.1;
export const DEPTH_MAX = 40;
export const DEPTH_TICKS = [0.1, 0.5, 2, 5, 15, 40];

export const ARRIVAL_BANDS = [
  { max: 900, label: '< 15 min', color: '#7f1d1d' },
  { max: 1800, label: '15–30 min', color: '#c2261d' },
  { max: 3600, label: '30–60 min', color: '#e4572e' },
  { max: 7200, label: '1–2 h', color: '#f28c28' },
  { max: 14400, label: '2–4 h', color: '#f6b93b' },
  { max: Infinity, label: '> 4 h', color: '#fbe29f' },
];

export const HAZARD_COLORS = ['#fbe29f', '#f6b93b', '#f28c28', '#e4572e', '#c2261d', '#6b1414'];

export const VELOCITY_STEPS = ['#e4e1fb', '#c9c3f5', '#aea5ef', '#9085e9', '#7263d6', '#5a4bbd', '#4a3aa7', '#382b84'];
export const VELOCITY_MAX = 12;
export const VELOCITY_TICKS = [0.5, 2, 5, 12];

// Chance of flooding across the ensemble: one hue, light → dark, distinct from the depth blues.
export const PROBABILITY_STEPS = ['#dff3ef', '#b6e5dd', '#8bd5c9', '#5ec2b4', '#37a99c', '#1f8b81', '#136e66'];
export const PROBABILITY_TICKS = [10, 25, 50, 75, 100];

export const DIFF_NEG = ['#1c5cab', '#3987e5', '#86b6ef'];
export const DIFF_MID = '#e8e7e3';
export const DIFF_POS = ['#f4b08a', '#eb6834', '#a8401a'];
export const DIFF_RANGE = 10;

function buildLut(steps: string[], alphaFrom: number, alphaTo: number, ease: (t: number) => number = (t) => t): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 4);
  const rgb = steps.map(hexToRgb);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    const pos = t * (rgb.length - 1);
    const k = Math.min(Math.floor(pos), rgb.length - 2);
    const f = pos - k;
    for (let ch = 0; ch < 3; ch++) lut[i * 4 + ch] = rgb[k][ch] + (rgb[k + 1][ch] - rgb[k][ch]) * f;
    lut[i * 4 + 3] = alphaFrom + (alphaTo - alphaFrom) * ease(t);
  }
  return lut;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Soft shorelines: the shallowest water is translucent and reaches full colour by about a metre
// deep (0.35 on the logarithmic scale), so flood edges fade instead of stopping in hard cells.
const DEPTH_LUT = buildLut(DEPTH_STEPS, 70, 238, (t) => smoothstep(0, 0.35, t));
const VELOCITY_LUT = buildLut(VELOCITY_STEPS, 160, 235);
const PROBABILITY_LUT = buildLut(PROBABILITY_STEPS, 90, 235);
const DIFF_LUT = buildLut([...DIFF_NEG, DIFF_MID, ...DIFF_POS], 220, 220);
const LOG_MIN = Math.log(DEPTH_MIN);
const LOG_SPAN = Math.log(DEPTH_MAX) - LOG_MIN;

/** Position 0–1 of a depth on the (logarithmic) depth scale. */
export function depthPosition(d: number): number {
  if (d <= DEPTH_MIN) return 0;
  return Math.min(1, (Math.log(d) - LOG_MIN) / LOG_SPAN);
}

export function depthColor(d: number): [number, number, number, number] {
  const i = Math.round(depthPosition(d) * 255) * 4;
  return [DEPTH_LUT[i], DEPTH_LUT[i + 1], DEPTH_LUT[i + 2], DEPTH_LUT[i + 3]];
}

export function gradientCss(steps: string[]): string {
  return `linear-gradient(90deg, ${steps.join(', ')})`;
}

// Precomputed depth (cm) → LUT index, so painting a frame is a table lookup per cell.
const CM_INDEX = new Uint8Array(65536);
for (let cm = 0; cm < 65536; cm++) CM_INDEX[cm] = Math.round(depthPosition(cm / 100) * 255);
const WET_CM = DEPTH_MIN * 100;

function clear(out: Uint8ClampedArray) {
  out.fill(0);
}

/** Current depth, linearly interpolated between two frames (depths in cm). */
export function paintDepth(out: Uint8ClampedArray, a: Uint16Array, b: Uint16Array | null, f: number): void {
  const n = a.length;
  const lut = DEPTH_LUT;
  if (!b || f <= 0) {
    for (let k = 0; k < n; k++) {
      const d = a[k];
      const o = k * 4;
      if (d < WET_CM) {
        out[o + 3] = 0;
        continue;
      }
      const i = CM_INDEX[d] * 4;
      out[o] = lut[i];
      out[o + 1] = lut[i + 1];
      out[o + 2] = lut[i + 2];
      out[o + 3] = lut[i + 3];
    }
    return;
  }
  const g = 1 - f;
  for (let k = 0; k < n; k++) {
    const d = (a[k] * g + b[k] * f) | 0;
    const o = k * 4;
    if (d < WET_CM) {
      out[o + 3] = 0;
      continue;
    }
    const i = CM_INDEX[d] * 4;
    out[o] = lut[i];
    out[o + 1] = lut[i + 1];
    out[o + 2] = lut[i + 2];
    out[o + 3] = lut[i + 3];
  }
}

export function paintMaxDepth(out: Uint8ClampedArray, maxDepth: Float32Array, arrival: Float32Array, tNow: number): void {
  clear(out);
  for (let k = 0; k < maxDepth.length; k++) {
    const d = maxDepth[k];
    if (d < DEPTH_MIN || arrival[k] < 0 || arrival[k] > tNow) continue;
    const i = Math.round(depthPosition(d) * 255) * 4;
    const o = k * 4;
    out[o] = DEPTH_LUT[i];
    out[o + 1] = DEPTH_LUT[i + 1];
    out[o + 2] = DEPTH_LUT[i + 2];
    out[o + 3] = DEPTH_LUT[i + 3];
  }
}

const ARRIVAL_RGB = ARRIVAL_BANDS.map((b) => hexToRgb(b.color));
export function paintArrival(out: Uint8ClampedArray, arrival: Float32Array, tNow: number): void {
  clear(out);
  for (let k = 0; k < arrival.length; k++) {
    const t = arrival[k];
    if (t < 0 || t > tNow) continue;
    let band = 0;
    while (t >= ARRIVAL_BANDS[band].max) band++;
    const c = ARRIVAL_RGB[band];
    const o = k * 4;
    out[o] = c[0];
    out[o + 1] = c[1];
    out[o + 2] = c[2];
    out[o + 3] = 215;
  }
}

const HAZARD_RGB = HAZARD_COLORS.map(hexToRgb);
export function paintHazard(out: Uint8ClampedArray, maxDepth: Float32Array, maxSpeed: Float32Array, maxDV: Float32Array, arrival: Float32Array, tNow: number): void {
  clear(out);
  for (let k = 0; k < maxDepth.length; k++) {
    if (arrival[k] < 0 || arrival[k] > tNow) continue;
    const h = hazardClass(maxDepth[k], maxSpeed[k], maxDV[k]);
    if (h === 0) continue;
    const c = HAZARD_RGB[h - 1];
    const o = k * 4;
    out[o] = c[0];
    out[o + 1] = c[1];
    out[o + 2] = c[2];
    out[o + 3] = 215;
  }
}

export function paintVelocity(out: Uint8ClampedArray, maxSpeed: Float32Array, arrival: Float32Array, tNow: number): void {
  clear(out);
  for (let k = 0; k < maxSpeed.length; k++) {
    const v = maxSpeed[k];
    if (v <= 0.05 || arrival[k] < 0 || arrival[k] > tNow) continue;
    const i = Math.round(Math.min(1, Math.sqrt(v / VELOCITY_MAX)) * 255) * 4;
    const o = k * 4;
    out[o] = VELOCITY_LUT[i];
    out[o + 1] = VELOCITY_LUT[i + 1];
    out[o + 2] = VELOCITY_LUT[i + 2];
    out[o + 3] = VELOCITY_LUT[i + 3];
  }
}

/** Share of the ensemble's runs that flood each cell (0–1). */
export function paintProbability(out: Uint8ClampedArray, probability: Float32Array): void {
  clear(out);
  for (let k = 0; k < probability.length; k++) {
    const p = probability[k];
    if (p <= 0.001) continue;
    const i = Math.round(Math.min(1, p) * 255) * 4;
    const o = k * 4;
    out[o] = PROBABILITY_LUT[i];
    out[o + 1] = PROBABILITY_LUT[i + 1];
    out[o + 2] = PROBABILITY_LUT[i + 2];
    out[o + 3] = PROBABILITY_LUT[i + 3];
  }
}

/** Difference b − a (m) where either is wet; a/b are depths in cm. */
export function paintDifference(out: Uint8ClampedArray, a: Uint16Array, b: Uint16Array): void {
  clear(out);
  for (let k = 0; k < a.length; k++) {
    if (a[k] < WET_CM && b[k] < WET_CM) continue;
    const d = (b[k] - a[k]) / 100;
    const s = Math.sign(d) * Math.min(1, Math.sqrt(Math.abs(d) / DIFF_RANGE));
    const i = Math.round((s * 0.5 + 0.5) * 255) * 4;
    const o = k * 4;
    out[o] = DIFF_LUT[i];
    out[o + 1] = DIFF_LUT[i + 1];
    out[o + 2] = DIFF_LUT[i + 2];
    out[o + 3] = Math.abs(d) < 0.25 ? 120 : 225;
  }
}

/** Max-depth envelope difference (external model or SPH vs SWE), depths in metres. */
export function paintDifferenceMetres(out: Uint8ClampedArray, a: Float32Array, b: Float32Array): void {
  clear(out);
  for (let k = 0; k < a.length; k++) {
    if (a[k] < DEPTH_MIN && b[k] < DEPTH_MIN) continue;
    const d = b[k] - a[k];
    const s = Math.sign(d) * Math.min(1, Math.sqrt(Math.abs(d) / DIFF_RANGE));
    const i = Math.round((s * 0.5 + 0.5) * 255) * 4;
    const o = k * 4;
    out[o] = DIFF_LUT[i];
    out[o + 1] = DIFF_LUT[i + 1];
    out[o + 2] = DIFF_LUT[i + 2];
    out[o + 3] = Math.abs(d) < 0.25 ? 120 : 225;
  }
}

const OBSERVED_RGB = hexToRgb(IDENTITY.observed);
export function paintMask(out: Uint8ClampedArray, mask: Uint8Array): void {
  clear(out);
  for (let k = 0; k < mask.length; k++) {
    if (!mask[k]) continue;
    const o = k * 4;
    out[o] = OBSERVED_RGB[0];
    out[o + 1] = OBSERVED_RGB[1];
    out[o + 2] = OBSERVED_RGB[2];
    out[o + 3] = 120;
  }
}
