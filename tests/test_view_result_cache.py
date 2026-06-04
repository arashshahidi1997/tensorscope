"""P1 — per-view result cache (navigation-perf plan).

Revisiting a window (scrub back, panel toggle, re-open) must serve the cached
sliced result instead of recomputing the multitaper PSD / spectrogram / min-max
envelope. The cache wraps ``ServerState._prepare_slice`` — the single seam both
the v1 long-format encoder and the v2 raw-bytes encoder go through — so one
compute serves both.

We count computes by spying on the module-level ``apply_slice_request`` (the
true per-view compute boundary) rather than the inner ``psd_multitaper`` call
the plan names: P4 later moves that cogpy call into a subprocess pool, where a
parent-process monkeypatch would not be observed. Counting at the cache-miss
seam stays valid across P4 and still proves "two identical requests → one
compute".
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
from tensorscope.server.state import _VIEW_RESULT_CACHE_MAX, create_server_state


def _grid_signal(n_time=2000, n_ap=2, n_ml=2, fs=500.0) -> xr.DataArray:
    t = np.arange(n_time) / fs
    rng = np.random.default_rng(0)
    base = np.sin(2 * np.pi * 10 * t)
    data = rng.normal(0, 0.1, (n_time, n_ap, n_ml)) + base[:, None, None]
    return xr.DataArray(
        data,
        dims=("time", "AP", "ML"),
        coords={"time": t, "AP": np.arange(n_ap), "ML": np.arange(n_ml)},
        attrs={"fs": fs},
    )


def _ts_signal(n_time=5000, n_ch=4, fs=500.0) -> xr.DataArray:
    t = np.arange(n_time) / fs
    rng = np.random.default_rng(1)
    data = rng.normal(0, 1.0, (n_time, n_ch))
    return xr.DataArray(
        data,
        dims=("time", "channel"),
        coords={"time": t, "channel": np.arange(n_ch)},
        attrs={"fs": fs},
    )


def _psd_request(time_range=(0.0, 2.0), selection_time=1.0) -> TensorSliceRequestDTO:
    return TensorSliceRequestDTO(
        view_type="psd_live",
        selection=SelectionDTO(time=selection_time, freq=10.0, ap=0, ml=0),
        time_range=list(time_range),
        psd_params={"NW": 4, "fmax": 100},
    )


def _spy_compute(monkeypatch) -> dict:
    """Count cache-miss computes via the module-level apply_slice_request."""
    real = state_mod.apply_slice_request
    calls = {"n": 0}

    def counting(*args, **kwargs):
        calls["n"] += 1
        return real(*args, **kwargs)

    monkeypatch.setattr(state_mod, "apply_slice_request", counting)
    return calls


def test_identical_requests_compute_once(monkeypatch) -> None:
    state = create_server_state(_grid_signal(), tensor_name="sig")
    calls = _spy_compute(monkeypatch)
    r1 = state.tensor_slice("sig", _psd_request())
    r2 = state.tensor_slice("sig", _psd_request())
    assert calls["n"] == 1, "second identical request must hit the cache"
    assert r1.payload == r2.payload, "cached payload must be byte-identical"


def test_cache_serves_both_encoders(monkeypatch) -> None:
    """A v1 slice then a v2 slice for the same request shares one compute."""
    state = create_server_state(_grid_signal(), tensor_name="sig")
    calls = _spy_compute(monkeypatch)
    v1 = state.tensor_slice("sig", _psd_request())
    v2 = state.tensor_slice_v2_bytes("sig", _psd_request())
    assert calls["n"] == 1, "v2 must reuse the v1 cache entry"
    assert isinstance(v2, (bytes, bytearray)) and len(v2) > 0
    assert v1.payload  # v1 still produced its base64 payload


def test_v2_then_v1_shares_one_compute(monkeypatch) -> None:
    """Reverse order: v2 first, then v1 — still one compute."""
    state = create_server_state(_grid_signal(), tensor_name="sig")
    calls = _spy_compute(monkeypatch)
    state.tensor_slice_v2_bytes("sig", _psd_request())
    state.tensor_slice("sig", _psd_request())
    assert calls["n"] == 1


def test_set_processing_invalidates(monkeypatch) -> None:
    state = create_server_state(_grid_signal(), tensor_name="sig")
    calls = _spy_compute(monkeypatch)
    state.tensor_slice("sig", _psd_request())
    assert calls["n"] == 1
    state.tensor_slice("sig", _psd_request())
    assert calls["n"] == 1  # cached
    state.set_processing(ProcessingParamsDTO(zscore=True))
    state.tensor_slice("sig", _psd_request())
    assert calls["n"] == 2, "processing change must invalidate the view cache"


def test_set_channel_mask_invalidates(monkeypatch) -> None:
    state = create_server_state(_grid_signal(), tensor_name="sig")
    calls = _spy_compute(monkeypatch)
    state.tensor_slice("sig", _psd_request())
    assert calls["n"] == 1
    state.set_channel_mask("sig", [0])
    state.tensor_slice("sig", _psd_request())
    assert calls["n"] == 2, "mask change must invalidate the view cache"


def test_distinct_windows_are_distinct_entries(monkeypatch) -> None:
    state = create_server_state(_grid_signal(n_time=4000), tensor_name="sig")
    calls = _spy_compute(monkeypatch)
    req_a = _psd_request(time_range=(0.0, 2.0), selection_time=1.0)
    req_b = _psd_request(time_range=(4.0, 6.0), selection_time=5.0)
    ra = state.tensor_slice("sig", req_a)
    rb = state.tensor_slice("sig", req_b)
    assert calls["n"] == 2, "two windows must each compute"
    assert ra.payload != rb.payload
    state.tensor_slice("sig", req_a)  # revisit A
    assert calls["n"] == 2, "revisiting A must hit the cache"


def test_lru_is_bounded(monkeypatch) -> None:
    state = create_server_state(_ts_signal(), tensor_name="sig")
    _spy_compute(monkeypatch)
    for i in range(_VIEW_RESULT_CACHE_MAX + 10):
        lo = i * 0.01
        req = TensorSliceRequestDTO(
            view_type="timeseries",
            selection=SelectionDTO(time=lo, freq=0.0, ap=0, ml=0),
            time_range=[lo, lo + 1.0],
            max_points=200,
        )
        state.tensor_slice("sig", req)
    assert len(state._view_result_cache) == _VIEW_RESULT_CACHE_MAX


def test_cache_is_per_session_isolated() -> None:
    """deepcopy isolation: each session gets its own cache dict."""
    import copy

    base = create_server_state(_grid_signal(), tensor_name="sig")
    base.tensor_slice("sig", _psd_request())
    assert len(base._view_result_cache) == 1
    clone = copy.deepcopy(base)
    clone._view_result_cache.clear()
    assert len(base._view_result_cache) == 1, "clone must not share the dict"
