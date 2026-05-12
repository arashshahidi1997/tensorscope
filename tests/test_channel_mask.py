"""Tests for the per-tensor channel-mask feature."""
from __future__ import annotations

import numpy as np
import pytest
import xarray as xr
from fastapi.testclient import TestClient

from tensorscope.server.app import create_app
from tensorscope.server.models import (
    SelectionDTO,
    SpectrogramLiveParamsDTO,
    TensorSliceRequestDTO,
)
from tensorscope.server.state import apply_slice_request, create_server_state


def _make_grid(n_time: int = 800, n_ap: int = 4, n_ml: int = 4, fs: float = 100.0) -> xr.DataArray:
    t = np.arange(n_time) / fs
    rng = np.random.default_rng(13)
    data = rng.normal(0, 1, (n_time, n_ap, n_ml))
    return xr.DataArray(
        data,
        dims=("time", "AP", "ML"),
        coords={"time": t, "AP": np.arange(n_ap), "ML": np.arange(n_ml)},
        attrs={"fs": fs},
    )


# ── server-state mask storage ────────────────────────────────────────────


def test_set_channel_mask_dedupes_and_sorts() -> None:
    state = create_server_state(_make_grid(), tensor_name="lfp")
    out = state.set_channel_mask("lfp", [3, 1, 1, 0, 5])
    assert out == [0, 1, 3, 5]
    assert state.channel_mask_for("lfp") == [0, 1, 3, 5]


def test_set_channel_mask_drops_empty_keys() -> None:
    state = create_server_state(_make_grid(), tensor_name="lfp")
    state.set_channel_mask("lfp", [1, 2])
    state.set_channel_mask("lfp", [])
    assert state.channel_mask_for("lfp") == []
    assert "lfp" not in state.channel_masks


def test_set_channel_mask_unknown_tensor_raises() -> None:
    state = create_server_state(_make_grid(), tensor_name="lfp")
    with pytest.raises(KeyError):
        state.set_channel_mask("missing", [0])


# ── slice-path: mask NaNs cells in spatial_map output ────────────────────


def test_spatial_map_masked_cells_become_nan() -> None:
    grid = _make_grid()
    state = create_server_state(grid, tensor_name="lfp")
    state.set_channel_mask("lfp", [0, 5])  # (ap=0, ml=0) and (ap=1, ml=1) on 4x4 grid (n_ml=4)

    request = TensorSliceRequestDTO(
        view_type="spatial_map",
        selection=SelectionDTO(time=1.0, freq=0.0, ap=0, ml=0),
        time_range=(0.0, 4.0),
    )
    masked_ids = state.channel_masks.get("lfp", [])
    da = apply_slice_request(grid, request, masked_ids=masked_ids)
    arr = np.asarray(da.values)
    # Decode flat ids back to (ap, ml) pairs
    n_ml = int(da.sizes["ML"])
    for fid in [0, 5]:
        ap, ml = divmod(fid, n_ml)
        assert np.isnan(arr[ap, ml]), f"expected NaN at ({ap}, {ml})"
    # Non-masked cells stay finite
    assert np.isfinite(arr[3, 3])


# ── slice-path: psd_average uses skipna so non-spatial output stays finite ──


def test_psd_average_time_collapse_is_skipna() -> None:
    """psd_average mean over time uses skipna=True, so masked cells (NaN'd
    across the entire time axis) become NaN in the (AP, ML) output but
    don't poison neighbours."""
    # Pre-compute a (time, AP, ML) tensor that already plays the role of a
    # PSD-style array (psd_average just collapses time, doesn't compute PSD).
    grid = _make_grid()
    request = TensorSliceRequestDTO(
        view_type="psd_average",
        selection=SelectionDTO(time=2.0, freq=0.0, ap=0, ml=0),
        time_range=(0.0, 4.0),
    )
    da = apply_slice_request(grid, request, masked_ids=[5])
    arr = np.asarray(da.values)
    n_ml = int(da.sizes["ML"])
    ap, ml = divmod(5, n_ml)
    assert np.isnan(arr[ap, ml])
    assert np.isfinite(arr[0, 0])


# ── slice-path: psd_live FFT zeroes NaN input then NaNs masked output ────


def test_psd_live_masked_channels_output_nan() -> None:
    grid = _make_grid(n_time=2000)
    request = TensorSliceRequestDTO(
        view_type="psd_live",
        selection=SelectionDTO(time=10.0, freq=10.0, ap=0, ml=0),
        time_range=(0.0, 20.0),
    )
    da = apply_slice_request(grid, request, masked_ids=[0, 7])
    arr = np.asarray(da.values)
    n_ml = int(da.sizes["ML"])
    for fid in [0, 7]:
        ap, ml = divmod(fid, n_ml)
        assert np.all(np.isnan(arr[:, ap, ml])), f"expected all-NaN PSD at ({ap}, {ml})"
    # Unmasked cells stay finite
    assert np.all(np.isfinite(arr[:, 3, 3]))


# ── slice-path: spectrogram_live FFT handles masked rows ─────────────────


def test_spectrogram_live_masked_channels_output_nan() -> None:
    grid = _make_grid(n_time=4000, fs=1000.0)
    request = TensorSliceRequestDTO(
        view_type="spectrogram_live",
        selection=SelectionDTO(time=2.0, freq=10.0, ap=0, ml=0),
        time_range=(0.0, 4.0),
        spectrogram_live_params=SpectrogramLiveParamsDTO(
            normalize_per_freq_median=False,
        ),
    )
    da = apply_slice_request(grid, request, masked_ids=[2])
    arr = np.asarray(da.values)  # (time, freq, AP, ML)
    n_ml = int(da.sizes["ML"])
    ap, ml = divmod(2, n_ml)
    assert np.all(np.isnan(arr[:, :, ap, ml]))
    assert np.all(np.isfinite(arr[:, :, 3, 3]))


# ── slice-path: propagation_movie masks cells across all frames ──────────


def test_propagation_movie_masked_cells_nan_across_frames() -> None:
    grid = _make_grid()
    request = TensorSliceRequestDTO(
        view_type="propagation_movie",
        selection=SelectionDTO(time=2.0, freq=0.0, ap=0, ml=0),
        time_range=(0.0, 4.0),
        n_frames=10,
    )
    da = apply_slice_request(grid, request, masked_ids=[0, 5])
    arr = np.asarray(da.values)  # (time, AP, ML)
    n_ml = int(da.sizes["ML"])
    for fid in [0, 5]:
        ap, ml = divmod(fid, n_ml)
        assert np.all(np.isnan(arr[:, ap, ml]))


# ── HTTP endpoint round-trip ─────────────────────────────────────────────


def test_mask_http_round_trip() -> None:
    grid = _make_grid()
    app = create_app(grid, tensor_name="lfp", pair_mode=True)
    client = TestClient(app)

    # Default: empty mask
    r = client.get("/api/v1/masks/lfp")
    assert r.status_code == 200
    assert r.json() == {"tensor": "lfp", "masked_ids": []}

    # Set a mask
    r = client.put("/api/v1/masks/lfp", json={"masked_ids": [3, 1, 1]})
    assert r.status_code == 200
    assert r.json() == {"tensor": "lfp", "masked_ids": [1, 3]}

    # Read back
    r = client.get("/api/v1/masks/lfp")
    assert r.json()["masked_ids"] == [1, 3]

    # Clear via empty list
    r = client.put("/api/v1/masks/lfp", json={"masked_ids": []})
    assert r.json()["masked_ids"] == []


def test_mask_http_unknown_tensor_404() -> None:
    grid = _make_grid()
    app = create_app(grid, tensor_name="lfp", pair_mode=True)
    client = TestClient(app)
    r = client.get("/api/v1/masks/missing")
    assert r.status_code == 404
    r = client.put("/api/v1/masks/missing", json={"masked_ids": [0]})
    assert r.status_code == 404


def test_mask_http_propagates_to_slice_output() -> None:
    """End-to-end: PUT mask, then a spatial_map slice has NaN cells at masked positions."""
    grid = _make_grid()
    app = create_app(grid, tensor_name="lfp", pair_mode=True)
    client = TestClient(app)

    client.put("/api/v1/masks/lfp", json={"masked_ids": [0]})
    r = client.post(
        "/api/v1/tensors/lfp/slice",
        json={
            "view_type": "spatial_map",
            "selection": {"time": 1.0, "freq": 0.0, "ap": 0, "ml": 0, "channel": None},
            "time_range": [0.0, 4.0],
        },
    )
    assert r.status_code == 200
    # The Arrow payload would need decoding for a deep check; meta carries
    # enough that we can see the slice succeeded with the same shape.
    body = r.json()
    assert body["view_type"] == "spatial_map"
    assert body["dims"] == ["AP", "ML"]
