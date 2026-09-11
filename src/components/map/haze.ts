// Aerial perspective for the 3D map: distant ground fades into the sky's horizon colour, as in
// Google Earth. The haze grows with distance measured in camera altitudes, so it reads the same
// at every zoom: clear below the camera, thickening towards the horizon. Injected into the
// terrain tiles and the water surface; never used on pickable layers (it would tint picking
// colours).

import { LayerExtension } from '@deck.gl/core';
import type { Layer } from '@deck.gl/core';

export interface HazeOptions {
  /** Horizon colour, 0–1 RGB; match the sky's horizon. */
  color: [number, number, number];
  /** Largest share of the colour at the far horizon, 0–1. */
  strength: number;
}

export class HazeExtension extends LayerExtension<HazeOptions> {
  static extensionName = 'HazeExtension';

  getShaders(this: Layer, extension: this) {
    const [r, g, b] = extension.opts.color.map((v) => v.toFixed(3));
    const strength = extension.opts.strength.toFixed(3);
    return {
      inject: {
        'vs:#decl': 'out float vHaze;',
        'vs:DECKGL_FILTER_GL_POSITION': `
          float hazeAltitude = max(project.cameraPosition.z, 1e-6);
          float hazeReach = length(geometry.position.xyz - project.cameraPosition) / hazeAltitude;
          vHaze = ${strength} * smoothstep(1.6, 7.5, hazeReach);`,
        'fs:#decl': 'in float vHaze;',
        'fs:#main-end': `fragColor.rgb = mix(fragColor.rgb, vec3(${r}, ${g}, ${b}), vHaze);`,
      },
    };
  }
}
