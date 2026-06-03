/**
 * Cross-channel overview reduction for the navigator strip.
 *
 * Real iEEG channels span ~90x in standard deviation, so a plain cross-channel
 * mean is dominated by a handful of loud channels and flattens the structure in
 * everything else. We z-score each channel over the (downsampled) window first
 * — subtract its mean, divide by its std — so every channel contributes equally
 * to the overview envelope, then average the standardized channels at each time.
 *
 * Pulled out of NavigatorView for testability (refactor-plan N3): the
 * navigator's uPlot canvas can't be exercised in jsdom, but this reduction is
 * deterministic and is golden-tested in navigatorMean.test.ts.
 */

export type ChannelSeries = { values: ArrayLike<number> };

export type ChannelStats = { mean: number; std: number; count: number };

/**
 * Mean and population std of the finite samples in `values`, plus the finite
 * count. Non-finite samples (NaN/±Inf — masked cells or envelope gaps) are
 * skipped. `std` is 0 when fewer than 2 finite samples exist, so a flat or
 * empty channel reports no usable variance.
 */
export function channelStats(values: ArrayLike<number>): ChannelStats {
  let sum = 0;
  let count = 0;
  const len = values.length;
  for (let i = 0; i < len; i++) {
    const v = values[i];
    if (Number.isFinite(v)) {
      sum += v;
      count += 1;
    }
  }
  if (count === 0) return { mean: 0, std: 0, count: 0 };
  const mean = sum / count;
  let sq = 0;
  for (let i = 0; i < len; i++) {
    const v = values[i];
    if (Number.isFinite(v)) {
      const d = v - mean;
      sq += d * d;
    }
  }
  const std = count > 1 ? Math.sqrt(sq / count) : 0;
  return { mean, std, count };
}

/**
 * Per-channel z-scored cross-channel mean at each time index.
 *
 * Each channel with usable variance (std > 0) contributes (value - mean) / std
 * at every time where its sample is finite. Channels that are flat or have < 2
 * finite samples contribute nothing — they carry no shape and would otherwise
 * divide by zero. Returns a Float64Array of length `nTimes`; a time index with
 * no contributing channel is NaN, so the caller's uPlot `spanGaps:false` leaves
 * a gap rather than drawing a false zero.
 */
export function zscoredCrossChannelMean(
  series: ReadonlyArray<ChannelSeries>,
  nTimes: number,
): Float64Array {
  const out = new Float64Array(nTimes);
  const stats = series.map((s) => channelStats(s.values));
  const nSeries = series.length;
  for (let t = 0; t < nTimes; t++) {
    let sum = 0;
    let n = 0;
    for (let c = 0; c < nSeries; c++) {
      const st = stats[c];
      if (st.std <= 0) continue;
      const v = series[c].values[t];
      if (Number.isFinite(v)) {
        sum += (v - st.mean) / st.std;
        n += 1;
      }
    }
    out[t] = n > 0 ? sum / n : NaN;
  }
  return out;
}
