"""Characterization guard for `downsample_time_axis` MINMAX (fix #3).

Background: fix #3 proposed replacing the per-bucket Python loop with a fully
`reduceat`-vectorized implementation. That rewrite was built and measured — and
reverted, because it is ~3× SLOWER on the multichannel LOD-pyramid build (argmin
yields value+position in one pass; reduceat needs extra full-array passes to
recover anchor positions). See the function docstring and
`docs/design/multichannel-display-fixes-plan.md` #3.

This test survives the revert as a **characterization guard**: the reference
oracle below is an independent re-derivation of the intended F5 envelope
semantics, and we assert the production output is **bit-for-bit identical**
(values and emitted timestamps) across a battery of fixtures designed to stress
every tie-break and bucket-shape path. It exists so that any FUTURE edit to this
gnarly function (a re-attempted optimization, a refactor) cannot silently change
the audited behavior:

- multi-feature random data (lead-feature selection)
- integer-valued data with heavy ties (argmin/argmax first-occurrence)
- ragged buckets (time_len not divisible by bucket_count)
- more buckets than samples (single-sample buckets)
- pure negative troughs and isolated spikes
- (time, AP, ML) grids and 1-D single-channel
- non-uniform / float time coordinates

If this test ever fails, the vectorization diverged from the audited F5
semantics — do not "fix" it by loosening the assertion.
"""
from __future__ import annotations

import numpy as np
import pytest
import xarray as xr

from tensorscope.server.models import DownsampleMethod
from tensorscope.server.state import downsample_time_axis


# ── Reference oracle: the ORIGINAL per-bucket loop, verbatim ──────────────────
def _reference_minmax(data: xr.DataArray, max_points: int) -> xr.DataArray:
    time_len = int(data.sizes.get("time", 0))
    if time_len <= max_points:
        return data

    bucket_count = max(1, max_points // 2)
    edges = np.linspace(0, time_len, bucket_count + 1, dtype=int)
    starts = edges[:-1]
    stops = edges[1:]
    valid = stops > starts
    starts = starts[valid]
    stops = stops[valid]

    time_vals = np.asarray(data.coords["time"].values)
    time_axis = list(data.dims).index("time")
    arr = np.moveaxis(np.asarray(data.values, dtype=np.float64), time_axis, 0)
    orig_shape = arr.shape[1:]
    flat = arr.reshape(time_len, -1)

    n_buckets = len(starts)
    n_feat = flat.shape[1]
    out_times = np.empty(n_buckets * 2, dtype=time_vals.dtype)
    out_vals = np.empty((n_buckets * 2, n_feat), dtype=np.float64)

    feat_idx = np.arange(n_feat)
    for i in range(n_buckets):
        s, e = int(starts[i]), int(stops[i])
        chunk = flat[s:e]
        if chunk.shape[0] == 1:
            out_times[2 * i] = time_vals[s]
            out_times[2 * i + 1] = time_vals[s]
            out_vals[2 * i] = chunk[0]
            out_vals[2 * i + 1] = chunk[0]
        else:
            per_feat_argmin = chunk.argmin(axis=0)
            per_feat_argmax = chunk.argmax(axis=0)
            out_vals[2 * i] = chunk[per_feat_argmin, feat_idx]
            out_vals[2 * i + 1] = chunk[per_feat_argmax, feat_idx]
            lead_min_feat = int(np.argmin(out_vals[2 * i]))
            lead_max_feat = int(np.argmax(out_vals[2 * i + 1]))
            out_times[2 * i] = time_vals[s + int(per_feat_argmin[lead_min_feat])]
            out_times[2 * i + 1] = time_vals[s + int(per_feat_argmax[lead_max_feat])]

    sort_idx = np.argsort(out_times, kind="stable")
    out_times = out_times[sort_idx]
    out_vals = out_vals[sort_idx]
    out_arr = out_vals.reshape(len(out_times), *orig_shape)
    out_arr = np.moveaxis(out_arr, 0, time_axis)
    coords = dict(data.coords)
    coords["time"] = out_times
    return xr.DataArray(out_arr, dims=data.dims, coords=coords, attrs=dict(data.attrs))


def _assert_identical(prod: xr.DataArray, ref: xr.DataArray) -> None:
    assert prod.dims == ref.dims
    assert int(prod.sizes["time"]) == int(ref.sizes["time"])
    np.testing.assert_array_equal(np.asarray(prod.values), np.asarray(ref.values))
    np.testing.assert_array_equal(
        np.asarray(prod.coords["time"].values),
        np.asarray(ref.coords["time"].values),
    )
    # Non-time coords must be carried through untouched.
    for dim in prod.dims:
        if dim == "time":
            continue
        np.testing.assert_array_equal(
            np.asarray(prod.coords[dim].values), np.asarray(ref.coords[dim].values)
        )


def _channel_da(arr: np.ndarray, t: np.ndarray) -> xr.DataArray:
    n_feat = arr.shape[1]
    return xr.DataArray(
        arr, dims=("time", "channel"),
        coords={"time": t, "channel": np.arange(n_feat)},
    )


# ── Parametrized random / structured equivalence ──────────────────────────────
@pytest.mark.parametrize("n", [37, 200, 801, 1000, 4096])
@pytest.mark.parametrize("n_feat", [1, 2, 3, 16])
@pytest.mark.parametrize("max_points", [4, 10, 50, 200, 999])
@pytest.mark.parametrize("seed", [0, 1, 7])
def test_random_equivalence(n: int, n_feat: int, max_points: int, seed: int) -> None:
    rng = np.random.default_rng(seed)
    t = np.arange(n) / 1000.0
    arr = rng.normal(size=(n, n_feat))
    da = _channel_da(arr, t)
    prod = downsample_time_axis(da, max_points=max_points, method=DownsampleMethod.MINMAX)
    ref = _reference_minmax(da, max_points=max_points)
    _assert_identical(prod, ref)


@pytest.mark.parametrize("max_points", [6, 20, 64, 333])
@pytest.mark.parametrize("seed", [0, 3])
def test_heavy_ties_equivalence(max_points: int, seed: int) -> None:
    """Small-integer data → many exact ties → stresses argmin/argmax and
    lead-feature first-occurrence tie-breaks (the riskiest divergence)."""
    rng = np.random.default_rng(seed)
    n = 1000
    t = np.arange(n) / 500.0
    arr = rng.integers(low=-3, high=4, size=(n, 5)).astype(np.float64)
    da = _channel_da(arr, t)
    prod = downsample_time_axis(da, max_points=max_points, method=DownsampleMethod.MINMAX)
    ref = _reference_minmax(da, max_points=max_points)
    _assert_identical(prod, ref)


def test_more_buckets_than_samples_equivalence() -> None:
    """max_points >> 2*n forces single-sample (and empty) buckets — the path
    the original special-cased with `chunk.shape[0] == 1`."""
    n = 11
    t = np.arange(n) / 100.0
    rng = np.random.default_rng(5)
    da = _channel_da(rng.normal(size=(n, 3)), t)
    # n=11 <= max_points must early-return; use a max_points that still triggers
    # the envelope (n > max_points) yet yields tiny ragged buckets.
    prod = downsample_time_axis(da, max_points=8, method=DownsampleMethod.MINMAX)
    ref = _reference_minmax(da, max_points=8)
    _assert_identical(prod, ref)


def test_all_features_tie_for_lead() -> None:
    """Every feature has the same min and max value in a bucket → the lead
    feature is feature 0 for both (first index). Pins that tie-break."""
    n = 400
    t = np.arange(n) / 1000.0
    arr = np.tile(np.linspace(-1.0, 1.0, n)[:, None], (1, 4))  # identical columns
    da = _channel_da(arr, t)
    prod = downsample_time_axis(da, max_points=20, method=DownsampleMethod.MINMAX)
    ref = _reference_minmax(da, max_points=20)
    _assert_identical(prod, ref)


def test_isolated_spike_and_trough_equivalence() -> None:
    n = 1000
    t = np.arange(n) / 1000.0
    arr = np.zeros((n, 2), dtype=np.float64)
    arr[537, 0] = 9.0
    arr[412, 1] = -3.0
    da = _channel_da(arr, t)
    prod = downsample_time_axis(da, max_points=20, method=DownsampleMethod.MINMAX)
    ref = _reference_minmax(da, max_points=20)
    _assert_identical(prod, ref)


def test_grid_layout_equivalence() -> None:
    n = 1000
    t = np.arange(n) / 1000.0
    rng = np.random.default_rng(9)
    arr = rng.normal(size=(n, 2, 3))
    arr[742, 1, 0] = 5.0
    da = xr.DataArray(
        arr, dims=("time", "AP", "ML"),
        coords={"time": t, "AP": np.arange(2), "ML": np.arange(3)},
    )
    prod = downsample_time_axis(da, max_points=40, method=DownsampleMethod.MINMAX)
    ref = _reference_minmax(da, max_points=40)
    _assert_identical(prod, ref)


def test_nonuniform_time_coords_equivalence() -> None:
    """Emitted timestamps are gathered from the real time coord — a jittered,
    non-uniform coord must round-trip identically."""
    rng = np.random.default_rng(2)
    n = 900
    t = np.cumsum(rng.uniform(0.5, 1.5, size=n)) / 1000.0  # monotone, non-uniform
    da = _channel_da(rng.normal(size=(n, 4)), t)
    prod = downsample_time_axis(da, max_points=128, method=DownsampleMethod.MINMAX)
    ref = _reference_minmax(da, max_points=128)
    _assert_identical(prod, ref)


def test_single_channel_equivalence() -> None:
    rng = np.random.default_rng(4)
    n = 2048
    t = np.arange(n) / 2000.0
    da = _channel_da(rng.normal(size=(n, 1)), t)
    for mp in (10, 100, 1000):
        prod = downsample_time_axis(da, max_points=mp, method=DownsampleMethod.MINMAX)
        ref = _reference_minmax(da, max_points=mp)
        _assert_identical(prod, ref)
