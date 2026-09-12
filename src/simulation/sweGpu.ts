/// <reference types="@webgpu/types" />
// 2D shallow-water solver on the GPU (WebGPU compute). The same scheme as swe.ts — HLL fluxes,
// hydrostatic reconstruction, point-implicit Manning friction, open outflow boundaries and the
// speed cap — with every cell updated in parallel, in single precision. The time step is found
// on the GPU too, so the CPU does not wait on the GPU step by step.
//
// Each step runs three kernels:
//   prepare   one thread: the CFL time step (tightened for the depth the breach adds, as on the
//             CPU) and the breach inflow added at the source cells;
//   update    one thread per cell: the four face fluxes, the update, friction and the flood
//             envelopes, plus a per-workgroup maximum wave speed and edge outflow. A face's flux
//             is computed identically from both sides, so water is conserved;
//   finalize  one workgroup: the next CFL rate, the outflow volume and the clock.
//
// The breach reservoir stays on the CPU. It drains in batches of up to 30 simulated seconds:
// for each batch the CPU sets the inflow at its start and end (from the tailwater read back at
// the end of the previous one), the GPU interpolates it in time and reports the volume it added,
// which then leaves the reservoir.

import { BreachReservoir, interpolateHydrograph } from './hydrograph.ts';
import type { EngineConfig } from './types.ts';

const G = 9.81;
const WORKGROUP = 256;
/** Longest batch (simulated seconds) over which the breach inflow is interpolated. */
const MAX_SPAN = 30;
/** GPU time per submission (ms): short enough for the map to draw between them. */
const GPU_SLICE_MS = 8;

const SHADER = /* wgsl */ `
const G: f32 = 9.81;
const DRY: f32 = 1e-5;
const VEL_DEPTH: f32 = 1e-3;
const MAX_SPEED: f32 = 45.0;

struct Params {
  cols: u32, rows: u32, n: u32, nSources: u32,
  dx: f32, dy: f32, cellArea: f32, cfl: f32,
  maxDt: f32, n2: f32, wet: f32, jet: f32,
  dirX: f32, dirY: f32, q0: f32, q1: f32,
  span: f32, t0: f32, groups: u32, pad: u32,
};

@group(0) @binding(0) var<uniform> P: Params;
// tau (batch clock), dt, CFL rate, inflow volume, outflow volume, steps, inflow rate, done
@group(0) @binding(1) var<storage, read_write> state: array<f32>;
// per cell: depth, x-discharge, y-discharge, bed elevation
@group(0) @binding(2) var<storage, read_write> cur: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> nxt: array<vec4<f32>>;
// Manning n squared per cell, from land cover (or the single value repeated).
@group(0) @binding(7) var<storage, read> rough: array<f32>;
// per cell: peak depth, arrival time, peak speed, peak depth x velocity
@group(0) @binding(4) var<storage, read_write> env: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read_write> partials: array<vec2<f32>>;
// breach cells: index (exact as f32), weight
@group(0) @binding(6) var<storage, read> sources: array<vec2<f32>>;

fn hll(hL: f32, uL: f32, vL: f32, hR: f32, uR: f32, vR: f32) -> vec3<f32> {
  let cL = sqrt(G * hL);
  let cR = sqrt(G * hR);
  var sL: f32;
  var sR: f32;
  if (hL <= DRY) {
    sL = uR - 2.0 * cR;
    sR = uR + cR;
  } else if (hR <= DRY) {
    sL = uL - cL;
    sR = uL + 2.0 * cL;
  } else {
    sL = min(uL - cL, uR - cR);
    sR = max(uL + cL, uR + cR);
  }
  let qL = hL * uL;
  let qR = hR * uR;
  if (sL >= 0.0) {
    return vec3(qL, qL * uL + 0.5 * G * hL * hL, qL * vL);
  }
  if (sR <= 0.0) {
    return vec3(qR, qR * uR + 0.5 * G * hR * hR, qR * vR);
  }
  let inv = 1.0 / (sR - sL);
  let s = sL * sR;
  return vec3(
    (sR * qL - sL * qR + s * (hR - hL)) * inv,
    (sR * (qL * uL + 0.5 * G * hL * hL) - sL * (qR * uR + 0.5 * G * hR * hR) + s * (qR - qL)) * inv,
    (sR * qL * vL - sL * qR * vR + s * (hR * vR - hL * vL)) * inv,
  );
}

fn vel(c: vec4<f32>) -> vec2<f32> {
  if (c.x > VEL_DEPTH) {
    return vec2(c.y / c.x, c.z / c.x);
  }
  return vec2(0.0, 0.0);
}

@compute @workgroup_size(1)
fn prepare() {
  if (state[7] > 0.5) {
    state[1] = 0.0;
    return;
  }
  let tau = state[0];
  let left = P.span - tau;
  var dt = min(P.maxDt, left);
  if (state[2] > 0.0) {
    dt = min(dt, P.cfl / state[2]);
  }
  let q = P.q0 + (P.q1 - P.q0) * clamp((tau + 0.5 * dt) / P.span, 0.0, 1.0);
  if (q > 0.0) {
    for (var it = 0; it < 2; it++) {
      var hs = 0.0;
      for (var i = 0u; i < P.nSources; i++) {
        let s = sources[i];
        hs = max(hs, cur[u32(s.x)].x + q * dt * s.y / P.cellArea);
      }
      let c = sqrt(G * hs);
      dt = min(dt, P.cfl / ((c + P.jet) / P.dx + (c + P.jet) / P.dy));
    }
  }
  dt = min(max(dt, 1e-4), left);
  let vol = q * dt;
  if (vol > 0.0) {
    for (var i = 0u; i < P.nSources; i++) {
      let s = sources[i];
      let k = u32(s.x);
      let add = vol * s.y / P.cellArea;
      var c = cur[k];
      c.x += add;
      c.y += add * P.jet * P.dirX;
      c.z += add * P.jet * P.dirY;
      cur[k] = c;
    }
  }
  state[1] = dt;
  state[3] += vol;
  state[6] = q;
}

var<workgroup> wRate: array<f32, 256>;
var<workgroup> wOut: array<f32, 256>;

@compute @workgroup_size(256)
fn update(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wid: vec3<u32>) {
  let k = gid.x;
  var rate = 0.0;
  var edge = 0.0;
  if (k < P.n) {
    let dt = state[1];
    let sx = dt / P.dx;
    let sy = dt / P.dy;
    let c = k % P.cols;
    let r = k / P.cols;
    let me = cur[k];
    let hk = me.x;
    let zk = me.w;
    let uv = vel(me);
    let hG = 0.5 * G;
    var dH = 0.0;
    var dU = 0.0;
    var dV = 0.0;
    // West face: this cell is on the right.
    if (c > 0u) {
      let o = cur[k - 1u];
      if (o.x > DRY || hk > DRY) {
        let zF = max(o.w, zk);
        let hLs = max(0.0, o.x + o.w - zF);
        let hRs = max(0.0, hk + zk - zF);
        let ov = vel(o);
        let F = hll(hLs, ov.x, ov.y, hRs, uv.x, uv.y);
        dH += sx * F.x;
        dU += sx * (F.y + hG * (hk * hk - hRs * hRs));
        dV += sx * F.z;
      }
    } else if (hk > DRY) {
      var F = hll(hk, min(uv.x, 0.0), uv.y, hk, uv.x, uv.y);
      if (F.x > 0.0) {
        F = vec3(0.0, hG * hk * hk, 0.0);
      }
      dH += sx * F.x;
      dU += sx * F.y;
      dV += sx * F.z;
      edge -= F.x * P.dy;
    }
    // East face: this cell is on the left.
    if (c + 1u < P.cols) {
      let o = cur[k + 1u];
      if (hk > DRY || o.x > DRY) {
        let zF = max(zk, o.w);
        let hLs = max(0.0, hk + zk - zF);
        let hRs = max(0.0, o.x + o.w - zF);
        let ov = vel(o);
        let F = hll(hLs, uv.x, uv.y, hRs, ov.x, ov.y);
        dH -= sx * F.x;
        dU -= sx * (F.y + hG * (hk * hk - hLs * hLs));
        dV -= sx * F.z;
      }
    } else if (hk > DRY) {
      var F = hll(hk, uv.x, uv.y, hk, max(uv.x, 0.0), uv.y);
      if (F.x < 0.0) {
        F = vec3(0.0, hG * hk * hk, 0.0);
      }
      dH -= sx * F.x;
      dU -= sx * F.y;
      dV -= sx * F.z;
      edge += F.x * P.dy;
    }
    // North face (normal velocity v, tangential u): this cell is to the south.
    if (r > 0u) {
      let o = cur[k - P.cols];
      if (o.x > DRY || hk > DRY) {
        let zF = max(o.w, zk);
        let hNs = max(0.0, o.x + o.w - zF);
        let hSs = max(0.0, hk + zk - zF);
        let ov = vel(o);
        let F = hll(hNs, ov.y, ov.x, hSs, uv.y, uv.x);
        dH += sy * F.x;
        dV += sy * (F.y + hG * (hk * hk - hSs * hSs));
        dU += sy * F.z;
      }
    } else if (hk > DRY) {
      var F = hll(hk, min(uv.y, 0.0), uv.x, hk, uv.y, uv.x);
      if (F.x > 0.0) {
        F = vec3(0.0, hG * hk * hk, 0.0);
      }
      dH += sy * F.x;
      dV += sy * F.y;
      dU += sy * F.z;
      edge -= F.x * P.dx;
    }
    // South face: this cell is to the north.
    if (r + 1u < P.rows) {
      let o = cur[k + P.cols];
      if (hk > DRY || o.x > DRY) {
        let zF = max(zk, o.w);
        let hNs = max(0.0, hk + zk - zF);
        let hSs = max(0.0, o.x + o.w - zF);
        let ov = vel(o);
        let F = hll(hNs, uv.y, uv.x, hSs, ov.y, ov.x);
        dH -= sy * F.x;
        dV -= sy * (F.y + hG * (hk * hk - hNs * hNs));
        dU -= sy * F.z;
      }
    } else if (hk > DRY) {
      var F = hll(hk, uv.y, uv.x, hk, max(uv.y, 0.0), uv.x);
      if (F.x < 0.0) {
        F = vec3(0.0, hG * hk * hk, 0.0);
      }
      dH -= sy * F.x;
      dV -= sy * F.y;
      dU -= sy * F.z;
      edge += F.x * P.dx;
    }
    // Update, friction and envelopes.
    let hn = hk + dH;
    var outCell = vec4(0.0, 0.0, 0.0, zk);
    if (hn > 0.0) {
      var qx = me.y + dU;
      var qy = me.z + dV;
      var speed = 0.0;
      if (hn < VEL_DEPTH) {
        qx = 0.0;
        qy = 0.0;
      } else {
        var u = qx / hn;
        var v = qy / hn;
        speed = sqrt(u * u + v * v);
        if (speed > MAX_SPEED) {
          let s = MAX_SPEED / speed;
          u *= s;
          v *= s;
          speed = MAX_SPEED;
        }
        let damp = 1.0 + dt * G * rough[k] * speed / (hn * pow(hn, 1.0 / 3.0));
        u /= damp;
        v /= damp;
        speed /= damp;
        qx = u * hn;
        qy = v * hn;
        let cw = sqrt(G * hn);
        rate = (abs(u) + cw) / P.dx + (abs(v) + cw) / P.dy;
      }
      outCell = vec4(hn, qx, qy, zk);
      var e = env[k];
      if (hn > e.x) {
        e.x = hn;
      }
      if (hn >= P.wet) {
        if (e.y < 0.0) {
          e.y = P.t0 + state[0] + dt;
        }
        e.w = max(e.w, hn * speed);
        e.z = max(e.z, speed);
      }
      env[k] = e;
    }
    nxt[k] = outCell;
  }
  wRate[li] = rate;
  wOut[li] = edge;
  workgroupBarrier();
  for (var s = 128u; s > 0u; s = s >> 1u) {
    if (li < s) {
      wRate[li] = max(wRate[li], wRate[li + s]);
      wOut[li] = wOut[li] + wOut[li + s];
    }
    workgroupBarrier();
  }
  if (li == 0u) {
    partials[wid.x] = vec2(wRate[0], wOut[0]);
  }
}

var<workgroup> fRate: array<f32, 256>;
var<workgroup> fOut: array<f32, 256>;

@compute @workgroup_size(256)
fn finalize(@builtin(local_invocation_index) li: u32) {
  var r = 0.0;
  var o = 0.0;
  for (var i = li; i < P.groups; i += 256u) {
    let p = partials[i];
    r = max(r, p.x);
    o += p.y;
  }
  fRate[li] = r;
  fOut[li] = o;
  workgroupBarrier();
  for (var s = 128u; s > 0u; s = s >> 1u) {
    if (li < s) {
      fRate[li] = max(fRate[li], fRate[li + s]);
      fOut[li] = fOut[li] + fOut[li + s];
    }
    workgroupBarrier();
  }
  if (li == 0u) {
    let dt = state[1];
    state[2] = fRate[0];
    state[4] += fOut[0] * dt;
    state[0] += dt;
    if (dt > 0.0) {
      state[5] += 1.0;
    }
    if (P.span - state[0] <= 1e-4) {
      state[7] = 1.0;
    }
  }
}
`;

export class GpuShallowWaterSolver {
  t = 0;
  steps = 0;
  inflowVolume = 0;
  outflowVolume = 0;
  /** Breach inflow at the end of the last batch (m³/s). */
  inflowRate = 0;
  /** Depth per cell and flood envelopes as of the last read-back. */
  readonly depth: Float32Array;
  readonly maxDepth: Float32Array;
  readonly arrival: Float32Array;
  readonly maxSpeed: Float32Array;
  readonly maxDepthVelocity: Float32Array;

  private readonly cfg: EngineConfig;
  private readonly device: GPUDevice;
  private readonly n: number;
  private readonly groups: number;
  private readonly cellArea: number;
  private readonly bufA: GPUBuffer;
  private readonly bufB: GPUBuffer;
  private readonly env: GPUBuffer;
  private readonly state: GPUBuffer;
  private readonly params: GPUBuffer;
  private readonly probe: GPUBuffer;
  private readonly fieldRead: GPUBuffer;
  private readonly envRead: GPUBuffer;
  private readonly partials: GPUBuffer;
  private readonly sources: GPUBuffer;
  /** Manning n² per cell (the single value repeated when land cover is not in use). */
  private readonly rough: GPUBuffer;
  private pipelines: { prepare: GPUComputePipeline; update: GPUComputePipeline; finalize: GPUComputePipeline } | null = null;
  private bindAB: GPUBindGroup | null = null;
  private bindBA: GPUBindGroup | null = null;
  private readonly layout: GPUBindGroupLayout;
  private readonly reservoir: BreachReservoir | null;
  private readonly datum: number;
  private readonly baseFlow: number;
  private readonly thalweg: number;
  private tailwater: number;
  private rate = 0;
  /** Steps encoded per submission, adapted to how many a batch needs (always even). */
  private chunk = 32;
  /** Wall time per step of the last submission (ms), for sizing the next. */
  private msPerStep = 0;
  private lost: string | null = null;

  /** A solver on the GPU, or null when this browser has no WebGPU adapter. */
  static async create(cfg: EngineConfig): Promise<GpuShallowWaterSolver | null> {
    const gpu = (globalThis as { navigator?: Navigator }).navigator?.gpu;
    if (!gpu) return null;
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    const solver = new GpuShallowWaterSolver(cfg, device);
    await solver.init();
    return solver;
  }

  private constructor(cfg: EngineConfig, device: GPUDevice) {
    this.cfg = cfg;
    this.device = device;
    device.lost.then((info) => {
      this.lost = info.message || 'The GPU device was lost.';
    });
    const n = cfg.cols * cfg.rows;
    this.n = n;
    this.groups = Math.ceil(n / WORKGROUP);
    this.cellArea = cfg.dx * cfg.dy;
    this.depth = new Float32Array(n);
    this.maxDepth = new Float32Array(n);
    this.arrival = new Float32Array(n).fill(-1);
    this.maxSpeed = new Float32Array(n);
    this.maxDepthVelocity = new Float32Array(n);

    const field = new Float32Array(n * 4);
    for (let k = 0; k < n; k++) field[k * 4 + 3] = cfg.elevation[k];
    const envInit = new Float32Array(n * 4);
    for (let k = 0; k < n; k++) envInit[k * 4 + 1] = -1;
    const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    const make = (size: number, usage: number, data?: Float32Array) => {
      const b = device.createBuffer({ size: Math.max(16, Math.ceil(size / 16) * 16), usage, mappedAtCreation: !!data });
      if (data) {
        new Float32Array(b.getMappedRange()).set(data);
        b.unmap();
      }
      return b;
    };
    this.bufA = make(n * 16, storage, field);
    this.bufB = make(n * 16, storage, field);
    this.env = make(n * 16, storage, envInit);
    this.state = make(32, storage, new Float32Array(8));
    this.params = make(80, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    this.partials = make(this.groups * 8, GPUBufferUsage.STORAGE);
    const src = new Float32Array(Math.max(cfg.sources.length, 1) * 2);
    cfg.sources.forEach((s, i) => {
      src[i * 2] = s.index;
      src[i * 2 + 1] = s.weight;
    });
    this.sources = make(src.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, src);
    // Roughness is always a field on the GPU, so the kernel needs no branch: without land cover
    // every cell simply carries the same value.
    const rough = new Float32Array(n);
    const mf = cfg.manningField;
    for (let k = 0; k < n; k++) {
      const nn = mf ? mf[k] : cfg.manning;
      rough[k] = nn * nn;
    }
    this.rough = make(n * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, rough);
    this.probe = make(48, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
    this.fieldRead = make(n * 16, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
    this.envRead = make(n * 16, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);

    const entry = (binding: number, type: GPUBufferBindingType): GPUBindGroupLayoutEntry => ({ binding, visibility: GPUShaderStage.COMPUTE, buffer: { type } });
    this.layout = device.createBindGroupLayout({
      entries: [entry(0, 'uniform'), entry(1, 'storage'), entry(2, 'storage'), entry(3, 'storage'), entry(4, 'storage'), entry(5, 'storage'), entry(6, 'read-only-storage'), entry(7, 'read-only-storage')],
    });

    // Breach coupling, as InflowBoundary does on the CPU.
    if (cfg.breach) {
      this.reservoir = new BreachReservoir(cfg.breach.event);
      this.datum = cfg.breach.datumElevation;
      this.baseFlow = cfg.breach.event.baseFlow;
    } else {
      this.reservoir = null;
      this.datum = 0;
      this.baseFlow = 0;
    }
    let thalweg = cfg.sources[0]?.index ?? 0;
    for (const s of cfg.sources) if (cfg.elevation[s.index] < cfg.elevation[thalweg]) thalweg = s.index;
    this.thalweg = thalweg;
    this.tailwater = cfg.elevation[thalweg];
  }

  private async init(): Promise<void> {
    const shader = this.device.createShaderModule({ code: SHADER });
    const layout = this.device.createPipelineLayout({ bindGroupLayouts: [this.layout] });
    const pipeline = (entryPoint: string) => this.device.createComputePipelineAsync({ layout, compute: { module: shader, entryPoint } });
    const [prepare, update, finalize] = await Promise.all([pipeline('prepare'), pipeline('update'), pipeline('finalize')]);
    this.pipelines = { prepare, update, finalize };
    const group = (cur: GPUBuffer, nxt: GPUBuffer) =>
      this.device.createBindGroup({
        layout: this.layout,
        entries: [this.params, this.state, cur, nxt, this.env, this.partials, this.sources, this.rough].map((buffer, binding) => ({ binding, resource: { buffer } })),
      });
    this.bindAB = group(this.bufA, this.bufB);
    this.bindBA = group(this.bufB, this.bufA);
  }

  private writeParams(q0: number, q1: number, span: number, jet: number): void {
    const cfg = this.cfg;
    const buf = new ArrayBuffer(80);
    const u = new Uint32Array(buf);
    const f = new Float32Array(buf);
    u[0] = cfg.cols;
    u[1] = cfg.rows;
    u[2] = this.n;
    u[3] = cfg.sources.length;
    f[4] = cfg.dx;
    f[5] = cfg.dy;
    f[6] = this.cellArea;
    f[7] = 0.45;
    f[8] = 10;
    f[9] = cfg.manning * cfg.manning;
    f[10] = cfg.wetThreshold;
    f[11] = jet;
    f[12] = cfg.sourceDirection[0];
    f[13] = cfg.sourceDirection[1];
    f[14] = q0;
    f[15] = q1;
    f[16] = span;
    f[17] = this.t;
    u[18] = this.groups;
    this.device.queue.writeBuffer(this.params, 0, buf);
  }

  /** Breach inflow at the start and end of a batch, and the jet speed, from the reservoir. */
  private batchInflow(span: number): { q0: number; q1: number; jet: number } {
    const r = this.reservoir;
    if (!r) return { q0: interpolateHydrograph(this.cfg.hydrograph, this.t), q1: interpolateHydrograph(this.cfg.hydrograph, this.t + span), jet: 3 };
    const tw = this.tailwater - this.datum;
    let q0 = r.outflow(this.t, r.volume, tw);
    let q1 = r.outflow(this.t + span, Math.max(r.volume - q0 * span, 0), tw);
    // Never release more than the reservoir holds.
    const mean = (q0 + q1) / 2;
    if (mean * span > r.volume && mean > 0) {
      const s = r.volume / (mean * span);
      q0 *= s;
      q1 *= s;
    }
    const jet = Math.min(Math.sqrt(G * (2 / 3) * r.headOverInvert(this.t + span / 2)), 25);
    return { q0: q0 + this.baseFlow, q1: q1 + this.baseFlow, jet };
  }

  /** Runs until simulated time reaches `target`. */
  async advanceTo(target: number): Promise<void> {
    const { prepare, update, finalize } = this.pipelines!;
    while (this.t < target - 1e-6) {
      if (this.lost) throw new Error(`GPU solver stopped: ${this.lost}`);
      const span = Math.min(target - this.t, MAX_SPAN);
      const { q0, q1, jet } = this.batchInflow(span);
      this.writeParams(q0, q1, span, jet);
      this.device.queue.writeBuffer(this.state, 0, new Float32Array([0, 0, this.rate, 0, 0, 0, q0, 0]));
      let s: Float32Array;
      for (;;) {
        const started = performance.now();
        const enc = this.device.createCommandEncoder();
        const pass = enc.beginComputePass();
        for (let i = 0; i < this.chunk; i++) {
          pass.setBindGroup(0, i % 2 === 0 ? this.bindAB : this.bindBA);
          pass.setPipeline(prepare);
          pass.dispatchWorkgroups(1);
          pass.setPipeline(update);
          pass.dispatchWorkgroups(this.groups);
          pass.setPipeline(finalize);
          pass.dispatchWorkgroups(1);
        }
        pass.end();
        enc.copyBufferToBuffer(this.state, 0, this.probe, 0, 32);
        // After an even number of steps the latest state is in buffer A.
        enc.copyBufferToBuffer(this.bufA, this.thalweg * 16, this.probe, 32, 16);
        this.device.queue.submit([enc.finish()]);
        await this.probe.mapAsync(GPUMapMode.READ);
        s = new Float32Array(this.probe.getMappedRange().slice(0));
        this.probe.unmap();
        if (!Number.isFinite(s[0]) || !Number.isFinite(s[2])) throw new Error('GPU solver produced an invalid time step.');
        this.msPerStep = (performance.now() - started) / this.chunk;
        if (s[7] > 0.5) break;
      }
      const steps = s[5];
      // Size the next submission to fit the batch with a little to spare, but keep each one to
      // about 8 ms of GPU work: the map shares the GPU and draws between submissions.
      const budget = this.msPerStep > 0 ? Math.floor(GPU_SLICE_MS / this.msPerStep) : 32;
      this.chunk = Math.min(512, Math.max(8, Math.ceil(Math.min(steps * 1.25, budget) / 2) * 2));
      const tau = s[0];
      this.t += tau;
      this.steps += steps;
      this.inflowVolume += s[3];
      this.outflowVolume += s[4];
      this.inflowRate = s[6];
      this.rate = s[2];
      this.tailwater = this.cfg.elevation[this.thalweg] + s[8];
      if (this.reservoir) this.reservoir.volume = Math.max(this.reservoir.volume - Math.max(s[3] - this.baseFlow * tau, 0), 0);
    }
  }

  /** Copies the depth (and, when asked, the envelopes) back from the GPU. */
  async read(envelopes: boolean): Promise<void> {
    const bytes = this.n * 16;
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(this.bufA, 0, this.fieldRead, 0, bytes);
    if (envelopes) enc.copyBufferToBuffer(this.env, 0, this.envRead, 0, bytes);
    this.device.queue.submit([enc.finish()]);
    await this.fieldRead.mapAsync(GPUMapMode.READ, 0, bytes);
    const f = new Float32Array(this.fieldRead.getMappedRange(0, bytes));
    for (let k = 0; k < this.n; k++) this.depth[k] = f[k * 4];
    this.fieldRead.unmap();
    if (envelopes) {
      await this.envRead.mapAsync(GPUMapMode.READ, 0, bytes);
      const e = new Float32Array(this.envRead.getMappedRange(0, bytes));
      for (let k = 0; k < this.n; k++) {
        this.maxDepth[k] = e[k * 4];
        this.arrival[k] = e[k * 4 + 1];
        this.maxSpeed[k] = e[k * 4 + 2];
        this.maxDepthVelocity[k] = e[k * 4 + 3];
      }
      this.envRead.unmap();
    }
  }

  depthCentimetres(): Uint16Array {
    const out = new Uint16Array(this.n);
    for (let k = 0; k < this.n; k++) {
      const v = Math.round(this.depth[k] * 100);
      out[k] = v > 65535 ? 65535 : v < 0 ? 0 : v;
    }
    return out;
  }

  measure(): { storedVolume: number; wetArea: number; maxDepth: number } {
    let stored = 0;
    let wet = 0;
    let maxDepth = 0;
    for (let k = 0; k < this.n; k++) {
      const h = this.depth[k];
      stored += h;
      if (h >= this.cfg.wetThreshold) wet++;
      if (h > maxDepth) maxDepth = h;
    }
    return { storedVolume: stored * this.cellArea, wetArea: wet * this.cellArea, maxDepth };
  }

  dispose(): void {
    this.device.destroy();
  }
}
