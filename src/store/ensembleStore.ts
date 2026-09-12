// State of the ensemble: a dozen runs of the same failure with the breach and roughness varied,
// summarised into a chance of flooding per cell and a band around each headline number.

import { create } from 'zustand';
import type { EnsembleResult } from '@/simulation/ensemble';

export type EnsembleStatus = 'idle' | 'running' | 'done' | 'error';

export interface EnsembleState {
  status: EnsembleStatus;
  /** Members finished, and how many were asked for. */
  done: number;
  total: number;
  /** 0–1 across the whole ensemble, including the member in progress. */
  progress: number;
  /** Seconds left, estimated from the members finished so far. */
  etaSeconds: number | null;
  error: string | null;
  /** Updated after every member, so the map fills in while the ensemble runs. */
  result: EnsembleResult | null;
  /** Scenario and settings the result belongs to; anything else makes it stale. */
  key: string | null;
  backend: 'cpu' | 'gpu' | null;
  update: (patch: Partial<Omit<EnsembleState, 'update' | 'reset'>>) => void;
  reset: () => void;
}

const idle = {
  status: 'idle' as EnsembleStatus,
  done: 0,
  total: 0,
  progress: 0,
  etaSeconds: null,
  error: null,
  result: null,
  key: null,
  backend: null,
};

export const useEnsembleStore = create<EnsembleState>((set) => ({
  ...idle,
  update: (patch) => set(patch),
  reset: () => set(idle),
}));
