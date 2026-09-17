/**
 * inspectWindow — pure helpers for the "inspect one detected event at full
 * resolution" feature.
 *
 * Clicking (or hotkey-activating) "Inspect" on a detected event re-frames the
 * timeseries to a TIGHT window around the event and asks the server for raw,
 * un-decimated samples so fast oscillations (ripples, spindles) show individual
 * cycles instead of a min/max envelope.
 *
 * Two contracts live here, both pure + unit-tested:
 *
 *  1. `inspectWindowFor(...)` — compute the clamped `[t0, t1]` window. The
 *     server caps un-decimated loads at 60_000 samples, so the window width is
 *     clamped to ≤ `MAX_INSPECT_WIDTH_S` (8 s ⇒ 8 × 1250 Hz = 10_000 ≪ 60_000;
 *     even at much higher fs it stays well under the cap). A point event uses
 *     `[t − pad, t + pad]`; an event carrying a `[t0, t1]` span uses that span
 *     extended by a margin, then clamped.
 *
 *  2. `makeInspectTimeseriesRequest(...)` — the full-resolution slice request:
 *     `downsample: "none"` + a high `max_points` so neither the server LOD
 *     ladder nor the client decimator engages. This is a SEPARATE path from
 *     `makeDefaultSliceRequest` — the normal navigation/decimation path is left
 *     untouched (a prior change to it regressed and was reverted).
 */
import type { SelectionDTO, TensorSliceRequestDTO } from "../../api/types";

/**
 * Max inspect-window width (seconds). Bounds the un-decimated sample count so a
 * `downsample:"none"` fetch never trips the server's 60_000-sample cap:
 *   8 s × 1250 Hz  = 10_000 samples   (demo / typical LFP)
 *   8 s × 2500 Hz  = 20_000 samples
 *   8 s × 7000 Hz  = 56_000 samples   (still < 60_000)
 */
export const MAX_INSPECT_WIDTH_S = 8;

/** Default half-window padding (s) around a point event ⇒ 1 s total window. */
export const INSPECT_POINT_PAD_S = 0.5;

/** Default margin (s) added on each side of a span event before clamping. */
export const INSPECT_SPAN_MARGIN_S = 0.25;

/**
 * High point budget for the inspect fetch. With `downsample:"none"` the server
 * returns raw samples regardless, but a high `max_points` ensures no client-
 * side budget clips them and documents intent. Sits at the server's cap.
 */
export const INSPECT_MAX_POINTS = 60_000;

/**
 * Compute the tight inspect window for an event.
 *
 * @param t        Event time (s) — the anchor / center for a point event.
 * @param span     Optional `[t0, t1]` event span (start/stop). When present and
 *                 valid (`t1 >= t0`), the window is `[t0 - margin, t1 + margin]`;
 *                 otherwise it falls back to `[t - pad, t + pad]`.
 * @param pad      Half-window for the point-event fallback (default 0.5 s).
 * @param margin   Per-side margin for the span case (default 0.25 s).
 *
 * The result is clamped so:
 *   - it never starts before 0 (recordings start at t ≥ 0);
 *   - its width never exceeds `MAX_INSPECT_WIDTH_S` (centered on the event
 *     time / span center if it would otherwise be too wide).
 */
export function inspectWindowFor(
  t: number,
  span?: [number, number] | null,
  pad: number = INSPECT_POINT_PAD_S,
  margin: number = INSPECT_SPAN_MARGIN_S,
): [number, number] {
  let lo: number;
  let hi: number;
  let center: number;

  if (span && Number.isFinite(span[0]) && Number.isFinite(span[1]) && span[1] >= span[0]) {
    lo = span[0] - margin;
    hi = span[1] + margin;
    center = (span[0] + span[1]) / 2;
  } else {
    lo = t - pad;
    hi = t + pad;
    center = t;
  }

  // Clamp total width to the cap, keeping the window centered on `center`.
  let width = hi - lo;
  if (width > MAX_INSPECT_WIDTH_S) {
    lo = center - MAX_INSPECT_WIDTH_S / 2;
    hi = center + MAX_INSPECT_WIDTH_S / 2;
    width = MAX_INSPECT_WIDTH_S;
  }

  // Never start before 0; preserve width by shifting the window forward.
  if (lo < 0) {
    lo = 0;
    hi = lo + width;
  }

  return [lo, hi];
}

/**
 * Build the FULL-RESOLUTION timeseries slice request for an inspect window.
 *
 * Distinct from `makeDefaultSliceRequest("timeseries", …)` (which decimates via
 * the LOD ladder): this sets `downsample: "none"` so the server returns every
 * sample in the (already bounded) window, plus a high `max_points` so no budget
 * clips it. The window must already be the clamped output of `inspectWindowFor`.
 *
 * `selection.time` is pinned to the window start — same window-bound invariant
 * the timeseries query uses elsewhere, so a pure cursor move inside the window
 * doesn't re-key (and re-fetch) the inspect slice.
 */
export function makeInspectTimeseriesRequest(
  selection: SelectionDTO,
  window: [number, number],
): TensorSliceRequestDTO {
  return {
    view_type: "timeseries",
    selection: { ...selection, time: window[0] },
    time_range: window,
    max_points: INSPECT_MAX_POINTS,
    downsample: "none",
  };
}
