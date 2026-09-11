// A water surface for the 3D flood: sun glints on moving ripples and the sky mirrored at
// grazing angles, over the depth colours. Ripples are driven by simulated time, so they move
// while the flood plays and hold still when paused, without forcing extra redraws.

import { LayerExtension } from '@deck.gl/core';
import type { Layer } from '@deck.gl/core';

const uniformBlock = /* glsl */ `\
layout(std140) uniform waterUniforms {
  float time;
} water;
`;

const waterModule = {
  name: 'water',
  vs: uniformBlock,
  fs: uniformBlock,
  getUniforms: (opts?: { time?: number }) => (opts && typeof opts.time === 'number' ? { time: opts.time } : {}),
  uniformTypes: { time: 'f32' },
} as const;

export interface WaterOptions {
  /** Grid size, so ripples are scaled in cells. */
  cols: number;
  rows: number;
  /** Colour mirrored at grazing angles (0–1 RGB): the sky's horizon. */
  sky: [number, number, number];
}

export class WaterExtension extends LayerExtension<WaterOptions> {
  static extensionName = 'WaterExtension';

  getShaders(this: Layer, extension: this) {
    const { cols, rows } = extension.opts;
    const [r, g, b] = extension.opts.sky.map((v) => v.toFixed(3));
    return {
      modules: [waterModule],
      inject: {
        'fs:#main-end': `
          if (fragColor.a > 0.001) {
            vec2 p = vTexCoord * vec2(${cols.toFixed(1)}, ${rows.toFixed(1)});
            float t = water.time;
            // Three wave trains; their analytic gradient tilts the surface normal.
            float a1 = p.x * 1.9 + p.y * 0.7 + t * 1.6;
            float a2 = -p.x * 0.8 + p.y * 2.3 + t * 1.2;
            float a3 = (p.x + p.y) * 4.1 - t * 2.4;
            vec2 grad = vec2(1.9, 0.7) * cos(a1) + vec2(-0.8, 2.3) * cos(a2) * 0.8 + vec2(4.1) * cos(a3) * 0.25;
            vec3 n = normalize(vec3(-grad * 0.045, 1.0));
            vec3 viewDir = normalize(cameraPosition - position_commonspace.xyz);
            vec3 sunDir = normalize(vec3(-0.35, 0.45, 0.82));
            float glint = pow(max(dot(reflect(-viewDir, n), sunDir), 0.0), 160.0);
            float fresnel = pow(1.0 - clamp(viewDir.z, 0.0, 1.0), 4.0);
            fragColor.rgb = mix(fragColor.rgb, vec3(${r}, ${g}, ${b}), 0.5 * fresnel) + vec3(glint * 0.85);
          }`,
      },
    };
  }

  draw(this: Layer) {
    this.setShaderModuleProps({ water: { time: (this.props as { waterTime?: number }).waterTime ?? 0 } });
  }
}
