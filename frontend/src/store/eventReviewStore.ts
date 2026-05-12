/**
 * Event review decision store — per-event accept/reject/maybe state,
 * persisted to localStorage so a reviewer's work survives reload.
 *
 * Scope key: `${tensorName}|${streamName}|${eventId}`. This is wide on
 * purpose — a session running against a different dataset doesn't see
 * the previous dataset's decisions, but the same dataset reopened later
 * keeps everything.
 *
 * v0 is local-only. A later pass will add a server endpoint that pushes
 * the decisions to disk (the `validated_*.parquet` export from
 * `docs/log/issue/issue-arash-20260511-182119-502518.md` G9). The store
 * shape stays unchanged through that migration — the persistence layer
 * just gains a parallel sink.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type EventReviewStatus = "accepted" | "rejected" | "maybe";

export type EventDecision = {
  status: EventReviewStatus;
  decidedAt: number; // unix ms
  notes?: string;
  tags?: string[];
};

type DecisionMap = Record<string, EventDecision>;

export type EventReviewState = {
  /** Decisions, keyed by `decisionKey(tensor, stream, eventId)`. */
  decisions: DecisionMap;
};

export type EventReviewActions = {
  setDecision: (key: string, status: EventReviewStatus) => void;
  clearDecision: (key: string) => void;
  updateNotes: (key: string, notes: string) => void;
  updateTags: (key: string, tags: string[]) => void;
  /**
   * Drop every decision scoped to a (tensor, stream) pair. Useful when
   * the user wants to restart a review from scratch.
   */
  clearScope: (tensorName: string, streamName: string) => void;
  /**
   * Bulk-replace every decision in a (tensor, stream) scope. Used by the
   * server-rehydration path (G9): when the page loads and the server
   * holds decisions on disk, we mirror them into the store so the panel
   * shows them immediately. Decisions outside the scope are untouched.
   */
  replaceScope: (
    tensorName: string,
    streamName: string,
    entries: Array<{ eventId: string | number; decision: EventDecision }>,
  ) => void;
};

/** Compose the persist key for one event. Keep this stable — changing
 *  it later orphans existing localStorage state. */
export function decisionKey(
  tensorName: string,
  streamName: string,
  eventId: string | number,
): string {
  return `${tensorName}|${streamName}|${eventId}`;
}

/** Enumerate every decision in a (tensor, stream) scope. Used by the
 *  "Export decisions" path so the caller doesn't have to walk the
 *  store's prefix-keyed map by hand. */
export function decisionsInScope(
  decisions: DecisionMap,
  tensorName: string,
  streamName: string,
): Array<{ eventId: string; decision: EventDecision }> {
  const prefix = `${tensorName}|${streamName}|`;
  const out: Array<{ eventId: string; decision: EventDecision }> = [];
  for (const [k, v] of Object.entries(decisions)) {
    if (!k.startsWith(prefix)) continue;
    out.push({ eventId: k.slice(prefix.length), decision: v });
  }
  return out;
}

/**
 * Stable, content-addressed fingerprint for the decisions in a scope.
 *
 * Used by the auto-save / dirty-state plumbing in
 * `ExportDecisionsControls`: compare local fingerprint vs. last-sent
 * fingerprint to decide whether the local store has unsaved edits.
 *
 * Properties:
 *   - Cheap (one pass, no JSON-stringify) so it's safe to call in render.
 *   - Order-independent — same set of decisions hashes the same no matter
 *     the iteration order of the decisions map.
 *   - Sensitive to status / notes / tags but NOT to `decidedAt` — the
 *     reviewer doesn't see decidedAt change as "new edits to save."
 *
 * Returns a short hex-ish string.
 */
export function fingerprintScope(
  decisions: DecisionMap,
  tensorName: string,
  streamName: string,
): string {
  // FNV-1a 32-bit on a deterministic per-entry summary string. Speed and
  // collision-resistance are both fine for a few thousand decisions.
  const prefix = `${tensorName}|${streamName}|`;
  // Stable order: sort the entries by event-id so the result is
  // invariant under iteration order changes.
  const entries: Array<[string, EventDecision]> = [];
  for (const [k, v] of Object.entries(decisions)) {
    if (!k.startsWith(prefix)) continue;
    entries.push([k.slice(prefix.length), v]);
  }
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  let h = 0x811c9dc5;
  const mix = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= 0x0a; // segment separator
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  for (const [id, d] of entries) {
    mix(id);
    mix(d.status);
    mix(d.notes ?? "");
    // Tags are order-significant — that's a real distinction the
    // reviewer cares about (they typed them in a specific order).
    if (d.tags && d.tags.length) for (const t of d.tags) mix(t);
  }
  return `n${entries.length}.${h.toString(16).padStart(8, "0")}`;
}

/** Helper: count reviewed-vs-total for a given scope. Used by the panel
 *  counter so the math lives in one place. */
export function countReviewedInScope(
  decisions: DecisionMap,
  tensorName: string,
  streamName: string,
  eventIds: Array<string | number>,
): { reviewed: number; total: number } {
  const prefix = `${tensorName}|${streamName}|`;
  let reviewed = 0;
  for (const id of eventIds) {
    if (decisions[`${prefix}${id}`] != null) reviewed += 1;
  }
  return { reviewed, total: eventIds.length };
}

export const useEventReviewStore = create<EventReviewState & EventReviewActions>()(
  persist(
    (set) => ({
      decisions: {},

      setDecision: (key, status) =>
        set((s) => ({
          decisions: {
            ...s.decisions,
            [key]: {
              ...(s.decisions[key] ?? {}),
              status,
              decidedAt: Date.now(),
            },
          },
        })),

      clearDecision: (key) =>
        set((s) => {
          if (!(key in s.decisions)) return s;
          const next = { ...s.decisions };
          delete next[key];
          return { decisions: next };
        }),

      updateNotes: (key, notes) =>
        set((s) => {
          const existing = s.decisions[key];
          if (!existing) return s; // notes only attach to decided events
          return {
            decisions: {
              ...s.decisions,
              [key]: { ...existing, notes },
            },
          };
        }),

      updateTags: (key, tags) =>
        set((s) => {
          const existing = s.decisions[key];
          if (!existing) return s; // tags only attach to decided events
          return {
            decisions: {
              ...s.decisions,
              [key]: { ...existing, tags: [...tags] },
            },
          };
        }),

      clearScope: (tensorName, streamName) =>
        set((s) => {
          const prefix = `${tensorName}|${streamName}|`;
          const next: DecisionMap = {};
          for (const [k, v] of Object.entries(s.decisions)) {
            if (!k.startsWith(prefix)) next[k] = v;
          }
          return { decisions: next };
        }),

      replaceScope: (tensorName, streamName, entries) =>
        set((s) => {
          const prefix = `${tensorName}|${streamName}|`;
          const next: DecisionMap = {};
          for (const [k, v] of Object.entries(s.decisions)) {
            if (!k.startsWith(prefix)) next[k] = v;
          }
          for (const { eventId, decision } of entries) {
            next[decisionKey(tensorName, streamName, eventId)] = decision;
          }
          return { decisions: next };
        }),
    }),
    {
      name: "tensorscope:event-review",
      version: 1,
    },
  ),
);
