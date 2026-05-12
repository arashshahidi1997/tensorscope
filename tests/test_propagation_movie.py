"""Tests for the propagation_movie view type."""
from __future__ import annotations

import numpy as np
import pytest
import xarray as xr

from tensorscope.server.models import SelectionDTO, TensorSliceRequestDTO
from tensorscope.server.state import apply_slice_request, create_server_state


def _make_grid(n_time: int = 1000, n_ap: int = 4, n_ml: int = 8, fs: float = 100.0) -> xr.DataArray:
    t = np.arange(n_time) / fs
    rng = np.random.default_rng(3)
    data = rng.normal(0, 1, (n_time, n_ap, n_ml))
    return xr.DataArray(
        data,
        dims=("time", "AP", "ML"),
        coords={"time": t, "AP": np.arange(n_ap), "ML": np.arange(n_ml)},
        attrs={"fs": fs},
    )


def test_propagation_movie_keeps_time_axis() -> None:
    signal = _make_grid()
    request = TensorSliceRequestDTO(
        view_type="propagation_movie",
        selection=SelectionDTO(time=1.0, freq=0.0, ap=0, ml=0),
        time_range=(0.0, 2.0),
        n_frames=10,
    )
    da = apply_slice_request(signal, request)
    assert da.dims == ("time", "AP", "ML")
    assert da.sizes["time"] == 10
    assert da.sizes["AP"] == 4
    assert da.sizes["ML"] == 8


def test_propagation_movie_default_n_frames_tracks_window() -> None:
    """Default n_frames ≈ 30 fps × window_s, capped at 240."""
    signal = _make_grid(n_time=1000, fs=100.0)
    request = TensorSliceRequestDTO(
        view_type="propagation_movie",
        selection=SelectionDTO(time=1.0, freq=0.0, ap=0, ml=0),
        time_range=(0.0, 2.0),
    )
    da = apply_slice_request(signal, request)
    # 2 s × 30 fps = 60 frames (and 200 native samples are plenty).
    assert da.sizes["time"] == 60


def test_propagation_movie_caps_at_native_sample_count() -> None:
    """If the user asks for more frames than the window holds, clip to native."""
    signal = _make_grid(n_time=1000, fs=100.0)
    request = TensorSliceRequestDTO(
        view_type="propagation_movie",
        selection=SelectionDTO(time=0.05, freq=0.0, ap=0, ml=0),
        time_range=(0.0, 0.1),  # ~11 native samples in this window
        n_frames=60,
    )
    da = apply_slice_request(signal, request)
    assert da.sizes["time"] <= 11


def test_propagation_movie_evenly_spaced_indices() -> None:
    signal = _make_grid(n_time=1000, fs=100.0)
    request = TensorSliceRequestDTO(
        view_type="propagation_movie",
        selection=SelectionDTO(time=2.5, freq=0.0, ap=0, ml=0),
        time_range=(0.0, 5.0),
        n_frames=6,
    )
    da = apply_slice_request(signal, request)
    times = np.asarray(da.coords["time"].values, dtype=float)
    diffs = np.diff(times)
    # Evenly-spaced index linspace → constant time gaps (within one sample).
    assert np.allclose(diffs, diffs[0], atol=1.0 / 100.0 + 1e-9)


def test_propagation_movie_attrs_carry_n_frames_and_view_type() -> None:
    signal = _make_grid()
    request = TensorSliceRequestDTO(
        view_type="propagation_movie",
        selection=SelectionDTO(time=1.0, freq=0.0, ap=0, ml=0),
        time_range=(0.0, 2.0),
        n_frames=8,
    )
    da = apply_slice_request(signal, request)
    assert da.attrs["view_type"] == "propagation_movie"
    assert da.attrs["n_frames"] == 8


def test_propagation_movie_requires_time_range() -> None:
    with pytest.raises(ValueError, match="time_range is required for propagation_movie"):
        TensorSliceRequestDTO(
            view_type="propagation_movie",
            selection=SelectionDTO(time=0.0, freq=0.0, ap=0, ml=0),
        )


def test_propagation_movie_n_frames_upper_bound() -> None:
    """Pydantic enforces a 240-frame ceiling so we don't blow up payload size."""
    with pytest.raises(ValueError):
        TensorSliceRequestDTO(
            view_type="propagation_movie",
            selection=SelectionDTO(time=0.0, freq=0.0, ap=0, ml=0),
            time_range=(0.0, 5.0),
            n_frames=500,
        )


def test_propagation_movie_round_trip_via_slice_endpoint() -> None:
    signal = _make_grid()
    state = create_server_state(signal, tensor_name="lfp")
    request = TensorSliceRequestDTO(
        view_type="propagation_movie",
        selection=SelectionDTO(time=1.0, freq=0.0, ap=0, ml=0),
        time_range=(0.0, 2.0),
        n_frames=12,
    )
    result = state.tensor_slice("lfp", request)
    assert result.dims == ["time", "AP", "ML"]
    assert result.shape == [12, 4, 8]
    assert result.view_type == "propagation_movie"


def test_propagation_movie_listed_in_view_registry() -> None:
    signal = _make_grid()
    state = create_server_state(signal, tensor_name="lfp")
    meta = state.tensor_meta("lfp")
    assert "propagation_movie" in meta.available_views
