"""Trajectory view: a (time, axis) position tensor served through the normal
slice path. No special slice branch — the default windowing returns (time, axis)
which the frontend pivots into a 2-D path. These tests pin the view availability
and the wire shape (time / axis / value columns)."""

from __future__ import annotations

import base64
from io import BytesIO

import numpy as np
import pandas as pd
import pyarrow.ipc as pa_ipc
import xarray as xr
from fastapi.testclient import TestClient

from tensorscope.server.app import create_app
from tensorscope.server.state import available_views


def _position() -> xr.DataArray:
    n = 200
    t = np.linspace(0.0, 10.0, n)
    xyz = np.stack([np.sin(t), np.cos(t), t / 10.0], axis=1)  # (time, axis)
    return xr.DataArray(
        xyz,
        dims=("time", "axis"),
        coords={"time": t, "axis": ["x", "y", "z"]},
        name="position",
    )


def _decode(payload: str) -> pd.DataFrame:
    raw = base64.b64decode(payload.encode("ascii"))
    with pa_ipc.open_stream(BytesIO(raw)) as reader:
        return reader.read_all().to_pandas()


def test_position_tensor_offers_trajectory_view() -> None:
    assert "trajectory" in available_views(_position())


def test_trajectory_slice_wire_shape() -> None:
    app = create_app(_position(), tensor_name="position")
    client = TestClient(app)
    resp = client.post(
        "/api/v1/tensors/position/slice",
        json={
            "view_type": "trajectory",
            "selection": {"time": 0.0, "freq": 0.0, "ap": 0, "ml": 0, "channel": None},
            "time_range": [0.0, 10.0],
            "max_points": 5000,
            "downsample": "minmax",
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["view_type"] == "trajectory"
    frame = _decode(body["payload"])
    assert set(frame.columns) == {"time", "axis", "value"}
    assert set(frame["axis"].unique()) == {"x", "y", "z"}


def test_trajectory_meta_lists_view() -> None:
    app = create_app(_position(), tensor_name="position")
    client = TestClient(app)
    meta = client.get("/api/v1/tensors/position").json()
    assert "trajectory" in meta["available_views"]
