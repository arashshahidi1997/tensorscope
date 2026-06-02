/**
 * Bandpass re-stack math for the timeseries view.
 *
 * The bandpass query returns a zero-centred filtered trace per channel
 * (sosfiltfilt strips DC). The timeseries view stacks channels by adding
 * each one's mean offset — if we substituted the filtered values directly,
 * every channel would collapse to ~0 and stack on top of one another. So
 * we re-add the raw series' mean to its filtered counterpart, lining each
 * filtered trace up with the same vertical slot the raw trace occupied.
 *
 * Pulled out of TimeseriesSliceView for testability (refactor-plan N3):
 * canvas/uPlot renderers can't be exercised in jsdom, but this math is
 * deterministic and can.
 */

export type SeriesValues = ArrayLike<number>;

/**
 * Mean of finite values in `xs`. Returns 0 when no finite samples exist
 * (mirroring the view's prior inline behavior — no offset means the trace
 * sits at zero, which is its native bandpass-output baseline). Skipping
 * NaN/Inf matches the channel-mask convention: masked cells must not
 * poison the offset for unmasked neighbours.
 */
export function meanFinite(xs: SeriesValues): number {
  let sum = 0;
  let n = 0;
  const len = xs.length;
  for (let i = 0; i < len; i++) {
    const v = xs[i];
    if (Number.isFinite(v)) {
      sum += v;
      n += 1;
    }
  }
  return n > 0 ? sum / n : 0;
}

/**
 * Add a constant offset to every entry of `xs`, returning a new Float32Array.
 *
 * Output is Float32 because the timeseries view's typed-array contract
 * (`ColumnarTimeseries.series[i].values`) is Float32Array — kept identical
 * so a worker can transfer the buffer zero-copy.
 */
export function addOffset(xs: SeriesValues, offset: number): Float32Array {
  const len = xs.length;
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = xs[i] + offset;
  }
  return out;
}

/**
 * Re-stack a bandpass-filtered series to share the raw series' vertical
 * slot. `raw` supplies the offset (its mean), `filtered` supplies the
 * shape.
 *
 * Pure: no DOM, no Arrow, no React.
 */
export function restackBandpassToRawMean(
  raw: SeriesValues,
  filtered: SeriesValues,
): Float32Array {
  return addOffset(filtered, meanFinite(raw));
}
