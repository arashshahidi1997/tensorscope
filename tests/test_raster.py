"""channel × time raster view — amplitude heatmap, channels as rows.

Available for both linear (time, channel) and grid (time, AP, ML) tensors;
grid is flattened row-major to a (channel,) axis. See
docs/design/neuropixels-multiprobe.md.
"""

from __future__ import annotations

import numpy as np
import xarray as xr

from tensorscope.server.models import SelectionDTO, TensorSliceRequestDTO
from tensorscope.server.state import apply_slice_request, available_views


def _flat(nt: int = 200, n_ch: int = 8) -> xr.DataArray:
    rng = np.random.default_rng(0)
    return xr.DataArray(
        rng.standard_normal((nt, n_ch)).astype("float32"),
        dims=("time", "channel"),
        coords={"time": np.arange(nt) / 100.0, "channel": np.arange(n_ch),
                "depth": ("channel", np.linspace(0.0, 700.0, n_ch))},
        attrs={"fs": 100.0},
    )


def _grid(nt: int = 200, n_ap: int = 4, n_ml: int = 4) -> xr.DataArray:
    rng = np.random.default_rng(1)
    return xr.DataArray(
        rng.standard_normal((nt, n_ap, n_ml)).astype("float32"),
        dims=("time", "AP", "ML"),
        coords={"time": np.arange(nt) / 100.0, "AP": np.arange(n_ap), "ML": np.arange(n_ml)},
        attrs={"fs": 100.0},
    )


def _req(max_points: int = 2000) -> TensorSliceRequestDTO:
    return TensorSliceRequestDTO(
        view_type="raster",
        selection=SelectionDTO(time=0.5, freq=10.0, ap=0, ml=0),
        time_range=(0.0, 2.0),
        max_points=max_points,
        downsample="minmax",
    )


def test_raster_available_for_flat_and_grid() -> None:
    assert "raster" in available_views(_flat())
    assert "raster" in available_views(_grid())


def test_raster_flat_returns_channel_time() -> None:
    out = apply_slice_request(_flat(n_ch=8), _req())
    assert out.dims == ("channel", "time")
    assert out.sizes["channel"] == 8
    assert out.attrs.get("view_type") == "raster"
    # depth coord rides along for row ordering.
    assert "depth" in out.coords


def test_raster_grid_flattens_to_channel() -> None:
    out = apply_slice_request(_grid(n_ap=4, n_ml=4), _req())
    assert out.dims == ("channel", "time")
    assert out.sizes["channel"] == 16  # 4 × 4 flattened row-major
    # channel re-keyed to a plain 0..N integer index (no MultiIndex).
    assert list(out.coords["channel"].values) == list(range(16))


def test_raster_downsamples_time() -> None:
    out = apply_slice_request(_flat(nt=2000, n_ch=4), _req(max_points=200))
    assert out.sizes["time"] <= 200
    assert out.sizes["channel"] == 4
