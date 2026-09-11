// Drives one engine through the simulated duration and emits frames/summaries. The worker and
// the main-thread fallback both run exactly this class, so there is a single call site for
// each solver and the two paths cannot drift apart.

import { ShallowWaterSolver } from './swe.ts';
import { SPHSolver } from './sph.ts';
import { GpuShallowWaterSolver } from './sweGpu.ts';
import type { EngineConfig, EngineInfo, FrameStats, WorkerOutbound } from './types.ts';

type Solver = ShallowWaterSolver | SPHSolver;

/** What the worker and the main-thread fallback drive: the same object on both paths. */
export interface Runtime {
  info(): EngineInfo;
  /** Computes for about `budgetMs`; true once the run is complete. */
  runSlice(budgetMs: number): boolean | Promise<boolean>;
  readonly done: boolean;
  dispose?(): void;
}

/**
 * The one place a runtime is chosen, for both the worker and the main-thread fallback: the grid
 * solver on the GPU when WebGPU is available (and not switched off), otherwise on the CPU.
 */
export async function createRuntime(cfg: EngineConfig, emit: (msg: WorkerOutbound) => void): Promise<Runtime> {
  if (cfg.engine === 'swe' && cfg.gpu !== false) {
    try {
      const solver = await GpuShallowWaterSolver.create(cfg);
      if (solver) return new GpuEngineRuntime(cfg, solver, emit);
    } catch (err) {
      console.warn('[cascade] WebGPU solver unavailable; using the CPU.', err);
    }
  }
  return new EngineRuntime(cfg, emit);
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Repeats each solver cell factor × factor onto the display grid (the Fast setting's coarse grid). */
function upsample<T extends Uint16Array | Float32Array>(src: T, cols: number, display: NonNullable<EngineConfig['display']>): T {
  const f = display.factor;
  const out = new (src.constructor as new (n: number) => T)(display.cols * display.rows);
  for (let r = 0; r < display.rows; r++) {
    const from = ((r / f) | 0) * cols;
    const base = r * display.cols;
    for (let c = 0; c < display.cols; c++) out[base + c] = src[from + ((c / f) | 0)];
  }
  return out;
}

export class EngineRuntime implements Runtime {
  private readonly solver: Solver;
  private frameIndex = 0;
  private nextFrameT = 0;
  private stepsSinceFrame = 0;
  private msSinceFrame = 0;
  private wallMs = 0;
  private finished = false;
  /** Progress is reported at most four times a second (each report re-renders the UI). */
  private lastProgressAt = 0;
  private readonly cfg: EngineConfig;
  private readonly emit: (msg: WorkerOutbound) => void;

  constructor(cfg: EngineConfig, emit: (msg: WorkerOutbound) => void) {
    this.cfg = cfg;
    this.emit = emit;
    this.solver = cfg.engine === 'swe' ? new ShallowWaterSolver(cfg) : new SPHSolver(cfg);
  }

  info(): EngineInfo {
    const cells = this.cfg.cols * this.cfg.rows;
    if (this.solver instanceof SPHSolver) {
      return { label: 'SPH-SWE particle solver', cells, particleVolume: this.solver.particleVolume };
    }
    return { label: '2D shallow-water finite-volume solver (HLL)', cells };
  }

  get done(): boolean {
    return this.finished;
  }

  /** Computes for up to `budgetMs` of wall time. Returns true once the run is complete. */
  runSlice(budgetMs: number): boolean {
    if (this.finished) return true;
    const start = now();
    const { duration } = this.cfg;
    if (this.frameIndex === 0) this.emitFrame();

    while (now() - start < budgetMs) {
      const target = Math.min(this.nextFrameT, duration);
      const t0 = now();
      this.solver.step(target - this.solver.t);
      this.msSinceFrame += now() - t0;
      this.stepsSinceFrame++;
      if (this.solver.t >= target - 1e-6) {
        this.emitFrame();
        if (this.frameIndex % 5 === 0) this.emitSummary(false);
        if (this.solver.t >= duration - 1e-6) {
          this.finish();
          return true;
        }
      }
      if (!Number.isFinite(this.solver.t)) throw new Error('Solver produced a non-finite time step.');
    }
    const end = now();
    this.wallMs += end - start;
    if (end - this.lastProgressAt >= 250) {
      this.lastProgressAt = end;
      this.emit({
        type: 'progress',
        engine: this.cfg.engine,
        t: this.solver.t,
        progress: Math.min(this.solver.t / duration, 1),
      });
    }
    return false;
  }

  private emitFrame(): void {
    const s = this.solver;
    const m = s.measure();
    const stats: FrameStats = {
      t: s.t,
      inflowRate: s.inflowRate,
      inflowVolume: s.inflowVolume,
      outflowVolume: s.outflowVolume,
      storedVolume: m.storedVolume,
      wetArea: m.wetArea,
      maxDepth: m.maxDepth,
      computeMs: this.msSinceFrame,
      steps: this.stepsSinceFrame,
    };
    let particles: { position: Float32Array; speed: Float32Array } | undefined;
    if (s instanceof SPHSolver) {
      stats.particles = s.n;
      const snap = s.particleSnapshot(20_000);
      const { bbox, dx, dy, cols, rows } = this.cfg;
      const lngStep = (bbox[2] - bbox[0]) / cols;
      const latStep = (bbox[3] - bbox[1]) / rows;
      const position = new Float32Array(snap.x.length * 3);
      for (let i = 0; i < snap.x.length; i++) {
        position[i * 3] = bbox[0] + (snap.x[i] / dx) * lngStep;
        position[i * 3 + 1] = bbox[3] - (snap.y[i] / dy) * latStep;
        position[i * 3 + 2] = snap.z[i];
      }
      particles = { position, speed: snap.speed };
    }
    // Structured clone (no transfer list): the UI receives its own copy.
    this.emit({
      type: 'frame',
      engine: this.cfg.engine,
      index: this.frameIndex,
      t: s.t,
      depth: this.toDisplay(s.depthCentimetres()),
      stats,
      particles,
    });
    this.frameIndex++;
    this.nextFrameT = this.frameIndex * this.cfg.outputInterval;
    this.stepsSinceFrame = 0;
    this.msSinceFrame = 0;
  }

  private emitSummary(final: boolean): void {
    const s = this.solver;
    this.emit({
      type: 'summary',
      engine: this.cfg.engine,
      t: s.t,
      final,
      maxDepth: this.toDisplay(s.maxDepth),
      arrival: this.toDisplay(s.arrival),
      maxSpeed: this.toDisplay(s.maxSpeed),
      maxDepthVelocity: this.toDisplay(s.maxDepthVelocity),
    });
  }

  /** Solver arrays as the UI expects them: on the scenario grid. */
  private toDisplay<T extends Uint16Array | Float32Array>(a: T): T {
    return this.cfg.display ? upsample(a, this.cfg.cols, this.cfg.display) : a;
  }

  private finish(): void {
    this.finished = true;
    this.emitSummary(true);
    this.emit({ type: 'done', engine: this.cfg.engine, t: this.solver.t, wallMs: this.wallMs });
  }

  /** Mass-balance check, used by the verification script. */
  massBalance(): { inflow: number; outflow: number; stored: number; error: number } {
    const s = this.solver;
    const stored = s.measure().storedVolume;
    const dropped = s instanceof SPHSolver ? s.droppedVolume : 0;
    const error = s.inflowVolume - dropped - s.outflowVolume - stored;
    return { inflow: s.inflowVolume, outflow: s.outflowVolume, stored, error };
  }

  get time(): number {
    return this.solver.t;
  }
}

/**
 * Drives the GPU grid solver with the same outputs as EngineRuntime: a frame every output
 * interval, a summary every fifth frame, progress messages. Slices are asynchronous because
 * each waits for results to come back from the GPU.
 */
class GpuEngineRuntime implements Runtime {
  private frameIndex = 0;
  private nextFrameT = 0;
  private wallMs = 0;
  private msSinceFrame = 0;
  private stepsAtFrame = 0;
  private finished = false;
  private lastProgressAt = 0;
  private readonly cfg: EngineConfig;
  private readonly solver: GpuShallowWaterSolver;
  private readonly emit: (msg: WorkerOutbound) => void;

  constructor(cfg: EngineConfig, solver: GpuShallowWaterSolver, emit: (msg: WorkerOutbound) => void) {
    this.cfg = cfg;
    this.solver = solver;
    this.emit = emit;
  }

  info(): EngineInfo {
    return { label: '2D shallow-water finite-volume solver (HLL), on the graphics card', cells: this.cfg.cols * this.cfg.rows, backend: 'gpu' };
  }

  get done(): boolean {
    return this.finished;
  }

  async runSlice(budgetMs: number): Promise<boolean> {
    if (this.finished) return true;
    const start = now();
    const { duration } = this.cfg;
    if (this.frameIndex === 0) {
      await this.solver.read(false);
      this.emitFrame();
    }
    while (now() - start < budgetMs) {
      const t0 = now();
      await this.solver.advanceTo(Math.min(this.nextFrameT, duration));
      const last = this.solver.t >= duration - 1e-6;
      // Envelopes only come back when a summary is due.
      await this.solver.read(last || (this.frameIndex + 1) % 5 === 0);
      this.msSinceFrame += now() - t0;
      this.emitFrame();
      if (this.frameIndex % 5 === 0) this.emitSummary(false);
      if (last) {
        this.wallMs += now() - start;
        this.finished = true;
        this.emitSummary(true);
        this.emit({ type: 'done', engine: this.cfg.engine, t: this.solver.t, wallMs: this.wallMs });
        return true;
      }
    }
    const end = now();
    this.wallMs += end - start;
    if (end - this.lastProgressAt >= 250) {
      this.lastProgressAt = end;
      this.emit({ type: 'progress', engine: this.cfg.engine, t: this.solver.t, progress: Math.min(this.solver.t / duration, 1) });
    }
    return false;
  }

  private emitFrame(): void {
    const s = this.solver;
    const m = s.measure();
    const stats: FrameStats = {
      t: s.t,
      inflowRate: s.inflowRate,
      inflowVolume: s.inflowVolume,
      outflowVolume: s.outflowVolume,
      storedVolume: m.storedVolume,
      wetArea: m.wetArea,
      maxDepth: m.maxDepth,
      computeMs: this.msSinceFrame,
      steps: s.steps - this.stepsAtFrame,
    };
    // Structured clone (no transfer list): the UI receives its own copy.
    this.emit({ type: 'frame', engine: this.cfg.engine, index: this.frameIndex, t: s.t, depth: this.toDisplay(s.depthCentimetres()), stats });
    this.frameIndex++;
    this.nextFrameT = this.frameIndex * this.cfg.outputInterval;
    this.stepsAtFrame = s.steps;
    this.msSinceFrame = 0;
  }

  private emitSummary(final: boolean): void {
    const s = this.solver;
    this.emit({
      type: 'summary',
      engine: this.cfg.engine,
      t: s.t,
      final,
      maxDepth: this.toDisplay(s.maxDepth),
      arrival: this.toDisplay(s.arrival),
      maxSpeed: this.toDisplay(s.maxSpeed),
      maxDepthVelocity: this.toDisplay(s.maxDepthVelocity),
    });
  }

  private toDisplay<T extends Uint16Array | Float32Array>(a: T): T {
    return this.cfg.display ? upsample(a, this.cfg.cols, this.cfg.display) : a;
  }

  dispose(): void {
    this.solver.dispose();
  }
}
