/**
 * Canonical shared navigation / selection state for TensorScope M1.
 *
 * This is the coordination contract between views. Views read from it and
 * publish intent into it; they do not call each other directly.
 *
 * Keep this file free of store, React, and API-wire concerns.
 */

/** Visible time range [t0, t1] in seconds. */
export type TimeWindow = [number, number];

/** Point-in-time cursor in seconds. */
export type TimeCursor = number;

/** Spatial electrode location plus optional single-channel override. */
export type SpatialSelection = {
  ap: number;
  ml: number;
  /** Null means no single channel is pinned; views use ap/ml instead. */
  channel: number | null;
  /**
   * Transient hover electrode id. NOT persisted to the server.
   * Views update this imperatively on mousemove without triggering slice
   * requests. Null means no electrode is currently hovered.
   */
  hoveredId: number | null;
  /**
   * Multi-electrode committed selection. These ids correspond to
   * ElectrodeCoord.id values within the current layout.
   * Empty array means no multi-selection is active.
   */
  selectedIds: number[];
};

/** Frequency cursor plus optional band. */
export type FreqSelection = {
  /** Center frequency in Hz. */
  freq: number;
  /** Optional band [lo, hi] in Hz. When absent views use the point cursor. */
  freqRange?: [number, number];
};

/** Active event selection. Null fields mean no event is selected. */
export type EventSelection = {
  /** Row identity value from the event stream (e.g. trial_id). */
  eventId: string | number | null;
  /** Which event stream the selection belongs to. */
  streamName: string | null;
};

/**
 * Full shared navigation state.
 *
 * - timeCursor: single time point the user has clicked or navigated to
 * - timeWindow: the currently visible time range (drives slice requests)
 * - spatial: electrode location / channel pin
 * - freq: frequency cursor and optional band
 * - event: selected event row and stream
 *
 * Open question (from architecture doc): should timeWindow live inside this
 * type or alongside it? For now it lives here so that one store slice owns
 * all navigation. Revisit if window-only subscriptions become a performance
 * concern.
 */
export type SelectionState = {
  timeCursor: TimeCursor;
  timeWindow: TimeWindow;
  spatial: SpatialSelection;
  freq: FreqSelection;
  event: EventSelection;
};

/** Partial selection update — used by patch actions in the store. */
export type SelectionPatch = Partial<{
  timeCursor: TimeCursor;
  timeWindow: TimeWindow;
  spatial: Partial<SpatialSelection>;
  freq: Partial<FreqSelection>;
  event: Partial<EventSelection>;
}>;
