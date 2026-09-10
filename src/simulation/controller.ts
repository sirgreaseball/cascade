// Orchestrates a run: one EngineClient per enabled engine (running side by side in their own
// workers), frames into the results store, status into the simulation store.

import { EngineClient } from './adapters';
import { results } from './results';
import type { EngineId, WorkerOutbound } from './types';
import { useSimStore } from '@/store/simulationStore';

class SimulationController {
  private clients: Partial<Record<EngineId, EngineClient>> = {};
  private runId = 0;

  async run(): Promise<void> {
    const sim = useSimStore.getState();
    const setup = sim.setup;
    if (!setup) return;
    this.stop();
    results.clear();
    sim.resetRuns();
    const runId = ++this.runId;
    const engines = (Object.keys(sim.engines) as EngineId[]).filter((e) => sim.engines[e]);
    useSimStore.setState({ playing: false, follow: true, playhead: 0 });

    await Promise.all(
      engines.map(async (engine) => {
        const store = useSimStore.getState();
        store.updateRun(engine, { status: 'starting', error: null });
        const client = new EngineClient((msg) => this.onMessage(runId, msg));
        this.clients[engine] = client;
        try {
          const mode = await client.init(setup.configs[engine]);
          if (runId !== this.runId) {
            client.terminate();
            return;
          }
          useSimStore.getState().updateRun(engine, {
            status: 'running',
            mode,
            label: client.info?.label ?? engine,
            particleVolume: client.info?.particleVolume,
          });
          client.start();
        } catch (err) {
          useSimStore.getState().updateRun(engine, { status: 'error', error: err instanceof Error ? err.message : String(err) });
        }
      }),
    );
  }

  private onMessage(runId: number, msg: WorkerOutbound): void {
    if (runId !== this.runId) return;
    const store = useSimStore.getState();
    switch (msg.type) {
      case 'frame': {
        const frames = results.addFrame(msg);
        const duration = store.setup?.configs[msg.engine].duration ?? 1;
        store.updateRun(msg.engine, { frames, latestT: msg.t, progress: Math.min(msg.t / duration, 1) });
        store.bumpResults();
        break;
      }
      case 'summary':
        results.setSummary(msg);
        store.bumpResults();
        break;
      case 'progress':
        store.updateRun(msg.engine, { progress: msg.progress });
        break;
      case 'done':
        store.updateRun(msg.engine, { status: 'done', progress: 1, wallMs: msg.wallMs });
        break;
      case 'error':
        store.updateRun(msg.engine, { status: 'error', error: msg.message });
        break;
    }
  }

  pause(): void {
    const store = useSimStore.getState();
    for (const [engine, client] of Object.entries(this.clients) as [EngineId, EngineClient][]) {
      if (store.runs[engine].status === 'running') {
        client.pause();
        store.updateRun(engine, { status: 'paused' });
      }
    }
  }

  resume(): void {
    const store = useSimStore.getState();
    for (const [engine, client] of Object.entries(this.clients) as [EngineId, EngineClient][]) {
      if (store.runs[engine].status === 'paused') {
        client.start();
        store.updateRun(engine, { status: 'running' });
      }
    }
  }

  stop(): void {
    this.runId++;
    for (const client of Object.values(this.clients)) client?.terminate();
    this.clients = {};
  }

  reset(): void {
    this.stop();
    results.clear();
    useSimStore.getState().resetRuns();
  }
}

export const controller = new SimulationController();
