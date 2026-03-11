import { create } from "zustand";
import type { LayoutDTO, SelectionDTO } from "../api/types";

type AppStore = {
  selectedTensor: string | null;
  /** Set of view types the user has toggled ON. Empty = use defaults (all available). */
  activeViews: string[];
  selectionDraft: SelectionDTO | null;
  layoutDraft: LayoutDTO | null;
  /** Current visible time window [t0, t1] in seconds. Drives slice requests. */
  timeWindow: [number, number];
  setSelectedTensor: (value: string) => void;
  toggleView: (view: string, availableViews: string[]) => void;
  setActiveViews: (views: string[]) => void;
  setSelectionDraft: (value: SelectionDTO) => void;
  patchSelectionDraft: (patch: Partial<SelectionDTO>) => void;
  setLayoutDraft: (value: LayoutDTO) => void;
  setTimeWindow: (window: [number, number]) => void;
};

export const useAppStore = create<AppStore>((set) => ({
  selectedTensor: null,
  activeViews: [],
  selectionDraft: null,
  layoutDraft: null,
  timeWindow: [0, 2],
  setSelectedTensor: (value) => set({ selectedTensor: value, activeViews: [] }),
  toggleView: (view, availableViews) =>
    set((state) => {
      // If activeViews is empty it means "all on"; clicking a pill switches to explicit mode
      const current = state.activeViews.length === 0 ? availableViews : state.activeViews;
      const next = current.includes(view)
        ? current.filter((v) => v !== view)
        : [...current, view];
      // If all are selected, collapse back to empty (= all)
      return { activeViews: next.length === availableViews.length ? [] : next };
    }),
  setActiveViews: (views) => set({ activeViews: views }),
  setSelectionDraft: (value) =>
    set((state) => ({
      selectionDraft: value,
      // Re-center the time window around the new selection if time changed.
      timeWindow:
        state.selectionDraft?.time !== value.time
          ? [Math.max(0, value.time - 1), value.time + 1]
          : state.timeWindow,
    })),
  patchSelectionDraft: (patch) =>
    set((state) => ({
      selectionDraft: state.selectionDraft ? { ...state.selectionDraft, ...patch } : null,
    })),
  setLayoutDraft: (value) => set({ layoutDraft: value }),
  setTimeWindow: (window) => set({ timeWindow: window }),
}));
