import { create } from 'zustand';
import {
  deleteCustomScenario,
  fetchBundledIndex,
  listCustomScenarios,
  loadBundledScenario,
  loadCustomScenario,
  saveCustomScenario,
} from '@/lib/scenario';
import type { ScenarioConfig, ScenarioData, ScenarioMeta } from '@/lib/scenario';
import { buildExposureIndex } from '@/lib/analytics';
import { fetchDamLine } from '@/lib/osm';
import { catalogCrestLine } from '@/lib/dams';
import type { ExposureIndex } from '@/lib/analytics';
import type { ObservedExtent } from '@/lib/importers';
import { results } from '@/simulation/results';
import type { ExternalResult } from '@/simulation/results';
import { controller } from '@/simulation/controller';
import { useSimStore } from './simulationStore';

interface ScenarioState {
  index: ScenarioMeta[];
  config: ScenarioConfig | null;
  data: ScenarioData | null;
  exposure: ExposureIndex | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  observed: ObservedExtent | null;
  external: ExternalResult | null;
  builderOpen: boolean;
  /** Catalogue dam the builder should start on, set when one is picked from search. */
  builderDam: string | null;
  loadIndex: () => Promise<ScenarioMeta[]>;
  select: (id: string) => Promise<void>;
  addCustom: (config: ScenarioConfig, data: ScenarioData) => Promise<void>;
  removeCustom: (id: string) => Promise<void>;
  setObserved: (o: ObservedExtent | null) => void;
  setExternal: (e: ExternalResult | null) => void;
  /** Open the builder, optionally starting on a catalogue dam (from search). */
  setBuilderOpen: (open: boolean, damId?: string | null) => void;
}

const LAST_KEY = 'cascade:last-scenario';

/**
 * Scenarios without a crest line (saved before they existed, or built offline) are aligned with
 * the real dam from OpenStreetMap once, and the result is remembered on this device. Without a
 * line the dam axis is detected from the DEM.
 */
async function withCrestLine(config: ScenarioConfig, data: ScenarioData, custom: boolean): Promise<ScenarioConfig> {
  if (config.event === 'lake-outburst') return config;
  // A catalogue dam's stored crest is definitive and needs no network; it also replaces any
  // line an earlier live lookup picked (for example a saddle dyke next to the main dam).
  const known = catalogCrestLine(config.dam.lng, config.dam.lat);
  if (known) {
    if (JSON.stringify(known) === JSON.stringify(config.dam.crestLine)) return config;
    const next = { ...config, dam: { ...config.dam, crestLine: known } };
    if (custom) await saveCustomScenario(next, data).catch(() => undefined);
    return next;
  }
  if (config.dam.crestLine !== undefined) return config;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return config;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 10_000);
  try {
    const crestLine = await fetchDamLine(config.dam.lng, config.dam.lat, config.dam.crestLength, fetch, abort.signal);
    const next = { ...config, dam: { ...config.dam, crestLine } };
    if (custom) await saveCustomScenario(next, data).catch(() => undefined);
    return next;
  } catch {
    return config;
  } finally {
    clearTimeout(timer);
  }
}

function activate(config: ScenarioConfig, data: ScenarioData): ExposureIndex {
  const exposure = buildExposureIndex(data.grid, data.assets, data.roads, [config.dam.lng, config.dam.lat]);
  results.exposureIndex = exposure;
  results.external = null;
  useSimStore.getState().initForScenario(config, data);
  try {
    localStorage.setItem(LAST_KEY, config.id);
  } catch {
    // Private mode / storage disabled: remembering the last scenario is optional.
  }
  return exposure;
}

export const useScenarioStore = create<ScenarioState>((set, get) => ({
  index: [],
  config: null,
  data: null,
  exposure: null,
  status: 'idle',
  error: null,
  observed: null,
  external: null,
  builderOpen: false,
  builderDam: null,

  loadIndex: async () => {
    const [bundled, custom] = await Promise.all([fetchBundledIndex().catch(() => []), listCustomScenarios()]);
    const index = [...bundled, ...custom];
    set({ index });
    return index;
  },

  select: async (id) => {
    controller.reset();
    set({ status: 'loading', error: null, observed: null, external: null });
    try {
      const meta = get().index.find((m) => m.id === id);
      const loaded = meta?.custom ? await loadCustomScenario(id) : await loadBundledScenario(id);
      const data = loaded.data;
      const config = await withCrestLine(loaded.config, data, Boolean(meta?.custom));
      const exposure = activate(config, data);
      set({ config, data, exposure, status: 'ready' });
    } catch (err) {
      set({ status: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  },

  addCustom: async (config, data) => {
    await saveCustomScenario(config, data);
    await get().loadIndex();
    controller.reset();
    const exposure = activate(config, data);
    set({ config, data, exposure, status: 'ready', error: null, observed: null, external: null });
  },

  removeCustom: async (id) => {
    await deleteCustomScenario(id);
    const index = await get().loadIndex();
    if (get().config?.id === id && index.length) await get().select(index[0].id);
  },

  setObserved: (observed) => set({ observed }),
  setExternal: (external) => {
    results.external = external;
    set({ external });
    useSimStore.getState().bumpResults();
  },
  setBuilderOpen: (builderOpen, damId = null) => set({ builderOpen, builderDam: builderOpen ? damId : null }),
}));

export function lastScenarioId(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}
