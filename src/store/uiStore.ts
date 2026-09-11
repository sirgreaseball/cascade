import { create } from 'zustand';

export interface Toast {
  id: number;
  title: string;
  body?: string;
  tone?: 'neutral' | 'error' | 'success';
}

interface UiState {
  leftOpen: boolean;
  rightOpen: boolean;
  leftTab: 'event' | 'model' | 'observe';
  exportOpen: boolean;
  pickingDam: boolean;
  /** True once the map has drawn its first terrain or basemap: ends the loading screen. */
  mapReady: boolean;
  toasts: Toast[];
  setMapReady: (v: boolean) => void;
  setLeftOpen: (v: boolean) => void;
  setRightOpen: (v: boolean) => void;
  setLeftTab: (t: UiState['leftTab']) => void;
  setExportOpen: (v: boolean) => void;
  setPickingDam: (v: boolean) => void;
  toast: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useUiStore = create<UiState>((set, get) => ({
  leftOpen: true,
  rightOpen: true,
  leftTab: 'event',
  exportOpen: false,
  pickingDam: false,
  mapReady: false,
  toasts: [],
  setMapReady: (mapReady) => set({ mapReady }),
  setLeftOpen: (leftOpen) => set({ leftOpen }),
  setRightOpen: (rightOpen) => set({ rightOpen }),
  setLeftTab: (leftTab) => set({ leftTab }),
  setExportOpen: (exportOpen) => set({ exportOpen }),
  setPickingDam: (pickingDam) => set({ pickingDam }),
  toast: (t) => {
    const id = nextId++;
    set({ toasts: [...get().toasts, { ...t, id }] });
    setTimeout(() => get().dismiss(id), t.tone === 'error' ? 8000 : 4500);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((x) => x.id !== id) }),
}));
