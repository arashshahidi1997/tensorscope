"""Channel-native + arbitrary-geometry format (prototype step #1).

Proves a non-grid probe (arbitrary 2-D electrode positions) is a first-class,
loadable, geometry-recognized tensor — generalizing the existing linear-`depth`
path — and that the schema no longer forces a dense AP×ML lattice. The
efficiency case is in ``bench/RESULTS.md``; this is the correctness/loadability
half.
"""
from __future__ import annotations

import numpy as np
import pytest
import xarray as xr

from tensorscope.core.geometry import resolve_positions
from tensorscope.core.schema import (
    SchemaError,
    channel_positions,
    geometry_kind,
    to_channel_native,
    validate_and_normalize_grid,
)
from tensorscope.io.assemble import prepare_planar_probe
from tensorscope.server.models import (
    PsdParamsDTO,
    SelectionDTO,
    SpectrogramLiveParamsDTO,
    TensorSliceRequestDTO,
)
from tensorscope.server.state import create_server_state


def _flat(n_time: int, n_ch: int, fs: float = 500.0) -> xr.DataArray:
    t = np.arange(n_time) / fs
    rng = np.random.default_rng(3)
    data = (np.sin(2 * np.pi * 10 * t)[:, None] + rng.normal(0, 0.3, (n_time, n_ch))).astype("float32")
    return xr.DataArray(
        data, dims=("time", "channel"),
        coords={"time": t, "channel": np.arange(n_ch)}, attrs={"fs": fs},
    )


def _grid(n_time: int = 100, n_ap: int = 2, n_ml: int = 3) -> xr.DataArray:
    rng = np.random.default_rng(5)
    return xr.DataArray(
        rng.normal(0, 1, (n_time, n_ap, n_ml)).astype("float32"),
        dims=("time", "AP", "ML"),
        coords={"time": np.arange(n_time) / 500.0, "AP": np.arange(n_ap), "ML": np.arange(n_ml)},
    )


# ── geometry_kind classifier ──────────────────────────────────────────────


def test_geometry_kind_grid_dims() -> None:
    assert geometry_kind(_grid()) == "grid"


def test_geometry_kind_dense_flat_is_grid() -> None:
    flat = _flat(50, 4).assign_coords(
        AP=("channel", [0, 0, 1, 1]), ML=("channel", [0, 1, 0, 1]),
    )
    assert geometry_kind(flat) == "grid"  # 4 ch = 2x2 complete lattice


def test_geometry_kind_planar() -> None:
    flat = prepare_planar_probe(_flat(50, 5), x=[0, 200, 0, 200, 400], y=[0, 0, 100, 100, 50])
    assert geometry_kind(flat) == "planar"


def test_geometry_kind_linear() -> None:
    flat = _flat(50, 6).assign_coords(depth=("channel", np.arange(6) * 20.0))
    assert geometry_kind(flat) == "linear"


def test_geometry_kind_plain_flat() -> None:
    assert geometry_kind(_flat(50, 8)) == "flat"


def test_channel_positions_reads_xy() -> None:
    flat = prepare_planar_probe(_flat(20, 3), x=[1.0, 2.0, 3.0], y=[4.0, 5.0, 6.0])
    pos = channel_positions(flat)
    assert pos is not None
    np.testing.assert_array_equal(pos[0], [1.0, 2.0, 3.0])
    np.testing.assert_array_equal(pos[1], [4.0, 5.0, 6.0])
    assert channel_positions(_flat(20, 3)) is None


# ── validate_and_normalize_grid relaxation ────────────────────────────────


def test_sparse_apml_accepted_channel_native_not_rejected() -> None:
    """A non-rectangular probe (AP/ML that don't tile a dense lattice) used to
    raise 'must cover a dense AP×ML grid'. It now stays channel-native."""
    flat = _flat(40, 3).assign_coords(
        AP=("channel", [0, 0, 1]), ML=("channel", [0, 1, 0]),  # missing (1,1)
    )
    out = validate_and_normalize_grid(flat)
    assert out.dims == ("time", "channel")  # NOT densified to (time, AP, ML)
    np.testing.assert_array_equal(out.coords["AP"].values, [0, 0, 1])


def test_planar_probe_accepted_channel_native() -> None:
    flat = prepare_planar_probe(_flat(40, 4), x=[0, 1, 2, 3], y=[0, 0, 1, 1])
    out = validate_and_normalize_grid(flat)
    assert out.dims == ("time", "channel")
    assert channel_positions(out) is not None  # geometry preserved


def test_plain_flat_accepted_channel_native() -> None:
    out = validate_and_normalize_grid(_flat(40, 8))
    assert out.dims == ("time", "channel")


def test_to_channel_native_grid_lossless_and_regriddable() -> None:
    """to_channel_native flattens a grid row-major (channel = ap*n_ml+ml) without
    losing data; the result classifies as 'grid' (dense lattice fast path) and
    re-grids exactly via validate_and_normalize_grid (round-trip)."""
    grid = _grid(n_time=20, n_ap=2, n_ml=3)
    cn = to_channel_native(grid)
    assert cn.dims == ("time", "channel")
    assert cn.sizes["channel"] == 6
    # row-major channel order: channel = ap*n_ml + ml
    np.testing.assert_array_equal(cn.coords["AP"].values, [0, 0, 0, 1, 1, 1])
    np.testing.assert_array_equal(cn.coords["ML"].values, [0, 1, 2, 0, 1, 2])
    # lossless: each channel equals its grid cell
    g = grid.transpose("time", "AP", "ML").values
    np.testing.assert_array_equal(cn.values, g.reshape(g.shape[0], -1))
    # still a dense lattice → grid fast path, and re-grids exactly
    assert geometry_kind(cn) == "grid"
    regridded = validate_and_normalize_grid(cn)
    assert regridded.dims == ("time", "AP", "ML")
    np.testing.assert_array_equal(regridded.values, g)
    # positions derivable as (x, y) = (ML, AP) without a separate coord
    pos = resolve_positions(cn)
    assert pos is not None
    np.testing.assert_array_equal(pos[:, 0], [0, 1, 2, 0, 1, 2])  # x = ML
    np.testing.assert_array_equal(pos[:, 1], [0, 0, 0, 1, 1, 1])  # y = AP


def test_to_channel_native_passthrough_and_reject() -> None:
    flat = _flat(20, 4)
    assert to_channel_native(flat) is flat  # already channel-native → unchanged
    non_spatial = xr.DataArray(np.zeros((3, 2)), dims=("time", "freq"))
    with pytest.raises(SchemaError, match="expects"):
        to_channel_native(non_spatial)


def test_dense_flat_still_densifies_to_grid() -> None:
    """Back-compat: a complete dense lattice is still reshaped to (time,AP,ML)."""
    flat = _flat(30, 4).assign_coords(
        AP=("channel", [0, 0, 1, 1]), ML=("channel", [0, 1, 0, 1]),
    )
    out = validate_and_normalize_grid(flat)
    assert out.dims == ("time", "AP", "ML")
    assert out.sizes["AP"] == 2 and out.sizes["ML"] == 2


def test_channel_native_still_rejects_non_monotonic_time() -> None:
    flat = _flat(4, 3)
    flat = flat.assign_coords(time=[0.0, 0.5, 0.25, 1.0])
    with pytest.raises(SchemaError, match="monotonically increasing"):
        validate_and_normalize_grid(flat)


# ── prepare_planar_probe ──────────────────────────────────────────────────


def test_prepare_planar_probe_stamps_coords_and_fs() -> None:
    out = prepare_planar_probe(
        _flat(20, 3), x=[0, 1, 2], y=[3, 4, 5], z=[6, 7, 8],
        shank=[0, 0, 1], region=["CA1", "CA1", "CA3"], fs=1000.0,
    )
    assert out.attrs["fs"] == 1000.0
    np.testing.assert_array_equal(out.coords["z"].values, [6, 7, 8])
    np.testing.assert_array_equal(out.coords["shank"].values, [0, 0, 1])
    assert list(out.coords["region"].values) == ["CA1", "CA1", "CA3"]


def test_prepare_planar_probe_length_mismatch_raises() -> None:
    with pytest.raises(ValueError, match="must match channel count"):
        prepare_planar_probe(_flat(20, 3), x=[0, 1], y=[0, 1])


def test_prepare_planar_probe_requires_flat_dims() -> None:
    with pytest.raises(ValueError, match="must have dims"):
        prepare_planar_probe(_grid(), x=[0], y=[0])


# ── electrode_layout planar branch ────────────────────────────────────────


def test_electrode_layout_reports_planar_geometry() -> None:
    probe = prepare_planar_probe(
        _flat(50, 5), x=[0, 200, 0, 200, 400], y=[0, 0, 100, 100, 50], fs=500.0,
    )
    state = create_server_state(probe, tensor_name="npx4")
    layout = state.electrode_layout("npx4")
    assert layout.geometry == "planar"
    assert layout.n_electrodes == 5
    np.testing.assert_array_equal(layout.x_coords, [0, 200, 0, 200, 400])
    np.testing.assert_array_equal(layout.y_coords, [0, 0, 100, 100, 50])


def test_electrode_layout_grid_unchanged() -> None:
    state = create_server_state(_grid(), tensor_name="ecog")
    assert state.electrode_layout("ecog").geometry == "grid"


def test_planar_probe_advertises_spatial_map_view() -> None:
    probe = prepare_planar_probe(
        _flat(100, 5), x=[0, 200, 0, 200, 400], y=[0, 0, 100, 100, 50], fs=500.0,
    )
    state = create_server_state(probe, tensor_name="npx4")
    assert "spatial_map" in state.tensor_meta("npx4").available_views


def test_electrodes_http_endpoint_planar_and_grid() -> None:
    """GET /tensors/{name}/electrodes serves geometry for the scatter view."""
    from fastapi.testclient import TestClient

    from tensorscope.server.app import create_app

    probe = prepare_planar_probe(
        _flat(100, 4), x=[0, 1, 2, 3], y=[0, 0, 1, 1], fs=500.0,
    )
    app = create_app({"npx": probe, "ecog": _grid()}, tensor_name="npx")
    client = TestClient(app)

    planar = client.get("/api/v1/tensors/npx/electrodes").json()
    assert planar["geometry"] == "planar"
    assert planar["x_coords"] == [0, 1, 2, 3]
    assert planar["y_coords"] == [0, 0, 1, 1]

    grid = client.get("/api/v1/tensors/ecog/electrodes").json()
    assert grid["geometry"] == "grid"
    assert grid["x_coords"] is None  # positions only for planar

    assert client.get("/api/v1/tensors/missing/electrodes").status_code == 404


# ── end-to-end: the flat views work on a non-grid probe ───────────────────


@pytest.mark.parametrize("view", ["timeseries", "raster", "psd_live", "spectrogram_live"])
def test_planar_probe_serves_flat_views(view: str) -> None:
    probe = prepare_planar_probe(
        _flat(2000, 16, fs=500.0),
        x=np.linspace(0, 600, 16), y=np.linspace(0, 1500, 16), fs=500.0,
    )
    state = create_server_state(probe, tensor_name="probe")
    assert view in state.tensor_meta("probe").available_views
    sel = SelectionDTO(time=1.0, freq=10.0, ap=0, ml=0)
    kwargs: dict = {"view_type": view, "selection": sel, "time_range": (0.5, 3.5)}
    if view in ("timeseries", "raster"):
        kwargs.update(max_points=1000, downsample="minmax")
    if view == "psd_live":
        kwargs["psd_params"] = PsdParamsDTO()
    if view == "spectrogram_live":
        kwargs["spectrogram_live_params"] = SpectrogramLiveParamsDTO(nperseg_s=0.5, fmax_hz=30.0)
    result = state.tensor_slice("probe", TensorSliceRequestDTO(**kwargs))
    assert result.meta["shape"][0] > 0 if "shape" in result.meta else True
