"""Tests for the probe-layout sidecar (G7).

Covers the JSON loader and the GET /probe_layout endpoint contract:

- A session without a sidecar returns 404 (the documented "feature off"
  signal — the frontend treats it as "no overlay").
- A session with a sidecar returns the electrodes verbatim, preserving
  the channel/AP/ML/label fields.
- Malformed sidecars raise ``ValueError`` at load time so misconfigured
  bundles fail before the server boots.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
import xarray as xr
from fastapi.testclient import TestClient

from tensorscope.core.probe_layout import (
    Electrode,
    ProbeLayout,
    find_probe_layout_sidecar,
    load_probe_layout,
)
from tensorscope.server.app import create_app


def _grid_data() -> xr.DataArray:
    return xr.DataArray(
        [
            [[0.0, 1.0], [2.0, 3.0]],
            [[1.0, 2.0], [3.0, 4.0]],
        ],
        dims=("time", "AP", "ML"),
        coords={"time": [0.0, 0.5], "AP": [0, 1], "ML": [0, 1]},
        name="lfp",
    )


def _layout_fixture() -> ProbeLayout:
    return ProbeLayout(
        electrodes=(
            Electrode(region="M2", channel_id=0, ap=0, ml=0, label="ch0"),
            Electrode(region="M2", channel_id=1, ap=0, ml=1, label=None),
            Electrode(region="S1", channel_id=2, ap=1, ml=0, label=None),
            Electrode(region="S1", channel_id=3, ap=1, ml=1, label="ch3"),
        )
    )


def test_load_probe_layout_roundtrips(tmp_path: Path) -> None:
    sidecar = tmp_path / "probe_layout.json"
    sidecar.write_text(
        json.dumps(
            {
                "electrodes": [
                    {"channel_id": 0, "ap": 0, "ml": 0, "region": "M2", "label": "ch0"},
                    {"channel_id": 1, "ap": 0, "ml": 1, "region": "S1"},
                ]
            }
        )
    )
    layout = load_probe_layout(sidecar)
    assert layout.n_channels == 2
    assert layout.electrodes[0].region == "M2"
    assert layout.electrodes[0].label == "ch0"
    assert layout.electrodes[1].region == "S1"
    assert layout.electrodes[1].label is None


def test_load_probe_layout_rejects_missing_region(tmp_path: Path) -> None:
    sidecar = tmp_path / "probe_layout.json"
    sidecar.write_text(json.dumps({"electrodes": [{"channel_id": 0}]}))
    with pytest.raises(ValueError, match="region"):
        load_probe_layout(sidecar)


def test_load_probe_layout_rejects_missing_array(tmp_path: Path) -> None:
    sidecar = tmp_path / "probe_layout.json"
    sidecar.write_text(json.dumps({}))
    with pytest.raises(ValueError, match="electrodes"):
        load_probe_layout(sidecar)


def test_find_probe_layout_sidecar_directory_and_file(tmp_path: Path) -> None:
    data_dir = tmp_path / "bundle"
    data_dir.mkdir()
    # No sidecar yet → None.
    assert find_probe_layout_sidecar(data_dir) is None
    # Sidecar in directory → found.
    (data_dir / "probe_layout.json").write_text('{"electrodes": []}')
    assert find_probe_layout_sidecar(data_dir) == data_dir / "probe_layout.json"
    # Sidecar next to a data file → found by parent search.
    nc_path = data_dir / "lfp.nc"
    nc_path.write_text("")
    assert find_probe_layout_sidecar(nc_path) == data_dir / "probe_layout.json"


def test_probe_layout_endpoint_404_without_sidecar() -> None:
    app = create_app(_grid_data())
    client = TestClient(app)
    response = client.get("/api/v1/probe_layout")
    assert response.status_code == 404


def test_probe_layout_endpoint_returns_loaded_sidecar() -> None:
    app = create_app(_grid_data(), probe_layout=_layout_fixture())
    client = TestClient(app)
    response = client.get("/api/v1/probe_layout")
    assert response.status_code == 200
    body = response.json()
    assert body["n_channels"] == 4
    electrodes = body["electrodes"]
    assert len(electrodes) == 4
    assert electrodes[0] == {
        "region": "M2",
        "channel_id": 0,
        "ap": 0,
        "ml": 0,
        "label": "ch0",
    }
    assert electrodes[3]["region"] == "S1"
    assert electrodes[3]["label"] == "ch3"


def test_probe_layout_survives_session_deepcopy() -> None:
    """Two clients must each see the sidecar — the template state is deep-copied
    per session and the probe layout must come along for the ride."""
    app = create_app(_grid_data(), probe_layout=_layout_fixture())
    client_a = TestClient(app)
    client_b = TestClient(app)
    ra = client_a.get("/api/v1/probe_layout")
    rb = client_b.get("/api/v1/probe_layout")
    assert ra.status_code == 200
    assert rb.status_code == 200
    assert ra.json()["n_channels"] == rb.json()["n_channels"] == 4
