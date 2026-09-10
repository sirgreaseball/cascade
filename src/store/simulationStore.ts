import { create } from 'zustand';
import { ImpactResult, AlertItem } from '@/types';

interface SimulationState {
  status: 'idle' | 'running' | 'paused' | 'completed';
  currentStep: number;
  breachWidth: number;
  breachDepth: number;
  releaseRate: number;
  simulationSpeed: number;
  waterDepth: Float32Array | null;
  arrivalTime: Float32Array | null;
  impacts: ImpactResult;
  alerts: AlertItem[];
  floodedFeatureIds: Set<string>;
  setStatus: (status: 'idle' | 'running' | 'paused' | 'completed') => void;
  setParameters: (width: number, depth: number, rate: number) => void;
  setSimulationSpeed: (speed: number) => void;
  updateSimulationOutput: (step: number, waterDepth: Float32Array, arrivalTime: Float32Array) => void;
  updateImpacts: (impacts: ImpactResult, newAlerts: AlertItem[], newlyFloodedIds: Set<string>) => void;
  reset: () => void;
}

const initialImpacts: ImpactResult = {
  buildingsAffected: 0,
  roadsAffected: 0,
  populationAtRisk: 0,
};

export const useSimulationStore = create<SimulationState>((set) => ({
  status: 'idle',
  currentStep: 0,
  breachWidth: 50,
  breachDepth: 10,
  releaseRate: 10000,
  simulationSpeed: 1,
  waterDepth: null,
  arrivalTime: null,
  impacts: initialImpacts,
  alerts: [],
  floodedFeatureIds: new Set(),
  setStatus: (status) => set({ status }),
  setParameters: (width, depth, rate) => set({ breachWidth: width, breachDepth: depth, releaseRate: rate }),
  setSimulationSpeed: (speed) => set({ simulationSpeed: speed }),
  updateSimulationOutput: (step, waterDepth, arrivalTime) => set({ currentStep: step, waterDepth, arrivalTime }),
  updateImpacts: (impacts, newAlerts, newlyFloodedIds) => set((state) => {
    const newSet = new Set(state.floodedFeatureIds);
    newlyFloodedIds.forEach(id => newSet.add(id));
    return {
      impacts,
      alerts: [...state.alerts, ...newAlerts],
      floodedFeatureIds: newSet
    };
  }),
  reset: () => set({ status: 'idle', currentStep: 0, waterDepth: null, arrivalTime: null, impacts: initialImpacts, alerts: [], floodedFeatureIds: new Set() }),
}));
