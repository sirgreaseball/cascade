// The flood, coloured and animated on the graphics card.
//
// The simulation stores a depth frame every few simulated minutes. Painting each displayed moment on
// the processor — colour every cell, build an image, upload a brand-new texture — capped the flood at
// about fifteen repaints a second and, on Windows, spent much of each frame creating textures. Here
// frames are uploaded once, into textures that are reused, and the shader does the rest every display
// frame: it blends the two frames either side of the playhead, looks the colour up on the depth
// scale, and reveals each cell at the second the water reached it, so the front advances smoothly
// instead of cross-fading between frames minutes apart.

import { LayerExtension } from '@deck.gl/core';
import type { Layer } from '@deck.gl/core';
import type { Device, Texture } from '@luma.gl/core';
import { CM_INDEX, DEPTH_LUT, WET_CM } from './colormaps';

/** Arrival times are stored in whole seconds; this value means "not reached". */
const NEVER = 65535;

export type FloodMode = 'frames' | 'revealed' | 'static';

/** What the shader draws this frame. */
export interface FloodFrame {
  field: FloodField;
  /** 'frames': depth frames blended and revealed by arrival; 'revealed': the painted image revealed by arrival; 'static': the painted image. */
  mode: FloodMode;
  /** Weight of the later frame, 0–1. */
  mix: number;
  /** Playhead (s). */
  time: number;
  hasArrival: boolean;
  hasImage: boolean;
}

const LINEAR = { minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' } as const;
const NEAREST = { minFilter: 'nearest', magFilter: 'nearest', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' } as const;

let nextKey = 1;
const keys = new WeakMap<object, number>();
/** A stable number per object, so cache keys can be built from array identities. */
export function keyOf(o: object | null | undefined): number {
  if (!o) return 0;
  let k = keys.get(o);
  if (k === undefined) {
    k = nextKey++;
    keys.set(o, k);
  }
  return k;
}

/**
 * The flood's textures for one grid: two depth frames (as positions on the colour scale), arrival
 * times, an image for the layers still coloured on the processor, and the depth colour scale.
 * Every upload is skipped when its source has not changed.
 */
export class FloodField {
  readonly device: Device;
  readonly cols: number;
  readonly rows: number;
  readonly frames: Texture;
  readonly arrival: Texture;
  readonly image: Texture;
  readonly lut: Texture;
  private readonly pair: Uint8Array;
  private readonly times: Uint8Array;
  private readonly paint: Uint8ClampedArray;
  private frameA: Uint16Array | null | undefined;
  private frameB: Uint16Array | null | undefined;
  private arrivalSource: Float32Array | null | undefined;
  private imageKey = '';

  constructor(device: Device, cols: number, rows: number) {
    this.device = device;
    this.cols = cols;
    this.rows = rows;
    const n = cols * rows;
    this.frames = device.createTexture({ id: 'flood-frames', format: 'rg8unorm', width: cols, height: rows, mipLevels: 1, sampler: LINEAR });
    this.arrival = device.createTexture({ id: 'flood-arrival', format: 'rg8unorm', width: cols, height: rows, mipLevels: 1, sampler: NEAREST });
    this.image = device.createTexture({ id: 'flood-image', format: 'rgba8unorm', width: cols, height: rows, mipLevels: 1, sampler: LINEAR });
    this.lut = device.createTexture({ id: 'flood-lut', format: 'rgba8unorm', width: 256, height: 1, mipLevels: 1, sampler: LINEAR });
    this.pair = new Uint8Array(n * 2);
    this.times = new Uint8Array(n * 2);
    this.paint = new Uint8ClampedArray(n * 4);
    this.lut.writeData(DEPTH_LUT);
    this.frames.writeData(this.pair);
    this.image.writeData(this.paint);
    this.setArrival(null);
  }

  /** The frames either side of the playhead (depths in cm); `b` is null when there is only one. */
  setFrames(a: Uint16Array | null, b: Uint16Array | null): void {
    if (a === this.frameA && b === this.frameB) return;
    const out = this.pair;
    const n = this.cols * this.rows;
    const position = (d: number) => (d >= WET_CM ? Math.max(1, CM_INDEX[d]) : 0);
    if (a && a === this.frameB) {
      // Playback moved on by one frame: the previous later frame is the new earlier one.
      for (let k = 0; k < n; k++) out[k * 2] = out[k * 2 + 1];
    } else {
      for (let k = 0; k < n; k++) out[k * 2] = a ? position(a[k]) : 0;
    }
    const later = b ?? a;
    for (let k = 0; k < n; k++) out[k * 2 + 1] = later ? position(later[k]) : 0;
    this.frameA = a;
    this.frameB = b;
    this.frames.writeData(out);
  }

  /** Seconds after the breach when each cell first flooded (−1 where it has not). */
  setArrival(arrival: Float32Array | null): void {
    if (arrival === this.arrivalSource) return;
    const out = this.times;
    const n = this.cols * this.rows;
    for (let k = 0; k < n; k++) {
      const t = arrival ? arrival[k] : -1;
      const v = t >= 0 ? Math.min(NEVER - 1, Math.round(t)) : NEVER;
      out[k * 2] = v >> 8;
      out[k * 2 + 1] = v & 255;
    }
    this.arrivalSource = arrival;
    this.arrival.writeData(out);
  }

  /** Paints and uploads the image with `fill`, unless `key` says nothing has changed. */
  setImage(key: string, fill: (out: Uint8ClampedArray) => void): void {
    if (key === this.imageKey) return;
    fill(this.paint);
    this.imageKey = key;
    this.image.writeData(this.paint);
  }

  destroy(): void {
    for (const t of [this.frames, this.arrival, this.image, this.lut]) t.destroy();
  }
}

// ---- Shader -------------------------------------------------------------------------------------

const uniformBlock = /* glsl */ `\
layout(std140) uniform floodUniforms {
  float mode;
  float mixFrames;
  float time;
  float hasArrival;
  vec2 size;
  float feather;
  float hasImage;
} flood;
`;

const fs = /* glsl */ `\
${uniformBlock}
uniform sampler2D flood_frames;
uniform sampler2D flood_arrival;
uniform sampler2D flood_image;
uniform sampler2D flood_lut;

float flood_arrivalTexel(ivec2 p) {
  vec2 rg = texelFetch(flood_arrival, clamp(p, ivec2(0), ivec2(flood.size) - 1), 0).rg * 255.0;
  return floor(rg.r + 0.5) * 256.0 + floor(rg.g + 0.5);
}

// Arrival time at a point, interpolated between the neighbouring cells that have one, so the flood
// front sweeps across a cell instead of appearing a cell at a time; 65535 where none has one.
float flood_arrivalAt(vec2 uv) {
  vec2 st = uv * flood.size - 0.5;
  vec2 f = fract(st);
  ivec2 p = ivec2(floor(st));
  vec4 a = vec4(flood_arrivalTexel(p), flood_arrivalTexel(p + ivec2(1, 0)), flood_arrivalTexel(p + ivec2(0, 1)), flood_arrivalTexel(p + ivec2(1, 1)));
  vec4 w = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
  vec4 known = step(a, vec4(65534.5));
  float total = dot(w, known);
  return total < 1e-4 ? 65535.0 : dot(w * known, a) / total;
}

vec4 flood_color(vec2 uv) {
  vec4 c;
  if (flood.mode < 0.5) {
    vec2 pair = texture(flood_frames, uv).rg;
    float position = mix(pair.x, pair.y, flood.mixFrames);
    if (position <= 0.0) {
      if (flood.hasImage < 0.5) return vec4(0.0);
      c = texture(flood_image, uv);
    } else {
      if (flood.hasArrival > 0.5) {
        float a = flood_arrivalAt(uv);
        if (a < 65534.5 && a > flood.time) position = 0.0;
      }
      if (position <= 0.0) {
        if (flood.hasImage < 0.5) return vec4(0.0);
        c = texture(flood_image, uv);
      } else {
        c = texture(flood_lut, vec2(position * (255.0 / 256.0) + 0.5 / 256.0, 0.5));
        // Position 0 is dry ground: the last sliver towards it fades out, so shorelines are soft.
        c.a *= smoothstep(0.5 / 255.0, 8.0 / 255.0, position);
        if (c.a < 0.004 && flood.hasImage > 0.5) c = texture(flood_image, uv);
      }
    }
  } else {
    if (flood.hasImage < 0.5) return vec4(0.0);
    c = texture(flood_image, uv);
    // Hide only what is known to flood later: the observed extent under it has no arrival time.
    if (flood.mode < 1.5 && flood.hasArrival > 0.5) {
      float a = flood_arrivalAt(uv);
      if (a < 65534.5 && a > flood.time) c.a = 0.0;
    }
  }
  if (c.a < 0.003) return vec4(0.0);
  // Fade out over the last cells at the edge of the study area, where water leaves the model.
  vec2 inside = min(uv, 1.0 - uv) * flood.size;
  c.a *= clamp((min(inside.x, inside.y) - 0.5) / flood.feather, 0.0, 1.0);
  return c;
}
`;

const floodModule = {
  name: 'flood',
  vs: uniformBlock,
  fs,
  getUniforms: (opts?: Record<string, unknown>) => opts ?? {},
  uniformTypes: { mode: 'f32', mixFrames: 'f32', time: 'f32', hasArrival: 'f32', size: 'vec2<f32>', feather: 'f32', hasImage: 'f32' },
} as const;

export interface FloodOptions {
  /** Called on every draw: brings the textures up to the playhead and says what to draw. */
  frame: (device: Device) => FloodFrame;
  /** Cells over which the flood fades out at the edge of the study area. */
  feather?: number;
}

const MODE: Record<FloodMode, number> = { frames: 0, revealed: 1, static: 2 };

/** Draws the flood from a FloodField instead of the layer's own texture or colour. */
export class FloodExtension extends LayerExtension<FloodOptions> {
  static extensionName = 'FloodExtension';

  getShaders(this: Layer) {
    return {
      modules: [floodModule],
      inject: {
        'fs:DECKGL_FILTER_COLOR': /* glsl */ `
          color = flood_color(geometry.uv);
          if (color.a < 0.003) discard;
        `,
      },
    };
  }

  draw(this: Layer, _params: unknown, extension: this) {
    const f = extension.opts.frame(this.context.device);
    const { field } = f;
    this.setShaderModuleProps({
      flood: {
        mode: MODE[f.mode],
        mixFrames: f.mix,
        time: f.time,
        hasArrival: f.hasArrival ? 1 : 0,
        size: [field.cols, field.rows],
        feather: extension.opts.feather ?? 8,
        hasImage: f.hasImage ? 1 : 0,
        flood_frames: field.frames,
        flood_arrival: field.arrival,
        flood_image: field.image,
        flood_lut: field.lut,
      },
    });
  }
}
