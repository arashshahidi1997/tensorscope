"""Audit F3 + F21 — slice meta must surface display transforms and the
processing-pipeline status (so silent on-server normalisation and silent
processing fallback no longer mislead users)."""
from __future__ import annotations

import numpy as np
import xarray as xr
from fastapi.testclient import TestClient

from tensorscope.server.app import create_app
from tensorscope.server.models import (
    ProcessingParamsDTO,
    SelectionDTO,
    TensorSliceRequestDTO,
)
from tensorscope.server.state import create_server_state


def _grid(n_time: int = 1000, fs: float = 100.0) -> xr.DataArray:
    t = np.arange(n_time) / fs
    rng = np.random.default_rng(0)
    return xr.DataArray(
        rng.normal(size=(n_time, 4, 4)),
        dims=("time", "AP", "ML"),
        coords={"time": t, "AP": np.arange(4), "ML": np.arange(4)},
        attrs={"fs": fs, "units": "uV"},
    )


# ── F3: display transforms surfaced in slice meta ────────────────────────


def test_timeseries_slice_advertises_zscore_offset_in_meta() -> None:
    state = create_server_state(_grid(), tensor_name="lfp")
    request = TensorSliceRequestDTO(
        view_type="timeseries",
        selection=SelectionDTO(time=2.0, freq=0.0, ap=0, ml=0),
        time_range=(0.0, 4.0),
        max_points=200,
    )
    result = state.tensor_slice("lfp", request)
    assert "zscore_offset(scale=3.0)" in result.meta["display_transforms"]


def test_navigator_slice_does_not_apply_zscore_offset() -> None:
    """N1 (refactor-plan): the navigator collapses channels to a mean trace, so
    the per-channel zscore_offset display transform is pure waste — and worse,
    it forces a full-session, full-rate compute before downsampling. Assert
    the navigator slice does not advertise zscore_offset, and returns finite
    data."""
    state = create_server_state(_grid(), tensor_name="lfp")
    request = TensorSliceRequestDTO(
        view_type="navigator",
        selection=SelectionDTO(time=2.0, freq=0.0, ap=0, ml=0),
        time_range=(0.0, 4.0),
        max_points=200,
    )
    result = state.tensor_slice("lfp", request)
    assert result.meta["display_transforms"] == []
    # Decode the v1 long-format Arrow envelope and assert finite data made it
    # through (regression guard: a bug in the navigator path must not silently
    # return NaNs / empty data).
    import base64
    import pyarrow.ipc as pa_ipc

    table = pa_ipc.open_stream(base64.b64decode(result.payload)).read_all().to_pandas()
    values = table["value"].to_numpy()
    assert values.size > 0
    assert np.all(np.isfinite(values))


def test_spatial_map_slice_has_no_display_transforms() -> None:
    state = create_server_state(_grid(), tensor_name="lfp")
    request = TensorSliceRequestDTO(
        view_type="spatial_map",
        selection=SelectionDTO(time=2.0, freq=0.0, ap=0, ml=0),
        time_range=(0.0, 4.0),
    )
    result = state.tensor_slice("lfp", request)
    assert result.meta["display_transforms"] == []


# ── F21: processing status surfaced in slice meta ────────────────────────


def test_processing_meta_off_when_no_processing() -> None:
    state = create_server_state(_grid(), tensor_name="lfp")
    request = TensorSliceRequestDTO(
        view_type="spatial_map",
        selection=SelectionDTO(time=2.0, freq=0.0, ap=0, ml=0),
        time_range=(0.0, 4.0),
    )
    result = state.tensor_slice("lfp", request)
    proc = result.meta["processing"]
    assert proc == {"requested": False, "applied": False, "error": None}


def test_processing_meta_applied_true_on_success() -> None:
    state = create_server_state(_grid(), tensor_name="lfp")
    state.set_processing(ProcessingParamsDTO(zscore=True))
    request = TensorSliceRequestDTO(
        view_type="spatial_map",
        selection=SelectionDTO(time=2.0, freq=0.0, ap=0, ml=0),
        time_range=(0.0, 4.0),
    )
    result = state.tensor_slice("lfp", request)
    proc = result.meta["processing"]
    assert proc["requested"] is True
    assert proc["applied"] is True
    assert proc["error"] is None


def test_processing_meta_surfaces_silent_fallback(monkeypatch) -> None:
    """If the processing pipeline raises, the slice still returns 200 (graceful
    fallback), but meta.processing.applied must be False with an error string
    so the frontend can flag it."""
    state = create_server_state(_grid(), tensor_name="lfp")

    def _raise(*_a, **_k):
        raise RuntimeError("simulated cogpy filter blow-up")

    # Monkeypatch the apply_processing import the cache path uses.
    monkeypatch.setattr("tensorscope.server.state.apply_processing", _raise)
    state.set_processing(ProcessingParamsDTO(zscore=True))
    request = TensorSliceRequestDTO(
        view_type="spatial_map",
        selection=SelectionDTO(time=2.0, freq=0.0, ap=0, ml=0),
        time_range=(0.0, 4.0),
    )
    result = state.tensor_slice("lfp", request)
    proc = result.meta["processing"]
    assert proc["requested"] is True
    assert proc["applied"] is False
    assert isinstance(proc["error"], str)
    assert "simulated cogpy filter blow-up" in proc["error"]


# ── HTTP round-trip ─────────────────────────────────────────────────────


def test_http_slice_meta_includes_display_transforms_and_processing() -> None:
    app = create_app(_grid(), tensor_name="lfp", pair_mode=True)
    client = TestClient(app)
    r = client.post(
        "/api/v1/tensors/lfp/slice",
        json={
            "view_type": "timeseries",
            "selection": {"time": 2.0, "freq": 0.0, "ap": 0, "ml": 0, "channel": None},
            "time_range": [0.0, 4.0],
            "max_points": 200,
        },
    )
    assert r.status_code == 200
    meta = r.json()["meta"]
    assert "zscore_offset(scale=3.0)" in meta["display_transforms"]
    assert meta["processing"] == {"requested": False, "applied": False, "error": None}
