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
  vec4 bbox;
  vec4 params1;
  vec4 params2;
  vec4 params3;
} flood;

#define flood_mode (flood.params1.x)
#define flood_mixFrames (flood.params1.y)
#define flood_time (flood.params1.z)
#define flood_hasArrival (flood.params1.w)
#define flood_size (flood.params2.xy)
#define flood_feather (flood.params2.z)
#define flood_hasImage (flood.params2.w)
#define flood_inTerrain (flood.params3.x)
#define flood_sky (flood.params3.yzw)
`;

const fs = /* glsl */ `\
${uniformBlock}
uniform sampler2D flood_frames;
uniform sampler2D flood_arrival;
uniform sampler2D flood_image;
uniform sampler2D flood_lut;

float flood_arrivalTexel(ivec2 p) {
  vec2 rg = texelFetch(flood_arrival, clamp(p, ivec2(0), ivec2(flood_size) - 1), 0).rg * 255.0;
  return floor(rg.r + 0.5) * 256.0 + floor(rg.g + 0.5);
}

// Arrival time at a point, interpolated between the neighbouring cells that have one, so the flood
// front sweeps across a cell instead of appearing a cell at a time; 65535 where none has one.
float flood_arrivalAt(vec2 uv) {
  vec2 st = uv * flood_size - 0.5;
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
  if (flood_mode < 0.5) {
    vec2 pair = texture(flood_frames, uv).rg;
    float position = mix(pair.x, pair.y, flood_mixFrames);
    if (position <= 0.0) {
      if (flood_hasImage < 0.5) return vec4(0.0);
      c = texture(flood_image, uv);
    } else {
      if (flood_hasArrival > 0.5) {
        float a = flood_arrivalAt(uv);
        if (a < 65534.5 && a > flood_time) position = 0.0;
      }
      if (position <= 0.0) {
        if (flood_hasImage < 0.5) return vec4(0.0);
        c = texture(flood_image, uv);
      } else {
        c = texture(flood_lut, vec2(position * (255.0 / 256.0) + 0.5 / 256.0, 0.5));
        // Position 0 is dry ground: the last sliver towards it fades out, so shorelines are soft.
        c.a *= smoothstep(0.5 / 255.0, 8.0 / 255.0, position);
        if (c.a < 0.004 && flood_hasImage > 0.5) c = texture(flood_image, uv);
      }
    }
  } else {
    if (flood_hasImage < 0.5) return vec4(0.0);
    c = texture(flood_image, uv);
    // Hide only what is known to flood later: the observed extent under it has no arrival time.
    if (flood_mode < 1.5 && flood_hasArrival > 0.5) {
      float a = flood_arrivalAt(uv);
      if (a < 65534.5 && a > flood_time) c.a = 0.0;
    }
  }
  if (c.a < 0.003) return vec4(0.0);
  // Fade out over the last cells at the edge of the study area, where water leaves the model.
  vec2 inside = min(uv, 1.0 - uv) * flood_size;
  c.a *= clamp((min(inside.x, inside.y) - 0.5) / flood_feather, 0.0, 1.0);
  return c;
}
`;

const floodModule = {
  name: 'flood',
  vs: uniformBlock,
  fs,
  getUniforms: (opts?: Record<string, unknown>) => opts ?? {},
  uniformTypes: {
    bbox: 'vec4<f32>',
    params1: 'vec4<f32>',
    params2: 'vec4<f32>',
    params3: 'vec4<f32>',
  },
} as const;

export interface FloodOptions {
  /** Called on every draw: brings the textures up to the playhead and says what to draw. */
  frame: (device: Device) => FloodFrame;
  /** Cells over which the flood fades out at the edge of the study area. */
  feather?: number;
  /** When true, samples the flood by geographic projection onto terrain tiles instead of geometry.uv. */
  inTerrain?: boolean;
  /** Scenario bounding box [west, south, east, north] in degrees or a function returning it. */
  bbox?: [number, number, number, number] | (() => [number, number, number, number] | undefined);
  /** Horizon/sky color for water grazing angles or a function returning it. */
  sky?: [number, number, number] | (() => [number, number, number] | undefined);
}

const MODE: Record<FloodMode, number> = { frames: 0, revealed: 1, static: 2 };

/** Draws the flood from a FloodField instead of the layer's own texture or colour. */
export class FloodExtension extends LayerExtension<FloodOptions> {
  static extensionName = 'FloodExtension';

  getShaders(this: Layer, extension: this) {
    if (extension?.opts?.inTerrain) {
      return {
        modules: [floodModule],
        inject: {
          'vs:#decl': /* glsl */ `
            out vec2 vFloodUv;
            out vec3 vViewDir;
          `,
          'vs:DECKGL_FILTER_GL_POSITION': /* glsl */ `
            vec2 p = geometry.position.xy;
            float lng = p.x * (360.0 / 512.0) - 180.0;
            float n = 3.141592653589793 * (1.0 - 2.0 * (p.y / 512.0));
            float sinh_n = 0.5 * (exp(n) - exp(-n));
            float lat = 57.29577951308232 * atan(sinh_n);
            vFloodUv = vec2((lng - flood.bbox.x) / max(flood.bbox.z - flood.bbox.x, 1e-6), (flood.bbox.w - lat) / max(flood.bbox.w - flood.bbox.y, 1e-6));
            vViewDir = project.cameraPosition - geometry.position.xyz;
          `,
          'fs:#decl': /* glsl */ `
            in vec2 vFloodUv;
            in vec3 vViewDir;
          `,
          'fs:DECKGL_FILTER_COLOR': /* glsl */ `
            if (vFloodUv.x >= 0.0 && vFloodUv.x <= 1.0 && vFloodUv.y >= 0.0 && vFloodUv.y <= 1.0) {
              vec4 floodCol = flood_color(vFloodUv);
              if (floodCol.a > 0.003) {
                vec2 p = vFloodUv * flood_size;
                float t = flood_time;
                float a1 = p.x * 1.9 + p.y * 0.7 + t * 1.6;
                float a2 = -p.x * 0.8 + p.y * 2.3 + t * 1.2;
                float a3 = (p.x + p.y) * 4.1 - t * 2.4;
                vec2 grad = vec2(1.9, 0.7) * cos(a1) + vec2(-0.8, 2.3) * cos(a2) * 0.8 + vec2(4.1) * cos(a3) * 0.25;
                vec3 n = normalize(vec3(-grad * 0.045, 1.0));
                vec3 viewDir = length(vViewDir) > 1e-4 ? normalize(vViewDir) : vec3(0.0, 0.0, 1.0);
                vec3 sunDir = normalize(vec3(-0.35, 0.45, 0.82));
                float glint = pow(max(dot(reflect(-viewDir, n), sunDir), 0.0), 160.0);
                float fresnel = pow(1.0 - clamp(viewDir.z, 0.0, 1.0), 4.0);
                vec3 waterColor = mix(floodCol.rgb, flood_sky, 0.5 * fresnel) + vec3(glint * 0.85);
                color.rgb = mix(color.rgb, waterColor, floodCol.a);
              }
            }
          `,
        },
      };
    }
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
    const inTerrain = extension.opts.inTerrain ? 1 : 0;
    const rawBbox = typeof extension.opts.bbox === 'function' ? extension.opts.bbox() : extension.opts.bbox;
    const bbox = rawBbox ?? [0, 0, 0, 0];
    const rawSky = typeof extension.opts.sky === 'function' ? extension.opts.sky() : extension.opts.sky;
    const sky = rawSky ?? [0.68, 0.75, 0.82];
    this.setShaderModuleProps({
      flood: {
        bbox: [bbox[0], bbox[1], bbox[2], bbox[3]],
        params1: [MODE[f.mode], f.mix, f.time, f.hasArrival ? 1 : 0],
        params2: [field.cols, field.rows, extension.opts.feather ?? 8, f.hasImage ? 1 : 0],
        params3: [inTerrain, sky[0], sky[1], sky[2]],
        flood_frames: field.frames,
        flood_arrival: field.arrival,
        flood_image: field.image,
        flood_lut: field.lut,
      },
    });
  }
}
