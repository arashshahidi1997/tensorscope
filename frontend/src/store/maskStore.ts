/**
 * Channel mask store — per-tensor list of flat ids excluded from views.
 *
 * Flat id convention mirrors the server: for grid (AP, ML) tensors,
 * `id = ap_idx * n_ml + ml_idx`. Frontend stores Set<number> for fast
 * membership tests during render; persists as Array<number> per tensor
 * via `localStorage` so masks survive a refresh but not a server restart.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type TensorMaskState = {
  /** Per-tensor sets of masked flat channel ids. */
  masks: Record<string, number[]>;
};

type MaskActions = {
  setMask: (tensor: string, ids: number[]) => void;
  toggleId: (tensor: string, id: number) => void;
  toggleRow: (tensor: string, apIdx: number, nML: number) => void;
  toggleCol: (tensor: string, mlIdx: number, nAP: number, nML: number) => void;
  clearMask: (tensor: string) => void;
  invertMask: (tensor: string, total: number) => void;
  setInteriorOnly: (tensor: string, nAP: number, nML: number, ringDepth: number) => void;
  selectAll: (tensor: string, total: number) => void;
};

export type MaskStore = TensorMaskState & MaskActions & {
  /** Convenience: returns the mask for `tensor` as a Set for O(1) lookup. */
  getMaskedSet: (tensor: string) => Set<number>;
};

export const useMaskStore = create<MaskStore>()(
  persist(
    (set, get) => ({
      masks: {},

      setMask: (tensor, ids) =>
        set((s) => ({
          masks: ids.length === 0
            ? Object.fromEntries(Object.entries(s.masks).filter(([k]) => k !== tensor))
            : { ...s.masks, [tensor]: Array.from(new Set(ids)).sort((a, b) => a - b) },
        })),

      toggleId: (tensor, id) =>
        set((s) => {
          const current = new Set(s.masks[tensor] ?? []);
          if (current.has(id)) current.delete(id);
          else current.add(id);
          const next = Array.from(current).sort((a, b) => a - b);
          if (next.length === 0) {
            const { [tensor]: _drop, ...rest } = s.masks;
            return { masks: rest };
          }
          return { masks: { ...s.masks, [tensor]: next } };
        }),

      toggleRow: (tensor, apIdx, nML) =>
        set((s) => {
          const current = new Set(s.masks[tensor] ?? []);
          // If any cell in this row is unmasked, mask the whole row; otherwise
          // unmask the whole row. Mirrors cogpy's row-toggle semantics.
          const rowIds = Array.from({ length: nML }, (_, ml) => apIdx * nML + ml);
          const allMasked = rowIds.every((id) => current.has(id));
          if (allMasked) rowIds.forEach((id) => current.delete(id));
          else rowIds.forEach((id) => current.add(id));
          const next = Array.from(current).sort((a, b) => a - b);
          if (next.length === 0) {
            const { [tensor]: _drop, ...rest } = s.masks;
            return { masks: rest };
          }
          return { masks: { ...s.masks, [tensor]: next } };
        }),

      toggleCol: (tensor, mlIdx, nAP, nML) =>
        set((s) => {
          const current = new Set(s.masks[tensor] ?? []);
          const colIds = Array.from({ length: nAP }, (_, ap) => ap * nML + mlIdx);
          const allMasked = colIds.every((id) => current.has(id));
          if (allMasked) colIds.forEach((id) => current.delete(id));
          else colIds.forEach((id) => current.add(id));
          const next = Array.from(current).sort((a, b) => a - b);
          if (next.length === 0) {
            const { [tensor]: _drop, ...rest } = s.masks;
            return { masks: rest };
          }
          return { masks: { ...s.masks, [tensor]: next } };
        }),

      clearMask: (tensor) =>
        set((s) => {
          if (!(tensor in s.masks)) return s;
          const { [tensor]: _drop, ...rest } = s.masks;
          return { masks: rest };
        }),

      invertMask: (tensor, total) =>
        set((s) => {
          const current = new Set(s.masks[tensor] ?? []);
          const next: number[] = [];
          for (let i = 0; i < total; i++) {
            if (!current.has(i)) next.push(i);
          }
          if (next.length === 0) {
            const { [tensor]: _drop, ...rest } = s.masks;
            return { masks: rest };
          }
          return { masks: { ...s.masks, [tensor]: next } };
        }),

      setInteriorOnly: (tensor, nAP, nML, ringDepth) => {
        // "Interior" = drop the outer `ringDepth` rows on each side. Mask
        // the *exterior* ring so views see only the interior.
        const ids: number[] = [];
        const r = Math.max(0, Math.floor(ringDepth));
        for (let ap = 0; ap < nAP; ap++) {
          for (let ml = 0; ml < nML; ml++) {
            const isEdge = ap < r || ap >= nAP - r || ml < r || ml >= nML - r;
            if (isEdge) ids.push(ap * nML + ml);
          }
        }
        get().setMask(tensor, ids);
      },

      selectAll: (tensor, total) => {
        const ids = Array.from({ length: total }, (_, i) => i);
        get().setMask(tensor, ids);
      },

      getMaskedSet: (tensor) => new Set(get().masks[tensor] ?? []),
    }),
    {
      name: "tensorscope:masks:v1",
      version: 1,
    },
  ),
);
