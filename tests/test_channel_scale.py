"""Fix #2 — per-channel display normalization computed ONCE over the full
tensor, not window-local on the decimated envelope.

The bug: ``zscore_offset`` estimated each channel's mean/std from the *current
window* (and from the LOD envelope), so a channel's displayed amplitude changed
as you pan/zoom — amplitude was not comparable across navigation, the opposite
of the clinical fixed-sensitivity / MNE global-scaling convention.

The fix: ``compute_channel_scale`` derives a robust per-channel (center, scale)
ONCE over the whole recording, cached on the ServerState; ``apply_slice_request``
hands it to ``zscore_offset`` so the timeseries normalization is
window-independent.
"""
from __future__ import annotations

import numpy as np
import xarray as xr

import tensorscope.server.state as state_mod
from tensorscope.server.models import SelectionDTO, TensorSliceRequestDTO
from tensorscope.server.state import (
    compute_channel_scale,
    create_server_state,
    zscore_offset,
)

FS = 1000.0


def _ts_request(t0: float, t1: float, max_points: int = 100_000) -> TensorSliceRequestDTO:
    return TensorSliceRequestDTO(
        view_type="timeseries",
        selection=SelectionDTO(time=t0, freq=0.0, ap=0, ml=0),
        time_range=[t0, t1],
        max_points=max_points,
    )


def _two_channel_with_transient(n: int = 3000) -> xr.DataArray:
    """Two sinusoidal channels; a big transient in [0, 0.2 s] only — so a window
    that includes it has a much larger LOCAL variance than one that doesn't.
    This is what makes window-local vs global normalization observably differ."""
    t = np.arange(n) / FS
    rng = np.random.default_rng(0)
    ch0 = np.sin(2 * np.pi * 5 * t) + rng.normal(0, 0.05, n)
    ch1 = np.sin(2 * np.pi * 7 * t) + rng.normal(0, 0.05, n)
    bump = 50.0 * np.exp(-(((np.arange(200) - 100) / 20.0) ** 2))
    ch0[0:200] += bump
    data = np.stack([ch0, ch1], axis=1)
    return xr.DataArray(
        data, dims=("time", "channel"),
        coords={"time": t, "channel": np.arange(2)}, attrs={"fs": FS},
    )


# ── compute_channel_scale: robust, global, layout-aware ───────────────────────


def test_scale_is_robust_to_outliers() -> None:
    """A handful of artefact spikes must NOT inflate the per-channel scale —
    IQR/1.349 stays ~1.0 where plain std would blow up past 3."""
    rng = np.random.default_rng(0)
    n = 50_000
    t = np.arange(n) / FS
    base = rng.normal(0, 1, n)
    base[::5000] = 500.0  # 10 huge spikes
    da = xr.DataArray(base[:, None], dims=("time", "channel"),
                      coords={"time": t, "channel": [0]})
    center, scale = compute_channel_scale(da)
    s = float(scale.sel(channel=0))
    assert 0.8 < s < 1.3, f"robust scale should be ~1.0, got {s}"
    assert float(np.std(base)) > 3.0, "fixture sanity: plain std IS inflated"
    assert abs(float(center.sel(channel=0))) < 0.1, "center ≈ median ≈ 0"


def test_scale_matches_iqr_estimate() -> None:
    """IQR/1.349 of N(0, sigma) recovers sigma."""
    n = 200_000
    t = np.arange(n) / FS
    rng = np.random.default_rng(1)
    da = xr.DataArray((rng.normal(0, 2.0, n))[:, None], dims=("time", "channel"),
                      coords={"time": t, "channel": [0]})
    _, scale = compute_channel_scale(da)
    assert abs(float(scale.sel(channel=0)) - 2.0) < 0.1


def test_scale_subsamples_large_tensors() -> None:
    """A tensor longer than max_samples is strided — the estimate stays close."""
    n = 1_000_000
    t = np.arange(n) / FS
    rng = np.random.default_rng(2)
    da = xr.DataArray((rng.normal(0, 2.0, n))[:, None], dims=("time", "channel"),
                      coords={"time": t, "channel": [0]})
    _, scale = compute_channel_scale(da, max_samples=50_000)
    assert abs(float(scale.sel(channel=0)) - 2.0) < 0.15


def test_scale_grid_layout_dims() -> None:
    """(time, AP, ML) → per-cell scale over the (AP, ML) dims."""
    n = 5000
    t = np.arange(n) / FS
    rng = np.random.default_rng(3)
    da = xr.DataArray(rng.normal(0, 1, (n, 2, 3)), dims=("time", "AP", "ML"),
                      coords={"time": t, "AP": np.arange(2), "ML": np.arange(3)})
    center, scale = compute_channel_scale(da)
    assert center.dims == ("AP", "ML") and scale.dims == ("AP", "ML")
    assert scale.shape == (2, 3)
    assert np.isfinite(np.asarray(scale.values)).all()


def test_scale_flat_channel_falls_back() -> None:
    """A constant channel (zero spread) must not yield 0/NaN scale."""
    n = 1000
    t = np.arange(n) / FS
    arr = np.zeros((n, 2))
    arr[:, 1] = np.arange(n)  # channel 1 varies; channel 0 is flat
    da = xr.DataArray(arr, dims=("time", "channel"),
                      coords={"time": t, "channel": np.arange(2)})
    _, scale = compute_channel_scale(da)
    assert float(scale.sel(channel=0)) == 1.0, "flat channel → scale falls back to 1.0"
    assert float(scale.sel(channel=1)) > 0.0


# ── the invariant: amplitude is stable across navigation ──────────────────────


def test_amplitude_stable_across_overlapping_windows() -> None:
    """The money test. Two overlapping windows (no LOD) — one includes the big
    transient, one does not. Over their common interval, channel 0's displayed
    values must be IDENTICAL. Under the old window-local z-score they would
    differ (the transient inflates one window's std)."""
    sig = _two_channel_with_transient()
    state = create_server_state(sig, tensor_name="sig")
    a = state._prepare_slice("sig", _ts_request(0.0, 1.5))[1]   # includes transient
    b = state._prepare_slice("sig", _ts_request(0.5, 2.0))[1]   # excludes it
    a0 = a.sel(channel=0).sel(time=slice(0.5, 1.5))
    b0 = b.sel(channel=0).sel(time=slice(0.5, 1.5))
    np.testing.assert_allclose(
        a0.coords["time"].values, b0.coords["time"].values,
        err_msg="overlap must be the same raw sample times (no decimation)",
    )
    np.testing.assert_allclose(
        a0.values, b0.values, atol=1e-9,
        err_msg="channel amplitude must not depend on the window (fix #2)",
    )
    assert float(np.ptp(a0.values)) > 0.1, "fixture sanity: the trace is non-trivial"


def test_scale_computed_from_full_tensor_not_window(monkeypatch) -> None:
    """A tiny window must still derive its scale from the FULL recording."""
    sig = _two_channel_with_transient(n=3000)
    seen: dict = {}
    real = state_mod.compute_channel_scale

    def spy(data, **kw):
        seen["time"] = int(data.sizes["time"])
        return real(data, **kw)

    monkeypatch.setattr(state_mod, "compute_channel_scale", spy)
    state = create_server_state(sig, tensor_name="sig")
    state._prepare_slice("sig", _ts_request(0.5, 0.6))  # 100 ms window
    assert seen["time"] == 3000, "scale must be over the full tensor, not the window"


def test_scale_cached_across_requests(monkeypatch) -> None:
    sig = _two_channel_with_transient()
    calls = {"n": 0}
    real = state_mod.compute_channel_scale

    def spy(data, **kw):
        calls["n"] += 1
        return real(data, **kw)

    monkeypatch.setattr(state_mod, "compute_channel_scale", spy)
    state = create_server_state(sig, tensor_name="sig")
    state._prepare_slice("sig", _ts_request(0.0, 1.0))
    state._prepare_slice("sig", _ts_request(1.0, 2.0))  # different window
    assert calls["n"] == 1, "channel scale computed once, reused across windows"


def test_processing_change_invalidates_scale_cache(monkeypatch) -> None:
    from tensorscope.server.models import ProcessingParamsDTO

    sig = _two_channel_with_transient()
    calls = {"n": 0}
    real = state_mod.compute_channel_scale

    def spy(data, **kw):
        calls["n"] += 1
        return real(data, **kw)

    monkeypatch.setattr(state_mod, "compute_channel_scale", spy)
    state = create_server_state(sig, tensor_name="sig")
    state._prepare_slice("sig", _ts_request(0.0, 1.0))
    assert calls["n"] == 1
    state.set_processing(ProcessingParamsDTO(enabled=True, cmr=True))
    state._prepare_slice("sig", _ts_request(0.0, 1.0))
    assert calls["n"] == 2, "processing change must rebuild the per-channel scale"


# ── zscore_offset: precomputed path + legacy fallback ─────────────────────────


def test_zscore_offset_fallback_matches_window_local() -> None:
    """Without center/scale, zscore_offset must equal the legacy window-local
    z-score + stacking offset exactly (no behavior change for legacy callers)."""
    n = 500
    t = np.arange(n) / FS
    rng = np.random.default_rng(4)
    arr = rng.normal(0, 1, (n, 3))
    da = xr.DataArray(arr, dims=("time", "channel"),
                      coords={"time": t, "channel": np.arange(3)})
    out = zscore_offset(da, offset_scale=3.0)
    mu, sd = arr.mean(0), arr.std(0)
    normed = (arr - mu) / np.where(sd > 0, sd, 1.0)
    offsets = (3 - 1 - np.arange(3)) * 3.0
    np.testing.assert_allclose(out.values, normed + offsets, atol=1e-12)


def test_zscore_offset_uses_precomputed_center_scale() -> None:
    n = 500
    t = np.arange(n) / FS
    rng = np.random.default_rng(5)
    arr = rng.normal(5, 2, (n, 2))
    da = xr.DataArray(arr, dims=("time", "channel"),
                      coords={"time": t, "channel": np.arange(2)})
    center = xr.DataArray([1.0, 2.0], dims=["channel"], coords={"channel": np.arange(2)})
    scale = xr.DataArray([2.0, 4.0], dims=["channel"], coords={"channel": np.arange(2)})
    out = zscore_offset(da, offset_scale=3.0, center=center, scale=scale)
    offsets = (2 - 1 - np.arange(2)) * 3.0  # [3, 0]
    expected = (arr - np.array([1.0, 2.0])) / np.array([2.0, 4.0]) + offsets
    np.testing.assert_allclose(out.values, expected, atol=1e-12)
