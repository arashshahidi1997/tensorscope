import { create } from "zustand";

export type ActivityStatus = "running" | "done" | "error";

export type ActivityEntry = {
  id: string;
  label: string;
  status: ActivityStatus;
  startedAt: number;
  endedAt?: number;
  elapsed?: number;
  params?: Record<string, unknown>;
  cacheHit?: boolean;
  error?: string;
};

type ActivityStore = {
  entries: ActivityEntry[];
  addActivity: (entry: ActivityEntry) => void;
  updateActivity: (id: string, patch: Partial<ActivityEntry>) => void;
  clearEntries: () => void;
};

export const useActivityStore = create<ActivityStore>((set) => ({
  entries: [],
  addActivity: (entry) =>
    set((s) => ({
      // Keep last 20 entries
      entries: [...s.entries.slice(-19), entry],
    })),
  updateActivity: (id, patch) =>
    set((s) => ({
      entries: s.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    })),
  clearEntries: () => set({ entries: [] }),
}));
