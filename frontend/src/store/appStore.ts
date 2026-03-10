import { create } from "zustand";
import type { LayoutDTO, SelectionDTO } from "../api/types";

type AppStore = {
  selectedTensor: string | null;
  selectedView: string | null;
  selectionDraft: SelectionDTO | null;
  layoutDraft: LayoutDTO | null;
  setSelectedTensor: (value: string) => void;
  setSelectedView: (value: string | null) => void;
  setSelectionDraft: (value: SelectionDTO) => void;
  patchSelectionDraft: (patch: Partial<SelectionDTO>) => void;
  setLayoutDraft: (value: LayoutDTO) => void;
};

export const useAppStore = create<AppStore>((set) => ({
  selectedTensor: null,
  selectedView: null,
  selectionDraft: null,
  layoutDraft: null,
  setSelectedTensor: (value) => set({ selectedTensor: value }),
  setSelectedView: (value) => set({ selectedView: value }),
  setSelectionDraft: (value) => set({ selectionDraft: value }),
  patchSelectionDraft: (patch) =>
    set((state) => ({
      selectionDraft: state.selectionDraft ? { ...state.selectionDraft, ...patch } : null,
    })),
  setLayoutDraft: (value) => set({ layoutDraft: value }),
}));
