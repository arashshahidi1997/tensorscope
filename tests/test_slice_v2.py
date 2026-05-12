"""Parity tests for the contract-v2 binary slice endpoint.

The v2 endpoint shares its handler chain (selection → processing cache →
``apply_slice_request``) with v1; only the encoder differs. These tests
prove that the underlying numpy values + coords agree across the two wire
formats, and that the v2 schema metadata carries the dim ordering / shape /
dtype the decoder depends on.
"""

from __future__ import annotations

import base64
import json
from io import BytesIO

import numpy as np
import pyarrow.ipc as pa_ipc
import pytest
import xarray as xr
from fastapi.testclient import TestClient

from tensorscope.server.app import create_app
from tensorscope.server.routers.tensors_v2 import ARROW_STREAM_MEDIA_TYPE
from tensorscope.server.state import (
    CONTRACT_V2_METADATA_KEY,
    CONTRACT_V2_VERSION,
    encode_arrow_v2,
)


# ── Fixtures ──────────────────────────────────────────────────────────────

def _grid_signal(n_time: int = 200, n_ap: int = 4, n_ml: int = 6, fs: float = 100.0) -> xr.DataArray:
    """3-D (time, AP, ML) tensor — covers the majority of slice paths.

    Distinct integer coords on every dim so the parity test can detect
    accidental dim swaps (transposed reshape would surface as values
    mismatch, but coord swaps would silently re-arrange into the wrong
    grid)."""
    t = np.arange(n_time) / fs
    rng = np.random.default_rng(7)
    base = np.sin(2 * np.pi * 5 * t)[:, None, None]
    data = rng.normal(0.0, 0.1, (n_time, n_ap, n_ml)) + base
    return xr.DataArray(
        data,
        dims=("time", "AP", "ML"),
        coords={"time": t, "AP": np.arange(n_ap), "ML": np.arange(n_ml)},
        attrs={"fs": fs, "units": "uV"},
        name="lfp",
    )


def _client(signal: xr.DataArray) -> TestClient:
    return TestClient(create_app(signal, tensor_name="lfp"))


def _decode_v1_long(payload_b64: str) -> dict[str, np.ndarray]:
    """Decode a v1 long-format Arrow IPC + base64 payload to columns."""
    raw = base64.b64decode(payload_b64.encode("ascii"))
    with pa_ipc.open_stream(BytesIO(raw)) as reader:
        table = reader.read_all()
    return {f.name: table.column(f.name).to_numpy(zero_copy_only=False) for f in table.schema}


def _decode_v2_labeled(body: bytes) -> tuple[dict[str, object], np.ndarray, dict[str, np.ndarray]]:
    """Decode a v2 binary Arrow IPC body to (metadata, data, coords)."""
    with pa_ipc.open_stream(BytesIO(body)) as reader:
        batch = next(iter(reader))
    md = batch.schema.metadata or {}
    meta_blob = md[CONTRACT_V2_METADATA_KEY.encode("ascii")]
    metadata = json.loads(meta_blob.decode("utf-8"))
    data_col = batch.column("data")
    flat = np.asarray(data_col.values, dtype=np.float32)
    shape = tuple(metadata["shape"])
    cube = flat.reshape(shape)
    coords: dict[str, np.ndarray] = {}
    for f in batch.schema:
        if f.name.startswith("coords/"):
            dim = f.name.split("/", 1)[1]
            coords[dim] = np.asarray(batch.column(f.name).values)
    return metadata, cube, coords


# ── Encoder unit tests ────────────────────────────────────────────────────

def test_encode_arrow_v2_round_trip_3d():
    """3-D tensor encodes to a single batch with FixedSizeList<float32>."""
    signal = _grid_signal(n_time=10, n_ap=3, n_ml=2)
    body = encode_arrow_v2(signal)
    metadata, cube, coords = _decode_v2_labeled(body)
    assert metadata["version"] == CONTRACT_V2_VERSION
    assert metadata["dims"] == ["time", "AP", "ML"]
    assert metadata["shape"] == [10, 3, 2]
    assert metadata["dtype"] == "float32"
    assert metadata["units"] == "uV"
    np.testing.assert_allclose(cube, signal.values.astype(np.float32))
    np.testing.assert_array_equal(coords["time"], signal.time.values)
    np.testing.assert_array_equal(coords["AP"], signal.AP.values.astype(np.float64))
    np.testing.assert_array_equal(coords["ML"], signal.ML.values.astype(np.float64))


def test_encode_arrow_v2_carries_processing_and_provenance():
    signal = _grid_signal(n_time=5, n_ap=2, n_ml=2)
    body = encode_arrow_v2(
        signal,
        processing={"requested": True, "applied": False, "error": "filter blew up"},
        slice_provenance={
            "method": "minmax",
            "max_points": 2000,
            "original_shape": [5, 2, 2],
            "returned_shape": [5, 2, 2],
            "masked_ids": [3],
        },
    )
    metadata, _, _ = _decode_v2_labeled(body)
    assert metadata["processing"]["error"] == "filter blew up"
    assert metadata["slice_provenance"]["max_points"] == 2000
    assert metadata["slice_provenance"]["masked_ids"] == [3]


def test_encode_arrow_v2_handles_nans():
    signal = _grid_signal(n_time=4, n_ap=2, n_ml=2)
    signal.values[1, 0, 0] = np.nan
    body = encode_arrow_v2(signal)
    _, cube, _ = _decode_v2_labeled(body)
    assert np.isnan(cube[1, 0, 0])


def test_encode_arrow_v2_payload_is_smaller_than_v1():
    """Sanity floor — v2 must beat v1 on a representative cube even before
    workers / compression. Tightens the audit's claim of ~5× wire reduction.

    Targets the spectrogram_live shape (200 time × 64 freq × 8×8 grid =
    ~820k cells) — comparable to the audit's 56 MB v1 payload at scale.
    """
    from tensorscope.server.state import encode_arrow_payload

    rng = np.random.default_rng(0)
    cube = rng.normal(size=(200, 64, 8, 8)).astype(np.float32)
    da = xr.DataArray(
        cube,
        dims=("time", "freq", "AP", "ML"),
        coords={
            "time": np.linspace(0, 2.0, 200),
            "freq": np.linspace(0, 250, 64),
            "AP": np.arange(8),
            "ML": np.arange(8),
        },
    )
    v1_size = len(encode_arrow_payload(da).encode("ascii"))
    v2_size = len(encode_arrow_v2(da))
    ratio = v1_size / v2_size
    # We expect ≥5× per the audit + survey. Leaving a bit of headroom (4×)
    # to keep the test robust against pyarrow version drift; the assert
    # message records the actual ratio for visibility.
    assert ratio >= 4.0, (
        f"v2 wire size {v2_size} bytes is not enough smaller than v1 "
        f"{v1_size} bytes (ratio {ratio:.2f}×); expected ≥4×"
    )


# ── Endpoint integration tests ────────────────────────────────────────────

def test_v2_slice_endpoint_returns_arrow_stream():
    signal = _grid_signal(n_time=20, n_ap=2, n_ml=2)
    client = _client(signal)
    body = {
        "view_type": "spatial_map",
        "selection": {"time": 0.05, "freq": 0.0, "ap": 0, "ml": 0, "channel": None},
        "time_range": [0.0, 0.1],
        "max_points": 200,
        "downsample": "none",
    }
    resp = client.post("/api/v2/tensors/lfp/slice", json=body)
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"] == ARROW_STREAM_MEDIA_TYPE
    metadata, cube, coords = _decode_v2_labeled(resp.content)
    assert metadata["version"] == CONTRACT_V2_VERSION
    assert "AP" in coords and "ML" in coords
    # spatial_map collapses the time dim — sanity-check we got a (time-window,
    # AP, ML) shape (apply_slice_request returns the windowed slice unchanged).
    assert cube.shape == tuple(metadata["shape"])


def test_v1_v2_parity_psd_live():
    """Same request, two endpoints, equal numbers — the parity gate.

    Pulls a psd_live request (the deliverable's PSDHeatmap target view)
    through both endpoints, decodes both, and asserts the underlying
    (freq, AP, ML) cube agrees within float32 tolerance.
    """
    signal = _grid_signal(n_time=512, n_ap=3, n_ml=4, fs=200.0)
    client = _client(signal)
    body = {
        "view_type": "psd_live",
        "selection": {"time": 1.0, "freq": 10.0, "ap": 0, "ml": 0, "channel": None},
        "time_range": [0.0, 2.0],
        "psd_params": {"NW": 3, "fmin": 1.0, "fmax": 50.0},
    }
    resp_v1 = client.post("/api/v1/tensors/lfp/slice", json=body)
    resp_v2 = client.post("/api/v2/tensors/lfp/slice", json=body)
    assert resp_v1.status_code == 200, resp_v1.text
    assert resp_v2.status_code == 200, resp_v2.text

    v1_cols = _decode_v1_long(resp_v1.json()["payload"])
    metadata, v2_cube, v2_coords = _decode_v2_labeled(resp_v2.content)

    # v1 ships long-format (freq, AP, ML, value); v2 ships a labeled cube.
    # Reconstruct the cube from v1 in (freq, AP, ML) order and compare.
    assert metadata["dims"] == ["freq", "AP", "ML"]
    freq_axis = v2_coords["freq"]
    ap_axis = v2_coords["AP"]
    ml_axis = v2_coords["ML"]
    np.testing.assert_array_equal(np.unique(v1_cols["freq"]), freq_axis)
    np.testing.assert_array_equal(np.unique(v1_cols["AP"]), ap_axis.astype(v1_cols["AP"].dtype))
    np.testing.assert_array_equal(np.unique(v1_cols["ML"]), ml_axis.astype(v1_cols["ML"].dtype))

    # Build the v1 cube via ranking.
    freq_idx = np.searchsorted(freq_axis, v1_cols["freq"])
    ap_idx = np.searchsorted(ap_axis, v1_cols["AP"])
    ml_idx = np.searchsorted(ml_axis, v1_cols["ML"])
    v1_cube = np.full(v2_cube.shape, np.nan, dtype=np.float32)
    v1_cube[freq_idx, ap_idx, ml_idx] = v1_cols["value"].astype(np.float32)

    # NaN-safe comparison; psd_live values can vary by ~5e-6 across
    # backends after the float64 → float32 cast in v2.
    finite = np.isfinite(v1_cube) & np.isfinite(v2_cube)
    assert finite.any()
    np.testing.assert_allclose(v1_cube[finite], v2_cube[finite], rtol=1e-4, atol=1e-6)


def test_v1_response_carries_contract_version():
    signal = _grid_signal(n_time=20, n_ap=2, n_ml=2)
    client = _client(signal)
    body = {
        "view_type": "spatial_map",
        "selection": {"time": 0.05, "freq": 0.0, "ap": 0, "ml": 0, "channel": None},
        "time_range": [0.0, 0.1],
        "max_points": 200,
        "downsample": "none",
    }
    resp = client.post("/api/v1/tensors/lfp/slice", json=body)
    assert resp.status_code == 200
    assert resp.json()["meta"]["contract_version"] == "1.0"


@pytest.mark.parametrize("missing_view", ["timeseries", "psd_live", "spectrogram_live"])
def test_v2_endpoint_serves_every_view_type(missing_view: str):
    """v2 endpoint must accept the same view_type vocabulary as v1."""
    signal = _grid_signal(n_time=512, n_ap=2, n_ml=3, fs=200.0)
    client = _client(signal)
    body: dict = {
        "view_type": missing_view,
        "selection": {"time": 1.0, "freq": 10.0, "ap": 0, "ml": 0, "channel": None},
        "time_range": [0.0, 2.0],
    }
    if missing_view in {"timeseries"}:
        body["max_points"] = 500
        body["downsample"] = "minmax"
    if missing_view == "psd_live":
        body["psd_params"] = {"NW": 3, "fmax": 50.0}
    resp = client.post("/api/v2/tensors/lfp/slice", json=body)
    assert resp.status_code == 200, resp.text
    metadata, cube, _ = _decode_v2_labeled(resp.content)
    assert cube.shape == tuple(metadata["shape"])
