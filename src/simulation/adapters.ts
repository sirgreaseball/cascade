// Main-thread handle for one flood engine. Prefers a dedicated Web Worker; if the worker cannot
// start (old browser, CSP, bundler issue) it falls back to running the same EngineRuntime on
// the main thread in small time slices. Messages to and from the worker are structured-cloned;
// never pass a transfer list here — the UI keeps its own copies of every array.

import { createRuntime } from './runtime.ts';
import type { Runtime } from './runtime.ts';
import type { EngineConfig, EngineId, EngineInfo, WorkerInbound, WorkerOutbound } from './types.ts';

export type EngineMode = 'worker' | 'main-thread';

export class EngineClient {
  mode: EngineMode = 'worker';
  info: EngineInfo | null = null;
  private worker: Worker | null = null;
  private runtime: Runtime | null = null;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private engine: EngineId = 'swe';
  private readonly onMessage: (msg: WorkerOutbound) => void;

  constructor(onMessage: (msg: WorkerOutbound) => void) {
    this.onMessage = onMessage;
  }

  async init(config: EngineConfig): Promise<EngineMode> {
    this.engine = config.engine;
    try {
      await this.initWorker(config);
      this.mode = 'worker';
    } catch (err) {
      console.warn('[cascade] Worker unavailable, running the solver on the main thread.', err);
      this.worker?.terminate();
      this.worker = null;
      this.runtime = await createRuntime(config, (m) => !this.disposed && this.onMessage(m));
      this.info = this.runtime.info();
      this.mode = 'main-thread';
    }
    return this.mode;
  }

  private initWorker(config: EngineConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./floodWorker.ts', import.meta.url), { type: 'module' });
      this.worker = worker;
      const timeout = setTimeout(() => reject(new Error('Worker did not become ready in time')), 8000);
      worker.onmessage = (e: MessageEvent<WorkerOutbound>) => {
        const msg = e.data;
        if (msg.type === 'ready') {
          clearTimeout(timeout);
          this.info = msg.info;
          worker.onmessage = (ev: MessageEvent<WorkerOutbound>) => !this.disposed && this.onMessage(ev.data);
          resolve();
        } else if (msg.type === 'error') {
          clearTimeout(timeout);
          reject(new Error(msg.message));
        }
      };
      worker.onerror = (e) => {
        clearTimeout(timeout);
        reject(e.error ?? new Error(e.message || 'Worker failed to load'));
      };
      this.send({ type: 'init', config });
    });
  }

  private send(msg: WorkerInbound): void {
    this.worker?.postMessage(msg);
  }

  start(): void {
    if (this.worker) {
      this.send({ type: 'start' });
      return;
    }
    if (!this.runtime || this.running) return;
    this.running = true;
    const tick = async () => {
      if (!this.running || !this.runtime || this.disposed) return;
      try {
        if (await this.runtime.runSlice(12)) {
          this.running = false;
          return;
        }
      } catch (err) {
        this.running = false;
        this.onMessage({ type: 'error', engine: this.engine, message: err instanceof Error ? err.message : String(err) });
        return;
      }
      this.timer = setTimeout(tick, 0);
    };
    void tick();
  }

  pause(): void {
    if (this.worker) this.send({ type: 'pause' });
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
  }

  terminate(): void {
    this.disposed = true;
    this.pause();
    this.worker?.terminate();
    this.worker = null;
    this.runtime?.dispose?.();
    this.runtime = null;
  }
}
