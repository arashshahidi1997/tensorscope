"""Tests for the psd_live view type."""
import numpy as np
import pytest
import xarray as xr

from tensorscope.server.models import SelectionDTO, TensorSliceRequestDTO
from tensorscope.server.state import create_server_state


def _make_signal(n_time=2000, n_ap=4, n_ml=8, fs=1000.0):
    """Create a synthetic (time, AP, ML) signal with known frequency content."""
    t = np.arange(n_time) / fs
    rng = np.random.default_rng(42)
    # 10 Hz sine + noise on every channel
    base = np.sin(2 * np.pi * 10 * t)
    data = rng.normal(0, 0.1, (n_time, n_ap, n_ml)) + base[:, None, None]
    return xr.DataArray(
        data,
        dims=("time", "AP", "ML"),
        coords={"time": t, "AP": np.arange(n_ap), "ML": np.arange(n_ml)},
        attrs={"fs": fs},
    )


def test_psd_live_basic():
    """psd_live returns (freq, AP, ML) shaped result."""
    signal = _make_signal()
    state = create_server_state(signal, tensor_name="test_signal")

    request = TensorSliceRequestDTO(
        view_type="psd_live",
        selection=SelectionDTO(time=1.0, freq=10.0, ap=0, ml=0),
        time_range=[0.0, 2.0],
        psd_params={"NW": 4, "fmax": 100},
    )
    result = state.tensor_slice("test_signal", request)
    assert "freq" in result.dims
    assert result.shape[0] > 0  # has frequency bins


def test_psd_live_fmax_clip():
    """fmax parameter clips frequency range."""
    signal = _make_signal(fs=1000.0)
    state = create_server_state(signal, tensor_name="test_signal")

    request = TensorSliceRequestDTO(
        view_type="psd_live",
        selection=SelectionDTO(time=1.0, freq=10.0, ap=0, ml=0),
        time_range=[0.0, 2.0],
        psd_params={"NW": 4, "fmax": 50},
    )
    result = state.tensor_slice("test_signal", request)
    # All frequency values should be <= 50 Hz
    freq_coord = [
        c for c in result.meta["coords"] if c["name"] == "freq"
    ][0]
    assert freq_coord["max"] <= 50.0


def test_psd_live_available_in_views():
    """psd_live appears in available_views for (time, AP, ML) tensors."""
    signal = _make_signal()
    state = create_server_state(signal, tensor_name="test_signal")
    meta = state.tensor_meta("test_signal")
    assert "psd_live" in meta.available_views
