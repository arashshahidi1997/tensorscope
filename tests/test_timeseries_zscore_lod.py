"""P3 — display z-score off the full-rate hot path (navigation-perf plan).

The per-channel z-score + stacking offset is a DISPLAY transform on the
``timeseries`` view. Before P2/P3 it estimated per-channel std from EVERY sample
of the full-rate window (~150k samples) on every navigation. With the LOD
pyramid (P2) a wide timeseries window is sliced from a coarse precomputed level
first, so the z-score now runs on that few-thousand-point array — off the
full-rate hot path. The display contract is unchanged (the slice still carries
the ``zscore_offset(scale=3.0)`` tag and finite, per-channel-stacked data) and
the P1 per-view cache means a revisit recomputes nothing.

We spy on the module-level ``zscore_offset`` (the true display-transform seam):
a wide window must hand it the LOD-selected array (time size ≪ N_TIME), a narrow
window the full-rate window, the navigator never, and a cached revisit zero
additional calls.
"""
from __future__ import annotations

import numpy as np
import xarray as xr

import tensorscope.server.state as state_mod
from tensorscope.server.models import (
    ProcessingParamsDTO,
    SelectionDTO,
    TensorSliceRequestDTO,
)
from tensorscope.server.state import create_server_state

FS = 1000.0
N_TIME = 150_000  # 150 s — comfortably above the coarsest LOD level
MAX_POINTS = 2000


def _wide_signal(n_ch: int = 4) -> xr.DataArray:
    """(time, channel) tensor — each channel a distinct sinusoid + noise so
    every channel has healthy, non-degenerate variance for the z-score."""
    t = np.arange(N_TIME) / FS
    rng = np.random.default_rng(0)
    cols = [
        np.sin(2 * np.pi * (3 + 2 * c) * t) + rng.normal(0, 0.1, N_TIME)
        for c in range(n_ch)
    ]
    data = np.stack(cols, axis=1)
    return xr.DataArray(
        data,
        dims=("time", "channel"),
        coords={"time": t, "channel": np.arange(n_ch)},
        attrs={"fs": FS},
    )


def _ts_request(t0: float, t1: float, max_points: int = MAX_POINTS) -> TensorSliceRequestDTO:
    return TensorSliceRequestDTO(
        view_type="timeseries",
        selection=SelectionDTO(time=t0, freq=0.0, ap=0, ml=0),
        time_range=[t0, t1],
        max_points=max_points,
    )


def _nav_request(t0: float, t1: float, max_points: int = MAX_POINTS) -> TensorSliceRequestDTO:
    return TensorSliceRequestDTO(
        view_type="navigator",
        selection=SelectionDTO(time=t0, freq=0.0, ap=0, ml=0),
        time_range=[t0, t1],
        max_points=max_points,
    )


def _spy_zscore(monkeypatch) -> dict:
    """Count z-score computes + record the time-size of each input array."""
    real = state_mod.zscore_offset
    calls: dict = {"n": 0, "time_sizes": []}

    def counting(data, *args, **kwargs):
        calls["n"] += 1
        calls["time_sizes"].append(int(data.sizes.get("time", 0)))
        return real(data, *args, **kwargs)

    monkeypatch.setattr(state_mod, "zscore_offset", counting)
    return calls


# ── z-score runs on the LOD-selected (small) array for a wide window ────────


def test_wide_timeseries_zscore_runs_on_lod_array(monkeypatch) -> None:
    state = create_server_state(_wide_signal(), tensor_name="sig")
    calls = _spy_zscore(monkeypatch)
    state.tensor_slice("sig", _ts_request(0.0, 150.0))
    assert calls["n"] == 1, "timeseries must z-score exactly once"
    seen = calls["time_sizes"][0]
    assert seen < N_TIME, "z-score must NOT see the full-rate window (P3)"
    # Coarsest LOD level (~4k points) over the full window — a few thousand,
    # not 150k. Bounded generously to stay robust to bucket-boundary counts.
    assert 2 * MAX_POINTS <= seen <= 4 * MAX_POINTS, (
        f"z-score should run on the LOD-selected array (~{2 * MAX_POINTS}); got {seen}"
    )


def test_wide_timeseries_preserves_display_contract(monkeypatch) -> None:
    """The LOD-path slice still carries the z-score tag and finite data."""
    state = create_server_state(_wide_signal(), tensor_name="sig")
    out = state._prepare_slice("sig", _ts_request(0.0, 150.0))[1]
    tags = list(out.attrs.get("display_transforms", []) or [])
    assert "zscore_offset(scale=3.0)" in tags, "display transform tag must survive LOD"
    assert int(out.sizes["time"]) <= MAX_POINTS, "result honours the point budget"
    assert np.isfinite(np.asarray(out.values, dtype=float)).all(), "data must be finite"


def test_cached_timeseries_does_zero_zscore_recompute(monkeypatch) -> None:
    """A revisited window serves from the P1 cache — no second z-score."""
    state = create_server_state(_wide_signal(), tensor_name="sig")
    calls = _spy_zscore(monkeypatch)
    state.tensor_slice("sig", _ts_request(0.0, 150.0))
    assert calls["n"] == 1
    state.tensor_slice("sig", _ts_request(0.0, 150.0))  # revisit
    assert calls["n"] == 1, "cached revisit must not recompute the z-score"


# ── narrow window keeps the full-rate path (zoom-in fidelity) ───────────────


def test_narrow_timeseries_zscore_runs_full_rate(monkeypatch) -> None:
    sig = _wide_signal()
    full_rate_n = int(sig.sel(time=slice(0.0, 1.0)).sizes["time"])  # endpoint-inclusive
    state = create_server_state(sig, tensor_name="sig")
    calls = _spy_zscore(monkeypatch)
    # 1 s window ≈ 1000 samples << 4 * MAX_POINTS budget → LOD bypassed.
    state.tensor_slice("sig", _ts_request(0.0, 1.0))
    assert calls["n"] == 1
    assert calls["time_sizes"][0] < 2 * MAX_POINTS, "narrow window must bypass LOD"
    assert calls["time_sizes"][0] == full_rate_n, (
        "narrow window must z-score the full-rate slice, not an LOD level"
    )


# ── navigator stays excluded from the z-score (collapsed to a mean trace) ───


def test_navigator_is_excluded_from_zscore(monkeypatch) -> None:
    state = create_server_state(_wide_signal(), tensor_name="sig")
    calls = _spy_zscore(monkeypatch)
    state.tensor_slice("sig", _nav_request(0.0, 150.0))
    assert calls["n"] == 0, "navigator must never run the per-channel z-score"


def test_processing_change_recomputes_zscore(monkeypatch) -> None:
    """A processing change invalidates P1 → the next slice re-runs the z-score."""
    state = create_server_state(_wide_signal(), tensor_name="sig")
    calls = _spy_zscore(monkeypatch)
    state.tensor_slice("sig", _ts_request(0.0, 150.0))
    assert calls["n"] == 1
    state.set_processing(ProcessingParamsDTO(zscore=True))
    state.tensor_slice("sig", _ts_request(0.0, 150.0))
    assert calls["n"] == 2, "processing change must drop the cached z-scored view"
