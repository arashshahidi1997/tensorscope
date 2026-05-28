"""Audit F5 — min/max downsampling must place extrema at their real source
times, not at bucket boundaries.

The pre-fix path emitted each bucket's per-feature min and max at
``time_vals[bucket_start]`` and ``time_vals[bucket_end-1]``; a transient
inside the bucket would render at the wrong x-position (up to half the
bucket width off). After the fix, each emitted point's timestamp is the
actual time of the sample that produced the value.
"""
from __future__ import annotations

import numpy as np
import xarray as xr

from tensorscope.server.models import DownsampleMethod
from tensorscope.server.state import downsample_time_axis


def _flat_signal_with_spike_at(spike_index: int, n: int = 1000) -> xr.DataArray:
    """Constant-zero signal with a single +1 spike at ``spike_index``."""
    fs = 1000.0
    t = np.arange(n) / fs
    arr = np.zeros((n, 1), dtype=np.float64)
    arr[spike_index, 0] = 1.0
    return xr.DataArray(arr, dims=("time", "channel"), coords={"time": t, "channel": [0]})


def test_minmax_preserves_spike_timestamp() -> None:
    # Spike at sample 537 → 0.537 s. With 1000 samples and max_points=20 (so
    # 10 buckets, 100 samples each), the spike sits at sample 37 inside its
    # bucket — pre-fix it would render at the bucket-end (sample 99 → 0.599 s)
    # or bucket-start (0.500 s).
    sig = _flat_signal_with_spike_at(spike_index=537)
    out = downsample_time_axis(sig, max_points=20, method=DownsampleMethod.MINMAX)
    times = np.asarray(out.coords["time"].values, dtype=float)
    values = np.asarray(out.values).flatten()
    # The +1 must appear in the output, and its time must be 0.537 s.
    spike_match = np.isclose(values, 1.0)
    assert spike_match.any(), "spike must survive downsampling"
    spike_times = times[spike_match]
    assert np.allclose(spike_times, 0.537, atol=1e-9), (
        f"spike rendered at {spike_times.tolist()} but should be at 0.537 s"
    )


def test_minmax_emitted_times_are_real_sample_times() -> None:
    """Every emitted timestamp must coincide with one of the input samples."""
    n = 800
    fs = 250.0
    t = np.arange(n) / fs
    rng = np.random.default_rng(42)
    arr = rng.normal(size=(n, 4))
    da = xr.DataArray(
        arr, dims=("time", "channel"),
        coords={"time": t, "channel": np.arange(4)},
    )
    out = downsample_time_axis(da, max_points=40, method=DownsampleMethod.MINMAX)
    out_times = np.asarray(out.coords["time"].values, dtype=float)
    src_set = set(np.round(t * 1e9).astype(np.int64).tolist())  # ns granularity
    for ts in out_times:
        key = int(round(float(ts) * 1e9))
        assert key in src_set, f"emitted time {ts} is not a real sample time"


def test_minmax_preserves_per_channel_extrema() -> None:
    """Each channel must keep its OWN bucket min/max, not the lead channel's
    value sampled at the lead channel's extreme time.

    Two channels with spikes at different times inside the same bucket: both
    spikes must survive. The pre-fix path gathered every feature's value at a
    single shared time index, so the non-dominant channel's spike vanished.
    """
    n = 200
    fs = 1000.0
    t = np.arange(n) / fs
    arr = np.zeros((n, 2), dtype=np.float64)
    # Both spikes land in the first bucket (samples 0..19 for max_points=20 →
    # 10 buckets of 20). Channel 0 spikes at sample 3, channel 1 at sample 15.
    arr[3, 0] = 9.0
    arr[15, 1] = 7.0
    da = xr.DataArray(
        arr, dims=("time", "channel"),
        coords={"time": t, "channel": np.arange(2)},
    )
    out = downsample_time_axis(da, max_points=20, method=DownsampleMethod.MINMAX)
    out_vals = np.asarray(out.values)  # (n_out, channel)
    assert np.isclose(out_vals[:, 0].max(), 9.0), "channel 0 spike lost"
    assert np.isclose(out_vals[:, 1].max(), 7.0), "channel 1 spike lost"


def test_minmax_grid_spike_placed_at_real_time() -> None:
    """Same property on a (time, AP, ML) grid — F5 affects every layout."""
    n = 1000
    fs = 1000.0
    t = np.arange(n) / fs
    arr = np.zeros((n, 2, 2), dtype=np.float64)
    arr[742, 1, 0] = 5.0  # spike on (AP=1, ML=0) at 0.742 s
    da = xr.DataArray(
        arr, dims=("time", "AP", "ML"),
        coords={"time": t, "AP": np.arange(2), "ML": np.arange(2)},
    )
    out = downsample_time_axis(da, max_points=20, method=DownsampleMethod.MINMAX)
    out_times = np.asarray(out.coords["time"].values, dtype=float)
    out_vals = np.asarray(out.values)  # (n_out, AP, ML)
    spike_idx = np.where(np.isclose(out_vals[:, 1, 0], 5.0))[0]
    assert spike_idx.size > 0
    assert np.allclose(out_times[spike_idx], 0.742, atol=1e-9)
