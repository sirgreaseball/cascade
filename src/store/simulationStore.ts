import { create } from 'zustand';

interface SimulationState {
  status: 'idle' | 'running' | 'paused' | 'completed';
  currentStep: number;
  breachWidth: number;
  breachDepth: number;
  releaseRate: number;
  simulationSpeed: number;
  waterDepth: Float32Array | null;
  arrivalTime: Float32Array | null;
  setStatus: (status: 'idle' | 'running' | 'paused' | 'completed') => void;
  setParameters: (width: number, depth: number, rate: number) => void;
  setSimulationSpeed: (speed: number) => void;
  updateSimulationOutput: (step: number, waterDepth: Float32Array, arrivalTime: Float32Array) => void;
  reset: () => void;
}

export const useSimulationStore = create<SimulationState>((set) => ({
  status: 'idle',
  currentStep: 0,
  breachWidth: 50,
  breachDepth: 10,
  releaseRate: 10000,
  simulationSpeed: 1,
  waterDepth: null,
  arrivalTime: null,
  setStatus: (status) => set({ status }),
  setParameters: (width, depth, rate) => set({ breachWidth: width, breachDepth: depth, releaseRate: rate }),
  setSimulationSpeed: (speed) => set({ simulationSpeed: speed }),
  updateSimulationOutput: (step, waterDepth, arrivalTime) => set({ currentStep: step, waterDepth, arrivalTime }),
  reset: () => set({ status: 'idle', currentStep: 0, waterDepth: null, arrivalTime: null }),
}));
