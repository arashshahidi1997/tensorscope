/**
 * Per-stream colormap for the detector comparison overlay (G5).
 *
 * Streams are colored by their *position* in the pinned-stream list so the
 * mapping is stable across renders of the same workspace. Colors are
 * picked from a six-hue palette distinct from the timeseries channel
 * palette (those are bright pastels; these are saturated rim colors)
 * so the event ticks stand out against the trace ink.
 */

export const EVENT_STREAM_PALETTE: string[] = [
  "#ffd166", // amber  — first stream
  "#5bc0eb", // sky    — second
  "#f25f5c", // coral
  "#9bc53d", // lime
  "#c779d0", // orchid
  "#ff8c42", // tangerine
];

/** Color reserved for the coincidence glyph (ring + connector). */
export const COINCIDENCE_COLOR = "#ff3b30";

/** Resolve a per-stream color from its position in the pinned list. Streams
 *  not present in `pinnedStreams` fall through to the last palette hue so
 *  the renderer never gets `undefined` even on a transient race between
 *  pin/unpin and the next query refetch. */
export function getStreamColor(streamName: string, pinnedStreams: string[]): string {
  const idx = pinnedStreams.indexOf(streamName);
  if (idx < 0) return EVENT_STREAM_PALETTE[EVENT_STREAM_PALETTE.length - 1];
  return EVENT_STREAM_PALETTE[idx % EVENT_STREAM_PALETTE.length];
}

/** Color map for a given pinned-stream list — exposed as a Map so views
 *  that render many events can do O(1) lookups instead of re-computing
 *  indexOf per event. */
export function buildStreamColorMap(pinnedStreams: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (let i = 0; i < pinnedStreams.length; i++) {
    m.set(pinnedStreams[i], EVENT_STREAM_PALETTE[i % EVENT_STREAM_PALETTE.length]);
  }
  return m;
}
