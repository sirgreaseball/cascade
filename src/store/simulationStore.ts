import { create } from 'zustand';
import type { EventParams } from '@/simulation/hydrograph';
import { setupSimulation } from '@/simulation/setup';
import type { Resolution, SimulationSetup } from '@/simulation/setup';
import type { EngineId } from '@/simulation/types';
import { eventDefaults } from '@/lib/scenario';
import type { ScenarioConfig, ScenarioData } from '@/lib/scenario';

export type RunStatus = 'idle' | 'starting' | 'running' | 'paused' | 'done' | 'error';

export interface EngineRun {
  status: RunStatus;
  progress: number;
  frames: number;
  latestT: number;
  mode: 'worker' | 'main-thread' | null;
  label: string;
  particleVolume?: number;
  error: string | null;
  wallMs: number;
}

export type MapLayer = 'depth' | 'maxDepth' | 'arrival' | 'hazard' | 'velocity' | 'difference';
export type EngineView = 'swe' | 'sph' | 'overlay';

export interface ViewSettings {
  layer: MapLayer;
  engine: EngineView;
  terrain3d: boolean;
  basemap: 'satellite' | 'light';
  showAssets: boolean;
  showRoads: boolean;
  showParticles: boolean;
  showObserved: boolean;
}

const idleRun = (): EngineRun => ({
  status: 'idle',
  progress: 0,
  frames: 0,
  latestT: 0,
  mode: null,
  label: '',
  error: null,
  wallMs: 0,
});

interface SimState {
  event: EventParams | null;
  duration: number;
  manning: number;
  resolution: Resolution;
  engines: Record<EngineId, boolean>;
  setup: SimulationSetup | null;
  setupError: string | null;
  /** True when inputs changed after the current results were computed. */
  stale: boolean;
  runs: Record<EngineId, EngineRun>;
  resultsVersion: number;
  playhead: number;
  playing: boolean;
  /** Simulated seconds per real second. */
  speed: number;
  follow: boolean;
  view: ViewSettings;
  selectedAsset: number | null;

  initForScenario: (config: ScenarioConfig, data: ScenarioData) => void;
  setEvent: (patch: Partial<EventParams>) => void;
  resetEvent: () => void;
  setDuration: (s: number) => void;
  setManning: (n: number) => void;
  setResolution: (r: Resolution) => void;
  setEngine: (e: EngineId, on: boolean) => void;
  setView: (patch: Partial<ViewSettings>) => void;
  setPlayhead: (t: number) => void;
  setPlaying: (p: boolean) => void;
  setSpeed: (s: number) => void;
  setFollow: (f: boolean) => void;
  selectAsset: (i: number | null) => void;
  updateRun: (engine: EngineId, patch: Partial<EngineRun>) => void;
  resetRuns: () => void;
  bumpResults: () => void;
}

let scenarioRef: { config: ScenarioConfig; data: ScenarioData } | null = null;

function recompute(state: Pick<SimState, 'event' | 'duration' | 'manning' | 'resolution'>): { setup: SimulationSetup | null; setupError: string | null } {
  if (!scenarioRef || !state.event) return { setup: null, setupError: null };
  const { config, data } = scenarioRef;
  try {
    const setup = setupSimulation({
      cols: data.grid.cols,
      rows: data.grid.rows,
      bbox: data.grid.bbox,
      dem: data.dem,
      dam: config.dam,
      event: state.event,
      manning: state.manning,
      duration: state.duration,
      resolution: state.resolution,
    });
    return { setup, setupError: null };
  } catch (err) {
    return { setup: null, setupError: err instanceof Error ? err.message : String(err) };
  }
}

const anyResults = (runs: Record<EngineId, EngineRun>) => runs.swe.frames > 0 || runs.sph.frames > 0;

export const useSimStore = create<SimState>((set, get) => ({
  event: null,
  duration: 21_600,
  manning: 0.045,
  resolution: 'standard',
  engines: { swe: true, sph: true },
  setup: null,
  setupError: null,
  stale: false,
  runs: { swe: idleRun(), sph: idleRun() },
  resultsVersion: 0,
  playhead: 0,
  playing: false,
  speed: 300,
  follow: true,
  view: {
    layer: 'depth',
    engine: 'swe',
    terrain3d: true,
    basemap: 'satellite',
    showAssets: true,
    showRoads: true,
    showParticles: true,
    showObserved: true,
  },
  selectedAsset: null,

  initForScenario: (config, data) => {
    scenarioRef = { config, data };
    const event = eventDefaults(config);
    const base = { event, duration: config.defaults.duration, manning: config.defaults.manning, resolution: get().resolution };
    set({
      ...base,
      ...recompute(base),
      stale: false,
      runs: { swe: idleRun(), sph: idleRun() },
      playhead: 0,
      playing: false,
      follow: true,
      selectedAsset: null,
      resultsVersion: get().resultsVersion + 1,
    });
  },
  setEvent: (patch) => {
    const event = { ...(get().event as EventParams), ...patch };
    set({ event, ...recompute({ ...get(), event }), stale: anyResults(get().runs) });
  },
  resetEvent: () => {
    if (!scenarioRef) return;
    const event = eventDefaults(scenarioRef.config);
    set({ event, ...recompute({ ...get(), event }), stale: anyResults(get().runs) });
  },
  setDuration: (duration) => set({ duration, ...recompute({ ...get(), duration }), stale: anyResults(get().runs) }),
  setManning: (manning) => set({ manning, ...recompute({ ...get(), manning }), stale: anyResults(get().runs) }),
  setResolution: (resolution) => set({ resolution, ...recompute({ ...get(), resolution }), stale: anyResults(get().runs) }),
  setEngine: (e, on) => {
    const engines = { ...get().engines, [e]: on };
    if (!engines.swe && !engines.sph) return;
    const view = { ...get().view };
    if (!engines[view.engine as EngineId] && view.engine !== 'overlay') view.engine = engines.swe ? 'swe' : 'sph';
    if (view.engine === 'overlay' && !(engines.swe && engines.sph)) view.engine = engines.swe ? 'swe' : 'sph';
    set({ engines, view });
  },
  setView: (patch) => set({ view: { ...get().view, ...patch } }),
  setPlayhead: (playhead) => set({ playhead: Math.max(0, playhead) }),
  setPlaying: (playing) => set({ playing, ...(playing ? {} : {}) }),
  setSpeed: (speed) => set({ speed }),
  setFollow: (follow) => set({ follow }),
  selectAsset: (selectedAsset) => set({ selectedAsset }),
  updateRun: (engine, patch) => set({ runs: { ...get().runs, [engine]: { ...get().runs[engine], ...patch } } }),
  resetRuns: () => set({ runs: { swe: idleRun(), sph: idleRun() }, playhead: 0, playing: false, follow: true, stale: false, resultsVersion: get().resultsVersion + 1 }),
  bumpResults: () => set({ resultsVersion: get().resultsVersion + 1 }),
}));

export function isRunning(runs: Record<EngineId, EngineRun>): boolean {
  return runs.swe.status === 'running' || runs.sph.status === 'running' || runs.swe.status === 'starting' || runs.sph.status === 'starting';
}
