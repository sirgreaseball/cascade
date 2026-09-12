// A triangle mesh of the scenario DEM for the "water skin": the flood texture is mapped onto it
// in 3D, so updating the flood is one texture upload rather than re-draping a layer onto every
// terrain tile (which cost integrated GPUs a 50–80 ms frame on each update).

import type { GridGeometry } from '@/lib/geo/grid';

export interface GridMesh {
  /** Mesh vertices are metre offsets (x east, y north, z up) from this lng/lat. */
  anchor: [number, number];
  mesh: {
    attributes: {
      POSITION: { value: Float32Array; size: 3 };
      TEXCOORD_0: { value: Float32Array; size: 2 };
    };
    indices: { value: Uint32Array; size: 1 };
  };
}

/**
 * Builds the mesh at cell centres, subsampled so it stays under `maxVertices`. Only quads with a
 * corner below `maxElevation` are kept: water released from a reservoir cannot rise above its
 * crest, so the mountainsides above it are never drawn (most of the area in Himalayan valleys).
 */
export function buildGridMesh(dem: Float32Array, g: GridGeometry, lift: number, maxVertices = 160_000, maxElevation = Infinity): GridMesh {
  const step = Math.max(1, Math.ceil(Math.sqrt((g.cols * g.rows) / maxVertices)));
  const cs: number[] = [];
  const rs: number[] = [];
  for (let c = 0; c < g.cols; c += step) cs.push(c);
  if (cs[cs.length - 1] !== g.cols - 1) cs.push(g.cols - 1);
  for (let r = 0; r < g.rows; r += step) rs.push(r);
  if (rs[rs.length - 1] !== g.rows - 1) rs.push(g.rows - 1);
  const nx = cs.length;
  const ny = rs.length;
  const anchor: [number, number] = [(g.bbox[0] + g.bbox[2]) / 2, (g.bbox[1] + g.bbox[3]) / 2];
  const mLng = 111_320 * Math.cos((anchor[1] * Math.PI) / 180);
  const mLat = 110_574;
  const positions = new Float32Array(nx * ny * 3);
  const texCoords = new Float32Array(nx * ny * 2);
  for (let j = 0; j < ny; j++) {
    const r = rs[j];
    const lat = g.bbox[3] - (r + 0.5) * g.latStep;
    for (let i = 0; i < nx; i++) {
      const c = cs[i];
      const v = j * nx + i;
      const lng = g.bbox[0] + (c + 0.5) * g.lngStep;
      positions[v * 3] = (lng - anchor[0]) * mLng;
      positions[v * 3 + 1] = (lat - anchor[1]) * mLat;
      // The skin has to sit above the highest ground each vertex stands for, not the cell average.
      // The terrain drawn underneath is far finer than this grid, so a vertex placed on the mean
      // let every bank and spur between samples stab up through the water surface.
      let z = dem[r * g.cols + c];
      const rHi = Math.min(g.rows - 1, r + Math.max(step - 1, 1));
      const cHi = Math.min(g.cols - 1, c + Math.max(step - 1, 1));
      for (let rr = Math.max(0, r - 1); rr <= rHi; rr++) {
        const base = rr * g.cols;
        for (let cc = Math.max(0, c - 1); cc <= cHi; cc++) if (dem[base + cc] > z) z = dem[base + cc];
      }
      positions[v * 3 + 2] = z + lift;
      texCoords[v * 2] = (c + 0.5) / g.cols;
      texCoords[v * 2 + 1] = (r + 0.5) / g.rows;
    }
  }
  const all = new Uint32Array((nx - 1) * (ny - 1) * 6);
  let o = 0;
  const limit = maxElevation + lift;
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      if (Math.min(positions[a * 3 + 2], positions[b * 3 + 2], positions[c * 3 + 2], positions[d * 3 + 2]) >= limit) continue;
      const indices = all;
      indices[o++] = a;
      indices[o++] = c;
      indices[o++] = b;
      indices[o++] = b;
      indices[o++] = c;
      indices[o++] = d;
    }
  }
  return {
    anchor,
    mesh: {
      attributes: { POSITION: { value: positions, size: 3 }, TEXCOORD_0: { value: texCoords, size: 2 } },
      indices: { value: all.slice(0, o), size: 1 },
    },
  };
}
