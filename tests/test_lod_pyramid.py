"""P2 — LOD decimation pyramid for Tier-0 time views (navigation-perf plan).

A wide zoomed-out timeseries/navigator window must not min/max-envelope a full
-rate 150k-sample window every request. Instead the window is sliced from a
coarse precomputed level. Correctness contract (decided in the plan): the LOD
path's per-channel min/max must never *shrink* the true window envelope — no
clipped extrema, so a spike on the overview never silently disappears.
"""
from __future__ import annotations

import numpy as np
import xarray as xr

from tensorscope.server.models import (
    DownsampleMethod,
    ProcessingParamsDTO,
    SelectionDTO,
    TensorSliceRequestDTO,
)
from tensorscope.server.state import (
    apply_slice_request,
    create_server_state,
    downsample_time_axis,
)

FS = 1000.0
N_TIME = 150_000  # 150 s — comfortably above the coarsest LOD level
SPIKE_SAMPLE = 123_456  # t = 123.456 s
TROUGH_SAMPLE = 50_000  # t = 50.0 s


def _ramp_spike_signal() -> xr.DataArray:
    """(time, channel) tensor: ch0 a slow ramp, ch1 baseline-0 with a +100
    spike and a -50 trough at known sample indices."""
    t = np.arange(N_TIME) / FS
    ch0 = np.linspace(-1.0, 1.0, N_TIME)
    ch1 = np.zeros(N_TIME)
    ch1[SPIKE_SAMPLE] = 100.0
    ch1[TROUGH_SAMPLE] = -50.0
    data = np.stack([ch0, ch1], axis=1)
    return xr.DataArray(
        data,
        dims=("time", "channel"),
        coords={"time": t, "channel": np.arange(2)},
        attrs={"fs": FS},
    )


def _build_levels(data: xr.DataArray) -> list[tuple[int, xr.DataArray]]:
    return [
        (tgt, downsample_time_axis(data, tgt, DownsampleMethod.MINMAX))
        for tgt in (4_000, 16_000, 64_000)
        if tgt < int(data.sizes["time"])
    ]


def _nav_request(t0: float, t1: float, max_points: int = 2000) -> TensorSliceRequestDTO:
    return TensorSliceRequestDTO(
        view_type="navigator",
        selection=SelectionDTO(time=t0, freq=0.0, ap=0, ml=0),
        time_range=[t0, t1],
        max_points=max_points,
    )


# ── _get_lod_levels (ladder build) ────────────────────────────────────────


def test_lod_levels_are_decimated_and_cached() -> None:
    data = _ramp_spike_signal()
    state = create_server_state(data, tensor_name="sig")
    levels = state._get_lod_levels("sig", data)
    assert [t for t, _ in levels] == [4_000, 16_000, 64_000]
    for target, level in levels:
        assert int(level.sizes["time"]) <= target  # bounded by the target
        assert int(level.sizes["time"]) < N_TIME  # genuinely smaller (memory)
    # Second call serves the cached level objects (no rebuild).
    again = state._get_lod_levels("sig", data)
    assert all(a[1] is b[1] for a, b in zip(levels, again))


def test_lod_ladder_skips_levels_at_or_above_tensor_length() -> None:
    t = np.arange(5000) / FS
    small = xr.DataArray(
        np.zeros((5000, 1)), dims=("time", "channel"),
        coords={"time": t, "channel": [0]}, attrs={"fs": FS},
    )
    state = create_server_state(small, tensor_name="sig")
    levels = state._get_lod_levels("sig", small)
    assert [t for t, _ in levels] == [4_000]  # 16k/64k skipped (>= 5000)


# ── apply_slice_request LOD selection ──────────────────────────────────────


def test_wide_window_takes_lod_path() -> None:
    data = _ramp_spike_signal()
    levels = _build_levels(data)
    calls = {"n": 0}

    def provider():
        calls["n"] += 1
        return levels

    out = apply_slice_request(data, _nav_request(0.0, 150.0), lod_provider=provider)
    assert calls["n"] == 1, "wide window must consult the LOD provider"
    assert int(out.sizes["time"]) <= 2000, "result honours the point budget"


def test_lod_navigator_preserves_extrema() -> None:
    """Envelope-of-envelope must not clip the spike or the trough."""
    data = _ramp_spike_signal()
    levels = _build_levels(data)
    out = apply_slice_request(
        data, _nav_request(0.0, 150.0), lod_provider=lambda: levels
    )
    ch1 = np.asarray(out.sel(channel=1).values, dtype=float)
    assert np.isclose(ch1.max(), 100.0), "spike must survive the LOD path"
    assert np.isclose(ch1.min(), -50.0), "trough must survive the LOD path"


def test_narrow_window_bypasses_lod() -> None:
    data = _ramp_spike_signal()
    levels = _build_levels(data)
    calls = {"n": 0}

    def provider():
        calls["n"] += 1
        return levels

    narrow = _nav_request(0.0, 1.0)  # 1000 samples << 4 * 2000 budget
    out = apply_slice_request(data, narrow, lod_provider=provider)
    assert calls["n"] == 0, "narrow window must not engage LOD"
    # Identical to the full-rate (no-provider) path.
    full = apply_slice_request(data, narrow, lod_provider=None)
    np.testing.assert_array_equal(
        np.asarray(out.values), np.asarray(full.values)
    )


def test_lod_only_for_timeseries_and_navigator() -> None:
    """A psd_average over a (time, freq, channel) tensor must ignore LOD even
    if a provider is wired (different view tier)."""
    data = _ramp_spike_signal()
    calls = {"n": 0}

    def provider():
        calls["n"] += 1
        return _build_levels(data)

    req = TensorSliceRequestDTO(
        view_type="psd_average",
        selection=SelectionDTO(time=0.0, freq=0.0, ap=0, ml=0),
        time_range=[0.0, 150.0],
    )
    apply_slice_request(data, req, lod_provider=provider)
    assert calls["n"] == 0


# ── ServerState integration ────────────────────────────────────────────────


def test_server_wide_request_populates_lod_cache() -> None:
    data = _ramp_spike_signal()
    state = create_server_state(data, tensor_name="sig")
    assert len(state._lod_cache) == 0
    state.tensor_slice("sig", _nav_request(0.0, 150.0))
    assert len(state._lod_cache) > 0, "wide window must build LOD levels"


def test_server_narrow_request_skips_lod_cache() -> None:
    data = _ramp_spike_signal()
    state = create_server_state(data, tensor_name="sig")
    state.tensor_slice("sig", _nav_request(0.0, 1.0))
    assert len(state._lod_cache) == 0, "narrow window must not build LOD levels"


def test_set_processing_clears_lod_cache() -> None:
    data = _ramp_spike_signal()
    state = create_server_state(data, tensor_name="sig")
    state.tensor_slice("sig", _nav_request(0.0, 150.0))
    assert len(state._lod_cache) > 0
    state.set_processing(ProcessingParamsDTO(zscore=True))
    assert len(state._lod_cache) == 0, "processing change must drop LOD levels"
