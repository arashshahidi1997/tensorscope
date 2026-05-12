/**
 * Pairwise event-stream coincidence detection for the detector comparison
 * overlay (G5).
 *
 * Two events are "coincident" when their event-time difference is within
 * `windowS` seconds (closed interval). v0 only considers pairwise matches
 * by time — cross-channel coincidence and 3+ stream chained matches are
 * out of scope (see the task note).
 *
 * Runs client-side on the *currently visible* event window — `O(n log n)`
 * per stream for the sort, `O(n + m)` per stream pair via a two-pointer
 * walk over the sorted arrays. The N≈hundreds-of-events window the
 * `useEventWindowQuery` fetches keeps this well under a frame.
 *
 * Output is symmetric: if stream A has an event coincident with one in
 * stream B, both stream A's index and stream B's index appear in their
 * respective sets.
 */
import type { EventRecordDTO, EventStreamMetaDTO } from "./types";

/** Compact (time, original-index) tuple used internally — sorting by time
 *  must not lose the caller's original event index because that's how
 *  view-layer code looks up the record to draw at. */
export type StreamEvent = { t: number; idx: number };

/** Pull `t` from a raw event record using the stream's `time_col`. Falls
 *  back to `record.t` to mirror the existing single-stream code path. */
export function extractEventTimes(
  records: EventRecordDTO[],
  meta: EventStreamMetaDTO | null,
): StreamEvent[] {
  const out: StreamEvent[] = [];
  const col = meta?.time_col ?? "t";
  for (let i = 0; i < records.length; i++) {
    const r = records[i].record as Record<string, unknown>;
    const raw = r[col] ?? r.t;
    const t = typeof raw === "number" ? raw : Number(raw);
    if (Number.isFinite(t)) out.push({ t, idx: i });
  }
  return out;
}

/**
 * Walk two time-sorted streams and emit every (a, b) pair whose times
 * differ by ≤ windowS. Two pointers; both arrays must be sorted ascending.
 * Returns matching index pairs referencing the input arrays in order.
 */
export function pairwiseMatches(
  a: StreamEvent[],
  b: StreamEvent[],
  windowS: number,
): Array<{ a: StreamEvent; b: StreamEvent }> {
  const pairs: Array<{ a: StreamEvent; b: StreamEvent }> = [];
  if (a.length === 0 || b.length === 0 || windowS < 0) return pairs;

  // Float epsilon — `1.1 - 1.0 = 0.10000000000000009` in IEEE 754, so a
  // strict `dt > windowS` check breaks the boundary-inclusive contract
  // that callers (and the coincidence-overlay UI) depend on.
  const EPS = 1e-9;

  for (let i = 0, jStart = 0; i < a.length; i++) {
    // Advance the lower-bound pointer past anything more than `windowS`
    // before a[i] — those can never match a[i] or any later a[i+k].
    while (jStart < b.length && b[jStart].t < a[i].t - windowS - EPS) jStart += 1;
    for (let j = jStart; j < b.length; j++) {
      const dt = b[j].t - a[i].t;
      if (dt > windowS + EPS) break;
      if (dt >= -windowS - EPS) pairs.push({ a: a[i], b: b[j] });
    }
  }
  return pairs;
}

/**
 * For every stream in `eventsByStream`, return the set of event indices
 * (relative to the caller's input array order) that have a coincident
 * event in any *other* stream within `windowS`.
 *
 * The shape lets the timeseries view render a coincidence glyph at each
 * involved event without re-running the matcher on every redraw.
 */
export function coincidenceIndicesByStream(
  eventsByStream: Map<string, StreamEvent[]>,
  windowS: number,
): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  for (const name of eventsByStream.keys()) out.set(name, new Set());

  // Pre-sort each stream once.
  const sorted = new Map<string, StreamEvent[]>();
  for (const [name, evs] of eventsByStream) {
    sorted.set(name, [...evs].sort((p, q) => p.t - q.t));
  }

  const names = Array.from(sorted.keys());
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = sorted.get(names[i])!;
      const b = sorted.get(names[j])!;
      const pairs = pairwiseMatches(a, b, windowS);
      const setA = out.get(names[i])!;
      const setB = out.get(names[j])!;
      for (const { a: ea, b: eb } of pairs) {
        setA.add(ea.idx);
        setB.add(eb.idx);
      }
    }
  }
  return out;
}

/**
 * "Of the events in `activeStream`, how many have a match in any OTHER
 * stream within windowS?" — the count the event panel surfaces below the
 * table per the spec.
 *
 * Note: this is NOT the size of the coincidence set returned by
 * `coincidenceIndicesByStream` when more than two streams are pinned;
 * that one is symmetric across all pairs. The summary count is anchored
 * on the active stream alone.
 */
export function countActiveStreamCoincidences(
  eventsByStream: Map<string, StreamEvent[]>,
  activeStream: string,
  windowS: number,
): number {
  const active = eventsByStream.get(activeStream);
  if (!active || active.length === 0) return 0;
  const sortedActive = [...active].sort((p, q) => p.t - q.t);
  const matched = new Set<number>();
  for (const [name, evs] of eventsByStream) {
    if (name === activeStream) continue;
    const sortedOther = [...evs].sort((p, q) => p.t - q.t);
    const pairs = pairwiseMatches(sortedActive, sortedOther, windowS);
    for (const { a } of pairs) matched.add(a.idx);
  }
  return matched.size;
}
