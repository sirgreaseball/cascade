import { create } from 'zustand';
import { Scenario, BreachPreset } from '@/types';

interface ScenarioState {
  activeScenario: Scenario | null;
  scenarios: Scenario[];
  isLoading: boolean;
  loadScenario: (id: string) => Promise<void>;
  setActiveScenario: (scenario: Scenario) => void;
}

export const useScenarioStore = create<ScenarioState>((set) => ({
  activeScenario: null,
  scenarios: [],
  isLoading: false,
  setActiveScenario: (scenario) => set({ activeScenario: scenario }),
  loadScenario: async (id: string) => {
    set({ isLoading: true });
    try {
      const res = await fetch(`/scenarios/${id}.json`);
      const scenario: Scenario = await res.json();
      set({ activeScenario: scenario });
    } catch (error) {
      console.error('Failed to load scenario:', error);
    } finally {
      set({ isLoading: false });
    }
  },
}));
