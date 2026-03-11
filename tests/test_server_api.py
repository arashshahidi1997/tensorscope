from __future__ import annotations

import base64
from io import BytesIO

import pandas as pd
import pyarrow.ipc as pa_ipc
import pytest
import xarray as xr
from fastapi.testclient import TestClient
from pydantic import ValidationError

from tensorscope.core.events import EventRegistry, EventStream
from tensorscope.server.app import create_app
from tensorscope.server.models import DownsampleMethod, SelectionDTO, TensorSliceRequestDTO
from tensorscope.server.session import SESSION_COOKIE_NAME


def _grid_data() -> xr.DataArray:
    return xr.DataArray(
        [
            [[0.0, 1.0, 2.0], [3.0, 4.0, 5.0]],
            [[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]],
            [[2.0, 3.0, 4.0], [5.0, 6.0, 7.0]],
            [[3.0, 4.0, 5.0], [6.0, 7.0, 8.0]],
        ],
        dims=("time", "AP", "ML"),
        coords={"time": [0.0, 0.5, 1.0, 1.5], "AP": [0, 1], "ML": [0, 1, 2]},
        name="lfp",
    )


def _client() -> TestClient:
    registry = EventRegistry()
    registry.register(
        EventStream(
            "ripples",
            pd.DataFrame(
                {
                    "event_id": [1, 2, 3],
                    "t": [0.25, 0.75, 1.25],
                    "AP": [0, 1, 1],
                    "ML": [1, 2, 0],
                }
            ),
        )
    )
    app = create_app(_grid_data(), events_registry=registry)
    return TestClient(app)


def _decode_arrow_payload(payload: str) -> pd.DataFrame:
    raw = base64.b64decode(payload.encode("ascii"))
    with pa_ipc.open_stream(BytesIO(raw)) as reader:
        return reader.read_all().to_pandas()


def test_selection_dto_validation() -> None:
    with pytest.raises(ValidationError):
        SelectionDTO(time=-1.0, freq=0.0, ap=0, ml=0, channel=None)


def test_slice_request_requires_time_range_and_max_points() -> None:
    with pytest.raises(ValidationError):
        TensorSliceRequestDTO(
            view_type="timeseries",
            selection=SelectionDTO(time=0.0, freq=0.0, ap=0, ml=0, channel=None),
        )


def test_get_state_creates_session_cookie() -> None:
    client = _client()
    response = client.get("/api/v1/state")
    body = response.json()

    assert response.status_code == 200
    assert SESSION_COOKIE_NAME in response.cookies
    assert body["session_id"] == response.cookies[SESSION_COOKIE_NAME]
    assert body["active_tensor"] == "signal"
    assert len(body["tensors"]) == 1
    assert len(body["events"]) == 1


def test_session_state_is_isolated_per_client() -> None:
    client_a = _client()
    client_b = _client()

    client_a.put("/api/v1/selection", json={"time": 1.0, "freq": 0.0, "ap": 1, "ml": 2, "channel": None})
    selection_a = client_a.get("/api/v1/selection").json()
    selection_b = client_b.get("/api/v1/selection").json()

    assert selection_a["time"] == 1.0
    assert selection_b["time"] == 0.0


def test_layout_update_and_invalid_preset() -> None:
    client = _client()

    ok = client.put("/api/v1/layout", json={"preset": "psd_explorer"})
    bad = client.put("/api/v1/layout", json={"preset": "missing"})

    assert ok.status_code == 200
    assert ok.json()["current_preset"] == "psd_explorer"
    assert bad.status_code == 400
    assert bad.json()["code"] == "invalid_request"


def test_event_endpoints_and_missing_event() -> None:
    client = _client()

    listed = client.get("/api/v1/events")
    single = client.get("/api/v1/events/ripples")
    window = client.get("/api/v1/events/ripples/window", params={"t0": 0.0, "t1": 1.0, "ap": 1})
    missing = client.get("/api/v1/events/missing")

    assert listed.status_code == 200
    assert single.status_code == 200
    assert len(window.json()) == 1
    assert missing.status_code == 404
    assert missing.json()["code"] == "not_found"


def test_tensor_metadata_and_missing_tensor() -> None:
    client = _client()

    listed = client.get("/api/v1/tensors")
    single = client.get("/api/v1/tensors/signal")
    missing = client.get("/api/v1/tensors/missing")

    assert listed.status_code == 200
    assert single.status_code == 200
    assert single.json()["available_views"] == ["timeseries", "spatial_map", "navigator"]
    assert missing.status_code == 404


def test_tensor_slice_returns_arrow_payload_and_metadata() -> None:
    client = _client()
    response = client.post(
        "/api/v1/tensors/signal/slice",
        json={
            "view_type": "timeseries",
            "selection": {"time": 0.0, "freq": 0.0, "ap": 0, "ml": 0, "channel": None},
            "time_range": [0.0, 1.5],
            "max_points": 3,
            "downsample": "minmax",
        },
    )

    assert response.status_code == 200
    body = response.json()
    frame = _decode_arrow_payload(body["payload"])

    assert body["encoding"] == "arrow_ipc"
    assert body["meta"]["downsampling"]["method"] == DownsampleMethod.MINMAX.value
    assert set(frame.columns) == {"time", "AP", "ML", "value"}


def test_spatial_map_slice_resolves_to_selected_time_plane() -> None:
    client = _client()
    response = client.post(
        "/api/v1/tensors/signal/slice",
        json={
            "view_type": "spatial_map",
            "selection": {"time": 1.1, "freq": 0.0, "ap": 0, "ml": 0, "channel": None},
            "time_range": [0.0, 1.5],
            "max_points": 4,
            "downsample": "none",
        },
    )

    assert response.status_code == 200
    body = response.json()
    frame = _decode_arrow_payload(body["payload"])

    assert body["dims"] == ["AP", "ML"]
    assert body["meta"]["downsampling"]["returned_shape"] == [2, 3]
    assert set(frame.columns) == {"AP", "ML", "value"}


def test_tensor_slice_rejects_missing_bounds() -> None:
    client = _client()
    response = client.post(
        "/api/v1/tensors/signal/slice",
        json={
            "view_type": "timeseries",
            "selection": {"time": 0.0, "freq": 0.0, "ap": 0, "ml": 0, "channel": None},
            "max_points": 4,
        },
    )
    assert response.status_code == 422


def test_openapi_schema_exposes_phase2_routes() -> None:
    client = _client()
    schema = client.get("/openapi.json").json()

    assert "/api/v1/state" in schema["paths"]
    assert "/api/v1/tensors/{name}/slice" in schema["paths"]
    assert "/api/v1/events/{name}/window" in schema["paths"]
    assert "TensorSliceDTO" in schema["components"]["schemas"]
