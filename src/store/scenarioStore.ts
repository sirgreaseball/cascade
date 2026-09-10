import { create } from 'zustand';
import { Scenario, BreachPreset } from '@/types';

interface ScenarioState {
  activeScenario: Scenario | null;
  infrastructureData: any | null;
  evacuationData: any | null;
  scenarios: Scenario[];
  isLoading: boolean;
  loadScenario: (id: string) => Promise<void>;
  setActiveScenario: (scenario: Scenario) => void;
}

export const useScenarioStore = create<ScenarioState>((set) => ({
  activeScenario: null,
  infrastructureData: null,
  evacuationData: null,
  scenarios: [],
  isLoading: false,
  setActiveScenario: (scenario) => set({ activeScenario: scenario }),
  loadScenario: async (id: string) => {
    set({ isLoading: true });
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
