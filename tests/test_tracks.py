"""Context-track adapters, helpers, and endpoints.

Covers the generic track layer that generalizes the single brainstate slot:
the io adapters (epoch rasterizer + scalar wrapper), the state helpers
(meta / intervals / min-max decimation), the /tracks router, and brainstate
back-compat (brainstate is folded in as track #0; /brainstates still works).
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
import xarray as xr
from fastapi.testclient import TestClient

from tensorscope.io.tracks import brainstate_track_from_epochs, scalar_track_from_series
from tensorscope.server.app import create_app
from tensorscope.server.state import track_intervals, track_kind, track_meta, track_series


# --- io adapters -------------------------------------------------------------

def _epochs() -> pd.DataFrame:
    # Contiguous wake/NREM/MA epochs, tags as 1-element arrays (NWB shape).
    return pd.DataFrame(
        {
            "start_time": [0.0, 10.0, 14.0],
            "stop_time": [10.0, 14.0, 20.0],
            "tags": [np.array(["wake"]), np.array(["NREM"]), np.array(["MA"])],
        }
    )


def test_brainstate_track_from_epochs_codes_and_names() -> None:
    da = brainstate_track_from_epochs(_epochs(), step_s=0.5)
    assert track_kind(da) == "categorical"
    assert da.dims == ("time",)
    names = da.attrs["state_names"].split(",")
    assert names[:3] == ["wake", "NREM", "MA"]
    # First grid point is wake (code 0), a point at t=12 is NREM (code 1).
    assert int(da.values[0]) == 0
    i12 = int(np.argmin(np.abs(np.asarray(da.coords["time"]) - 12.0)))
    assert names[int(da.values[i12])] == "NREM"


def test_brainstate_track_intervals_roundtrip() -> None:
    da = brainstate_track_from_epochs(_epochs(), step_s=0.25)
    ivs = track_intervals(da)
    states = [iv["state"] for iv in ivs]
    # Adjacent same-state grid points merge back to the 3 source epochs.
    assert states == ["wake", "NREM", "MA"]
    # Boundary near 10 s, accurate to within a grid step.
    wake_end = next(iv["end"] for iv in ivs if iv["state"] == "wake")
    assert abs(wake_end - 10.0) <= 0.3


def test_brainstate_track_gap_state() -> None:
    df = pd.DataFrame(
        {"start_time": [0.0, 12.0], "stop_time": [5.0, 16.0], "tags": ["wake", "NREM"]}
    )
    da = brainstate_track_from_epochs(df, step_s=0.5)
    names = da.attrs["state_names"].split(",")
    assert "none" in names  # the 5..12 s gap got a sentinel state


def test_scalar_track_from_series() -> None:
    da = scalar_track_from_series([0.0, 1.0, 2.0], [0.0, 0.5, 1.0], name="speed", units="cm/s")
    assert track_kind(da) == "scalar"
    assert da.attrs["units"] == "cm/s"
    assert da.name == "speed"
    with pytest.raises(ValueError):
        scalar_track_from_series([1.0, 2.0], [0.0], name="bad")


# --- decimation --------------------------------------------------------------

def test_track_series_passthrough_when_small() -> None:
    da = scalar_track_from_series([0.0, 5.0, 1.0], [0.0, 1.0, 2.0], name="speed")
    out = track_series(da, max_points=100)
    assert out["v"] == [0.0, 5.0, 1.0]
    assert out["n_total"] == 3


def test_track_series_minmax_preserves_extremes() -> None:
    t = np.linspace(0.0, 100.0, 5000)
    v = np.sin(t)
    v[1234] = 99.0   # global max spike
    v[4321] = -99.0  # global min spike
    da = scalar_track_from_series(v, t, name="speed")
    out = track_series(da, max_points=200)
    assert len(out["t"]) <= 200
    assert max(out["v"]) == pytest.approx(99.0)
    assert min(out["v"]) == pytest.approx(-99.0)
    assert out["n_total"] == 5000


def test_track_series_window_filter() -> None:
    t = np.arange(0.0, 100.0, 1.0)
    da = scalar_track_from_series(t.copy(), t, name="ramp")
    out = track_series(da, t0=20.0, t1=30.0, max_points=1000)
    assert min(out["t"]) >= 20.0 and max(out["t"]) <= 30.0


# --- endpoints + back-compat -------------------------------------------------

def _signal() -> xr.DataArray:
    return xr.DataArray(
        np.zeros((4, 2, 2)),
        dims=("time", "AP", "ML"),
        coords={"time": [0.0, 0.5, 1.0, 1.5], "AP": [0, 1], "ML": [0, 1]},
        name="lfp",
    )


def _client_with_tracks() -> TestClient:
    bs = brainstate_track_from_epochs(_epochs(), step_s=0.5)
    speed = scalar_track_from_series(
        np.linspace(0.0, 10.0, 500), np.linspace(0.0, 20.0, 500), name="speed", units="cm/s"
    )
    app = create_app(_signal(), tracks={"brainstate": bs, "speed": speed})
    return TestClient(app)


def test_list_tracks_endpoint() -> None:
    client = _client_with_tracks()
    rows = client.get("/api/v1/tracks").json()
    by_name = {r["name"]: r for r in rows}
    assert set(by_name) == {"brainstate", "speed"}
    assert by_name["brainstate"]["kind"] == "categorical"
    assert "wake" in by_name["brainstate"]["state_names"]
    assert by_name["speed"]["kind"] == "scalar"
    assert by_name["speed"]["units"] == "cm/s"


def test_track_intervals_endpoint_and_kind_guard() -> None:
    client = _client_with_tracks()
    ivs = client.get("/api/v1/tracks/brainstate/intervals").json()
    assert {iv["state"] for iv in ivs} == {"wake", "NREM", "MA"}
    # scalar track rejected on the intervals route
    assert client.get("/api/v1/tracks/speed/intervals").status_code == 400
    # unknown track
    assert client.get("/api/v1/tracks/nope/intervals").status_code == 404


def test_track_series_endpoint_and_kind_guard() -> None:
    client = _client_with_tracks()
    out = client.get("/api/v1/tracks/speed/series", params={"max_points": 50}).json()
    assert out["units"] == "cm/s"
    assert out["n_total"] == 500
    assert len(out["t"]) <= 50
    assert client.get("/api/v1/tracks/brainstate/series").status_code == 400


def test_brainstate_backcompat() -> None:
    # Passing brainstates= still works AND registers a "brainstate" track.
    bs = brainstate_track_from_epochs(_epochs(), step_s=0.5)
    app = create_app(_signal(), brainstates=bs)
    client = TestClient(app)
    assert client.get("/api/v1/brainstates").json()["available"] is True
    names = {r["name"] for r in client.get("/api/v1/tracks").json()}
    assert "brainstate" in names
