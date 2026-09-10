import { create } from 'zustand';
import { Scenario, BreachPreset } from '@/types';

interface ScenarioState {
  activeScenario: Scenario | null;
  infrastructureData: any | null;
  evacuationData: any | null;
  observedData: any | null;
  scenarios: Scenario[];
  isLoading: boolean;
  basemap: 'dark' | 'satellite';
  setBasemap: (mode: 'dark' | 'satellite') => void;
  setObservedData: (data: any) => void;
  loadScenario: (id: string) => Promise<void>;
  setActiveScenario: (scenario: Scenario) => void;
}

export const useScenarioStore = create<ScenarioState>((set) => ({
  activeScenario: null,
  infrastructureData: null,
  evacuationData: null,
  observedData: null,
  scenarios: [],
  isLoading: false,
  basemap: 'dark',
  setBasemap: (mode) => set({ basemap: mode }),
  setObservedData: (data) => set({ observedData: data }),
  setActiveScenario: (scenario) => set({ activeScenario: scenario }),
  loadScenario: async (id: string) => {
    set({ isLoading: true, observedData: null });
    try {
      const res = await fetch(`/scenarios/${id}.json`);
      const scenario: Scenario = await res.json();
      
      const infraRes = await fetch(scenario.infrastructureUrl || `/data/${id}/infrastructure.geojson`);
      const infrastructureData = await infraRes.json();
      
      const evacRes = await fetch(scenario.evacuationUrl || `/data/${id}/evacuation.geojson`);
      const evacuationData = await evacRes.json();

      set({ activeScenario: scenario, infrastructureData, evacuationData });
    } catch (error) {
      console.error('Failed to load scenario:', error);
    } finally {
      set({ isLoading: false });
    }
  },
}));
