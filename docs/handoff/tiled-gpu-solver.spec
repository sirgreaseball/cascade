@@FILE src/simulation/sweGpu.ts
@@OLD
// Each step runs three kernels:
//   prepare   one thread: the CFL time step (tightened for the depth the breach adds, as on the
//             CPU) and the breach inflow added at the source cells;
//   update    one thread per cell: the four face fluxes, the update, friction and the flood
//             envelopes, plus a per-workgroup maximum wave speed and edge outflow. A face's flux
//             is computed identically from both sides, so water is conserved;
//   finalize  one workgroup: the next CFL rate, the outflow volume and the clock.
@@NEW
// Only the part of the grid the water can reach is computed. The grid is split into 16 × 16 tiles;
// a tile wakes once a neighbouring tile holds water and never sleeps again. Water moves less than
// a cell per step, so a tile's neighbours are awake before any water can reach them, every face
// that carries flux has both of its cells awake, and the cells of a sleeping tile are dry and
// unchanged. The processor-side solver skips dry cells the same way; computing every cell of the
// grid on every step had made the GPU slower than the CPU on floods covering a few per cent of it.
//
// Each step runs four kernels:
//   prepare   one thread: the CFL time step (tightened for the depth the breach adds, as on the
//             CPU) and the breach inflow added at the source cells;
//   update    one thread per cell of every awake tile: the four face fluxes, the update, friction
//             and the flood envelopes; the cell's wave speed, edge outflow and wetness go to a
//             side buffer. A face's flux is computed identically from both sides, so water is
//             conserved;
//   reduce    one thread per tile: the largest wave speed, the outflow and whether it holds water;
//   finalize  one thread: the next CFL rate, the outflow volume, the clock, and waking the
//             neighbours of every tile with water.
@@END
@@FILE src/simulation/sweGpu.ts
@@OLD
const WORKGROUP = 256;
@@NEW
/** Tile size in cells: one update workgroup. */
const TILE = 16;
@@END
@@FILE src/simulation/sweGpu.ts
@@OLD
  span: f32, t0: f32, groups: u32, pad: u32,
};
@@NEW
  span: f32, t0: f32, tiles: u32, tcols: u32,
  trows: u32, pad0: u32, pad1: u32, pad2: u32,
};
@@END
@@FILE src/simulation/sweGpu.ts
@@OLD
@group(0) @binding(5) var<storage, read_write> partials: array<vec2<f32>>;
@@NEW
// per cell: wave speed rate for the CFL condition, outflow through the domain edge, wet (0 or 1)
@group(0) @binding(5) var<storage, read_write> aux: array<vec4<f32>>;
// per tile: awake (0 or 1)
@group(0) @binding(8) var<storage, read_write> active: array<f32>;
// per tile: largest rate, edge outflow, holds water
@group(0) @binding(9) var<storage, read_write> tileStat: array<vec4<f32>>;
@@END
@@FILE src/simulation/sweGpu.ts
@@OLD
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
@@NEW
@compute @workgroup_size(16, 16)
fn update(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>) {
  if (gid.x >= P.cols || gid.y >= P.rows || active[wid.y * P.tcols + wid.x] < 0.5) {
    return;
  }
  let k = gid.y * P.cols + gid.x;
  var rate = 0.0;
  var edge = 0.0;
  {
    let dt = state[1];
    let sx = dt / P.dx;
    let sy = dt / P.dy;
    let c = gid.x;
    let r = gid.y;
@@END
@@FILE src/simulation/sweGpu.ts
@@OLD
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
@@NEW
    nxt[k] = outCell;
  }
  aux[k] = vec4(rate, edge, select(0.0, 1.0, nxt[k].x > DRY), 0.0);
}
@@END
@@FILE src/simulation/sweGpu.ts
@@OLD
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
@@NEW
@compute @workgroup_size(64)
fn reduce(@builtin(global_invocation_id) gid: vec3<u32>) {
  let t = gid.x;
  if (t >= P.tiles) {
    return;
  }
  if (active[t] < 0.5) {
    tileStat[t] = vec4(0.0);
    return;
  }
  let c0 = (t % P.tcols) * 16u;
  let r0 = (t / P.tcols) * 16u;
  let c1 = min(c0 + 16u, P.cols);
  let r1 = min(r0 + 16u, P.rows);
  var rate = 0.0;
  var out = 0.0;
  var wet = 0.0;
  for (var r = r0; r < r1; r++) {
    for (var c = c0; c < c1; c++) {
      let a = aux[r * P.cols + c];
      rate = max(rate, a.x);
      out += a.y;
      wet = max(wet, a.z);
    }
  }
  tileStat[t] = vec4(rate, out, wet, 0.0);
}

@compute @workgroup_size(1)
fn finalize() {
  let dt = state[1];
  var rate = 0.0;
  var out = 0.0;
  for (var t = 0u; t < P.tiles; t++) {
    let s = tileStat[t];
    rate = max(rate, s.x);
    out += s.y;
    if (s.z < 0.5) {
      continue;
    }
    // Wake the neighbours of a tile holding water; tiles never go back to sleep.
    let tc = i32(t % P.tcols);
    let tr = i32(t / P.tcols);
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        let x = tc + dx;
        let y = tr + dy;
        if (x >= 0 && y >= 0 && x < i32(P.tcols) && y < i32(P.trows)) {
          active[u32(y) * P.tcols + u32(x)] = 1.0;
        }
      }
    }
  }
  state[2] = rate;
  state[4] += out * dt;
  state[0] += dt;
  if (dt > 0.0) {
    state[5] += 1.0;
  }
  if (P.span - state[0] <= 1e-4) {
    state[7] = 1.0;
  }
}
@@END
@@FILE src/simulation/sweGpu.ts
@@OLD
  private readonly groups: number;
@@NEW
  private readonly tiles: number;
  private readonly tcols: number;
  private readonly trows: number;
@@END
@@FILE src/simulation/sweGpu.ts
@@OLD
  private readonly partials: GPUBuffer;
@@NEW
  private readonly aux: GPUBuffer;
  private readonly active: GPUBuffer;
  private readonly tileStat: GPUBuffer;
@@END
@@FILE src/simulation/sweGpu.ts
@@OLD
  private pipelines: { prepare: GPUComputePipeline; update: GPUComputePipeline; finalize: GPUComputePipeline } | null = null;
  private bindAB: GPUBindGroup | null = null;
  private bindBA: GPUBindGroup | null = null;
  private readonly layout: GPUBindGroupLayout;
@@NEW
  private pipelines: { prepare: GPUComputePipeline; update: GPUComputePipeline; reduce: GPUComputePipeline; finalize: GPUComputePipeline } | null = null;
  /** Bind groups of the two field kernels; steps alternate between A → B and B → A. */
  private fieldAB: { prepare: GPUBindGroup; update: GPUBindGroup } | null = null;
  private fieldBA: { prepare: GPUBindGroup; update: GPUBindGroup } | null = null;
  private reduceGroup: GPUBindGroup | null = null;
  private finalizeGroup: GPUBindGroup | null = null;
@@END
@@FILE src/simulation/sweGpu.ts
@@OLD
    this.groups = Math.ceil(n / WORKGROUP);
@@NEW
    this.tcols = Math.ceil(cfg.cols / TILE);
    this.trows = Math.ceil(cfg.rows / TILE);
    this.tiles = this.tcols * this.trows;
@@END
@@FILE src/simulation/sweGpu.ts
@@OLD
    this.params = make(80, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    this.partials = make(this.groups * 8, GPUBufferUsage.STORAGE);
@@NEW
    this.params = make(96, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    this.aux = make(n * 16, GPUBufferUsage.STORAGE);
    this.tileStat = make(this.tiles * 16, GPUBufferUsage.STORAGE);
    this.active = make(this.tiles * 4, storage, this.initialTiles());
@@END
@@FILE src/simulation/sweGpu.ts
@@OLD
    const entry = (binding: number, type: GPUBufferBindingType): GPUBindGroupLayoutEntry => ({ binding, visibility: GPUShaderStage.COMPUTE, buffer: { type } });
    this.layout = device.createBindGroupLayout({
      entries: [entry(0, 'uniform'), entry(1, 'storage'), entry(2, 'storage'), entry(3, 'storage'), entry(4, 'storage'), entry(5, 'storage'), entry(6, 'read-only-storage'), entry(7, 'read-only-storage')],
    });

@@NEW
@@END
@@FILE src/simulation/sweGpu.ts
@@OLD
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
@@NEW
  /** The tiles awake at the start: those holding a breach cell, and their neighbours. */
  private initialTiles(): Float32Array {
    const { cols } = this.cfg;
    const active = new Float32Array(this.tiles);
    for (const s of this.cfg.sources) {
      const tx = Math.floor((s.index % cols) / TILE);
      const ty = Math.floor(Math.floor(s.index / cols) / TILE);
      for (let y = Math.max(0, ty - 1); y <= Math.min(this.trows - 1, ty + 1); y++) {
        for (let x = Math.max(0, tx - 1); x <= Math.min(this.tcols - 1, tx + 1); x++) active[y * this.tcols + x] = 1;
      }
    }
    return active;
  }

  private async init(): Promise<void> {
    const shader = this.device.createShaderModule({ code: SHADER });
    // Each kernel gets a layout of just the bindings it uses, which keeps every one inside the
    // storage-buffer limit any WebGPU device guarantees.
    const pipeline = (entryPoint: string) => this.device.createComputePipelineAsync({ layout: 'auto', compute: { module: shader, entryPoint } });
    const [prepare, update, reduce, finalize] = await Promise.all([pipeline('prepare'), pipeline('update'), pipeline('reduce'), pipeline('finalize')]);
    this.pipelines = { prepare, update, reduce, finalize };
    const bind = (p: GPUComputePipeline, buffers: [number, GPUBuffer][]) =>
      this.device.createBindGroup({ layout: p.getBindGroupLayout(0), entries: buffers.map(([binding, buffer]) => ({ binding, resource: { buffer } })) });
    const field = (cur: GPUBuffer, nxt: GPUBuffer) => ({
      prepare: bind(prepare, [[0, this.params], [1, this.state], [2, cur], [6, this.sources]]),
      update: bind(update, [[0, this.params], [1, this.state], [2, cur], [3, nxt], [4, this.env], [5, this.aux], [7, this.rough], [8, this.active]]),
    });
    this.fieldAB = field(this.bufA, this.bufB);
    this.fieldBA = field(this.bufB, this.bufA);
    this.reduceGroup = bind(reduce, [[0, this.params], [5, this.aux], [8, this.active], [9, this.tileStat]]);
    this.finalizeGroup = bind(finalize, [[0, this.params], [1, this.state], [8, this.active], [9, this.tileStat]]);
  }
@@END
@@FILE src/simulation/sweGpu.ts
@@OLD
    const buf = new ArrayBuffer(80);
@@NEW
    const buf = new ArrayBuffer(96);
@@END
@@FILE src/simulation/sweGpu.ts
@@OLD
    u[18] = this.groups;
@@NEW
    u[18] = this.tiles;
    u[19] = this.tcols;
    u[20] = this.trows;
@@END
@@FILE src/simulation/sweGpu.ts
@@OLD
    const { prepare, update, finalize } = this.pipelines!;
@@NEW
    const { prepare, update, reduce, finalize } = this.pipelines!;
    const reduceWorkgroups = Math.ceil(this.tiles / 64);
@@END
@@FILE src/simulation/sweGpu.ts
@@OLD
        for (let i = 0; i < this.chunk; i++) {
          pass.setBindGroup(0, i % 2 === 0 ? this.bindAB : this.bindBA);
          pass.setPipeline(prepare);
          pass.dispatchWorkgroups(1);
          pass.setPipeline(update);
          pass.dispatchWorkgroups(this.groups);
          pass.setPipeline(finalize);
          pass.dispatchWorkgroups(1);
        }
@@NEW
        for (let i = 0; i < this.chunk; i++) {
          const g = (i % 2 === 0 ? this.fieldAB : this.fieldBA)!;
          pass.setPipeline(prepare);
          pass.setBindGroup(0, g.prepare);
          pass.dispatchWorkgroups(1);
          pass.setPipeline(update);
          pass.setBindGroup(0, g.update);
          pass.dispatchWorkgroups(this.tcols, this.trows);
          pass.setPipeline(reduce);
          pass.setBindGroup(0, this.reduceGroup);
          pass.dispatchWorkgroups(reduceWorkgroups);
          pass.setPipeline(finalize);
          pass.setBindGroup(0, this.finalizeGroup);
          pass.dispatchWorkgroups(1);
        }
@@END
