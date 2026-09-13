// Web Worker for calculating per-vertex terrain normals off the main thread.
// Uses structured cloning only (no transfer lists) to maintain project architecture invariants.

export interface NormalsRequest {
  id: number;
  pos: Float32Array;
  idx: Uint32Array | Uint16Array;
  metresPerUnit: number;
}

export interface NormalsResponse {
  id: number;
  normal: Float32Array;
}

export function computeNormals(pos: Float32Array, idx: Uint32Array | Uint16Array, metresPerUnit: number): Float32Array {
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
  return acc;
}

if (typeof self !== 'undefined' && typeof window === 'undefined') {
  self.onmessage = (e: MessageEvent<NormalsRequest>) => {
    const { id, pos, idx, metresPerUnit } = e.data;
    const normal = computeNormals(pos, idx, metresPerUnit);
    (self as unknown as Worker).postMessage({ id, normal } satisfies NormalsResponse);
  };
}
