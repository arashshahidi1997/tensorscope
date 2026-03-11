import { create } from "zustand";
import type { LayoutDTO } from "../api/types";

type AppStore = {
  selectedTensor: string | null;
  /** Set of view types the user has toggled ON. Empty = use defaults (all available). */
  activeViews: string[];
  layoutDraft: LayoutDTO | null;
  setSelectedTensor: (value: string) => void;
  toggleView: (view: string, availableViews: string[]) => void;
  setActiveViews: (views: string[]) => void;
  setLayoutDraft: (value: LayoutDTO) => void;
};

export const useAppStore = create<AppStore>((set) => ({
  selectedTensor: null,
  activeViews: [],
  layoutDraft: null,
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
  setLayoutDraft: (value) => set({ layoutDraft: value }),
}));
