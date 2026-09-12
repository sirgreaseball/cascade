// Runs the ensemble: each member is an ordinary run of the grid solver through the same
// EngineClient the dashboard uses (worker, or the main thread where workers are unavailable), so
// the ensemble cannot drift away from what a single run computes. Members run one at a time —
// they share one GPU — and each envelope is folded into the totals and thrown away.

import { EngineClient } from './adapters';
import { EnsembleAccumulator, sampleMembers } from './ensemble';
import type { MemberParams } from './ensemble';
import { setupSimulation } from './setup';
import type { SummaryMessage } from './types';
import { useEnsembleStore } from '@/store/ensembleStore';
import { useScenarioStore } from '@/store/scenarioStore';
import { useSimStore } from '@/store/simulationStore';

export const ENSEMBLE_MEMBERS = 12;

/** Identifies the inputs a result belongs to, so the UI can tell when it has gone stale. */
export function ensembleKey(): string {
  const s = useSimStore.getState();
  const config = useScenarioStore.getState().config;
  return [config?.id ?? '', s.duration, s.manning, JSON.stringify(s.event)].join('|');
}

class EnsembleRunner {
  private client: EngineClient | null = null;
  private runId = 0;

  async run(count = ENSEMBLE_MEMBERS): Promise<void> {
    const sim = useSimStore.getState();
    const { config, data, exposure } = useScenarioStore.getState();
    if (!config || !data || !exposure || !sim.event) return;
    this.cancel();
    const runId = ++this.runId;
    const store = useEnsembleStore.getState();
    store.update({ status: 'running', done: 0, total: count, progress: 0, etaSeconds: null, error: null, result: null, key: null, backend: null });

    const members = sampleMembers({ breachWidth: sim.event.breachWidth, formationTime: sim.event.formationTime, manning: sim.manning }, count);
    const acc = new EnsembleAccumulator(exposure, data.grid.cols * data.grid.rows, data.grid.cellArea);
    const started = performance.now();
    try {
      for (let i = 0; i < members.length; i++) {
        const summary = await this.runMember(runId, members[i], i, count);
        if (runId !== this.runId) return;
        acc.add(members[i], summary);
        const elapsed = (performance.now() - started) / 1000;
        useEnsembleStore.getState().update({
          done: i + 1,
          progress: (i + 1) / count,
          etaSeconds: Math.round((elapsed / (i + 1)) * (count - i - 1)),
          result: acc.result(),
        });
      }
      useEnsembleStore.getState().update({ status: 'done', progress: 1, etaSeconds: 0, key: ensembleKey() });
    } catch (err) {
      if (runId !== this.runId) return;
      useEnsembleStore.getState().update({ status: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  }

  private runMember(runId: number, member: MemberParams, index: number, count: number): Promise<SummaryMessage> {
    const sim = useSimStore.getState();
    const { config, data } = useScenarioStore.getState();
    if (!config || !data || !sim.event) return Promise.reject(new Error('No scenario is loaded.'));
    // Always the Fast grid: a dozen runs have to finish while someone watches.
    const setup = setupSimulation({
      cols: data.grid.cols,
      rows: data.grid.rows,
      bbox: data.grid.bbox,
      dem: data.dem,
      dam: config.dam,
      event: { ...sim.event, breachWidth: member.breachWidth, formationTime: member.formationTime },
      manning: member.manning,
      duration: sim.duration,
      resolution: 'fast',
      gpu: sim.useGpu,
      // Only the final envelope is kept, so ask for few frames.
      frames: 8,
    });
    const { duration } = setup.configs.swe;

    return new Promise<SummaryMessage>((resolve, reject) => {
      let final: SummaryMessage | null = null;
      const client = new EngineClient((msg) => {
        if (runId !== this.runId) return;
        if (msg.type === 'summary') {
          if (msg.final) final = msg;
          return;
        }
        if (msg.type === 'done') {
          if (final) resolve(final);
          else reject(new Error('The run finished without a result.'));
          return;
        }
        if (msg.type === 'error') {
          reject(new Error(msg.message));
          return;
        }
        const p = msg.type === 'progress' ? msg.progress : msg.type === 'frame' ? Math.min(1, msg.t / duration) : null;
        if (p !== null) useEnsembleStore.getState().update({ progress: (index + p) / count });
      });
      this.client = client;
      client.init(setup.configs.swe).then(() => {
        if (runId !== this.runId) return;
        useEnsembleStore.getState().update({ backend: client.info?.backend ?? 'cpu' });
        client.start();
      }, reject);
    }).finally(() => {
      this.client?.terminate();
      this.client = null;
    });
  }

  cancel(): void {
    this.runId++;
    this.client?.terminate();
    this.client = null;
    const store = useEnsembleStore.getState();
    if (store.status === 'running') store.update({ status: store.result ? 'done' : 'idle', etaSeconds: null, key: store.result ? ensembleKey() : null });
  }
}

export const ensemble = new EnsembleRunner();
