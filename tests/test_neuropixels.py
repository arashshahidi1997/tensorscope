"""Neuropixels / linear-probe support.

Covers the Phase 1 coord-driven geometry path from
``docs/design/neuropixels-multiprobe.md``: a ``(time, channel)`` tensor that
carries a per-channel ``depth`` coord (the DV approximation) gains the
``depth_map`` view, reports a ``linear`` electrode layout, and slices to a
depth profile.
"""

from __future__ import annotations

import numpy as np
import xarray as xr

from tensorscope.io.assemble import assemble_session, prepare_linear_probe
from tensorscope.server.models import SelectionDTO, TensorSliceRequestDTO
from tensorscope.server.state import (
    apply_slice_request,
    available_views,
    create_server_state,
)


def _np_probe(nt: int = 100, n_ch: int = 8) -> xr.DataArray:
    """A (time, channel) tensor with a per-channel depth coord (µm)."""
    rng = np.random.default_rng(0)
    data = rng.standard_normal((nt, n_ch)).astype("float32")
    times = np.arange(nt) / 100.0
    depth = np.linspace(0.0, 700.0, n_ch)  # dorsal → ventral, µm
    return xr.DataArray(
        data,
        dims=("time", "channel"),
        coords={
            "time": times,
            "channel": np.arange(n_ch),
            "depth": ("channel", depth),
        },
        attrs={"fs": 100.0},
    )


def _ecog_grid(nt: int = 100, n_ap: int = 4, n_ml: int = 4) -> xr.DataArray:
    rng = np.random.default_rng(1)
    data = rng.standard_normal((nt, n_ap, n_ml)).astype("float32")
    return xr.DataArray(
        data,
        dims=("time", "AP", "ML"),
        coords={"time": np.arange(nt) / 100.0, "AP": np.arange(n_ap), "ML": np.arange(n_ml)},
        attrs={"fs": 100.0},
    )


def test_depth_coord_enables_depth_map_view() -> None:
    da = _np_probe()
    views = available_views(da)
    assert "depth_map" in views
    # Non-spatial flat views are still offered.
    assert "timeseries" in views


def test_flat_tensor_without_depth_has_no_depth_map() -> None:
    da = _np_probe().drop_vars("depth")
    assert "depth_map" not in available_views(da)


def test_depth_map_slice_returns_depth_time_image() -> None:
    # depth_map is a WINDOWED depth × time image (so a SWR/spindle can be read
    # across depth over time), not an instantaneous (channel,) profile.
    da = _np_probe(nt=100)
    req = TensorSliceRequestDTO(
        view_type="depth_map",
        selection=SelectionDTO(time=0.5, freq=10.0, ap=0, ml=0),
        time_range=(0.0, 1.0),
        max_points=2000,
    )
    sliced = apply_slice_request(da, req)
    assert set(sliced.dims) == {"channel", "time"}
    assert sliced.sizes["channel"] == da.sizes["channel"]
    # The per-channel depth coord rides along so the frontend orders rows
    # dorsal→ventral; channels are NOT reordered server-side (mask ids stable).
    assert "depth" in sliced.coords
    assert sliced.attrs.get("view_type") == "depth_map"


def test_depth_map_downsamples_time_to_max_points() -> None:
    da = _np_probe(nt=5000)
    req = TensorSliceRequestDTO(
        view_type="depth_map",
        selection=SelectionDTO(time=0.5, freq=10.0, ap=0, ml=0),
        time_range=(0.0, 50.0),
        max_points=400,
        downsample="minmax",
    )
    sliced = apply_slice_request(da, req)
    assert set(sliced.dims) == {"channel", "time"}
    # Thinned to fit the budget (fine for short windows, bounded for long ones).
    assert sliced.sizes["time"] <= 800  # minmax may emit up to 2× the bucket count


def test_electrode_layout_reports_linear_geometry() -> None:
    state = create_server_state({"np": _np_probe(n_ch=8)})
    layout = state.electrode_layout("np")
    assert layout.geometry == "linear"
    assert layout.n_ml == 1
    assert layout.n_ap == 8
    assert layout.n_electrodes == 8
    assert layout.ap_coords == sorted(layout.ap_coords)  # depth-sorted


def test_grid_tensor_keeps_grid_layout() -> None:
    state = create_server_state({"ecog": _ecog_grid()})
    layout = state.electrode_layout("ecog")
    assert layout.geometry == "grid"
    assert layout.n_ap == 4 and layout.n_ml == 4


def test_multi_probe_session_binds_geometry_per_tensor() -> None:
    """ECoG grid + NP linear coexist; each keeps its own geometry."""
    session = assemble_session(
        {
            "ecog": _ecog_grid(),
            "neuropixels": prepare_linear_probe(
                _np_probe().drop_vars("depth"),
                depth=np.linspace(0.0, 700.0, 8),
                fs=100.0,
            ),
        }
    )
    state = create_server_state(session)
    assert state.electrode_layout("ecog").geometry == "grid"
    assert state.electrode_layout("neuropixels").geometry == "linear"
    assert "depth_map" in available_views(state.get_node("neuropixels").data)
    assert "spatial_map" in available_views(state.get_node("ecog").data)


def test_prepare_linear_probe_attaches_depth_and_fs() -> None:
    bare = _np_probe().drop_vars("depth")
    del bare.attrs["fs"]
    out = prepare_linear_probe(bare, depth=np.linspace(0.0, 700.0, 8), fs=2500.0)
    assert "depth" in out.coords
    assert out.coords["depth"].dims == ("channel",)
    assert out.attrs["fs"] == 2500.0


def test_prepare_linear_probe_rejects_depth_length_mismatch() -> None:
    bare = _np_probe(n_ch=8).drop_vars("depth")
    try:
        prepare_linear_probe(bare, depth=np.linspace(0.0, 700.0, 4))
    except ValueError as exc:
        assert "depth" in str(exc).lower()
    else:  # pragma: no cover
        raise AssertionError("expected ValueError on depth/channel length mismatch")
