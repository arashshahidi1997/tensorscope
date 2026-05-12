/**
 * Multi-stream event-panel state for the detector comparison overlay (G5).
 *
 * Holds the set of "pinned" event streams the user wants to see overlaid
 * on the timeseries + tabulated in the event panel. The single active
 * stream is the one the table currently shows; coincidence detection runs
 * pairwise against every other pinned stream within `coincidenceWindow`
 * seconds.
 *
 * v0 is persisted to localStorage so the reviewer's pinned set survives
 * reload. Spec: `docs/log/issue/task-g5-detector-overlay-…md`.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type EventStreamsState = {
  /** Pin order; first entry is the default active stream. */
  pinnedStreams: string[];
  /** Which pinned stream the table currently shows. Always a member of
   *  `pinnedStreams`, or null if nothing is pinned. */
  activeStreamName: string | null;
  /** Half-width (seconds) tolerated when calling two events "coincident". */
  coincidenceWindow: number;
};

export type EventStreamsActions = {
  pinStream: (name: string) => void;
  unpinStream: (name: string) => void;
  setActiveStream: (name: string) => void;
  setCoincidenceWindow: (s: number) => void;
  /** Bootstrap on first load — pin one stream as default if nothing is pinned. */
  ensureActive: (defaultStream: string | null) => void;
};

const DEFAULT_STATE: EventStreamsState = {
  pinnedStreams: [],
  activeStreamName: null,
  coincidenceWindow: 0.1,
};

export const useEventStreamsStore = create<EventStreamsState & EventStreamsActions>()(
  persist(
    (set) => ({
      ...DEFAULT_STATE,

      pinStream: (name) =>
        set((s) => {
          if (s.pinnedStreams.includes(name)) return s;
          return {
            pinnedStreams: [...s.pinnedStreams, name],
            activeStreamName: s.activeStreamName ?? name,
          };
        }),

      unpinStream: (name) =>
        set((s) => {
          const next = s.pinnedStreams.filter((n) => n !== name);
          let active = s.activeStreamName;
          if (active === name) active = next[0] ?? null;
          return { pinnedStreams: next, activeStreamName: active };
        }),

      setActiveStream: (name) =>
        set((s) => {
          if (!s.pinnedStreams.includes(name)) {
            return {
              pinnedStreams: [...s.pinnedStreams, name],
              activeStreamName: name,
            };
          }
          return { activeStreamName: name };
        }),

      setCoincidenceWindow: (cw) =>
        set(() => ({
          coincidenceWindow: Math.max(0, Number.isFinite(cw) ? cw : 0),
        })),

      ensureActive: (defaultStream) =>
        set((s) => {
          if (s.pinnedStreams.length > 0 && s.activeStreamName) return s;
          if (!defaultStream) return s;
          return {
            pinnedStreams: s.pinnedStreams.length > 0 ? s.pinnedStreams : [defaultStream],
            activeStreamName: s.activeStreamName ?? defaultStream,
          };
        }),
    }),
    {
      name: "tensorscope:event-streams",
      version: 1,
    },
  ),
);
