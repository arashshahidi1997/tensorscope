"""Tests for the agent-pairing API (v1)."""

from __future__ import annotations

import asyncio

import numpy as np
import pandas as pd
import pytest
import xarray as xr
from fastapi.testclient import TestClient

from tensorscope.core.events import EventStream
from tensorscope.core.state import TensorNode, TensorRegistry
from tensorscope.pairing import PairContext
from tensorscope.pairing.wire import (
    b64_to_dataframe,
    dataarray_to_payload,
    dataframe_to_b64,
    payload_to_dataarray,
)
from tensorscope.server.app import create_app


def _grid() -> xr.DataArray:
    return xr.DataArray(
        np.arange(24, dtype=np.float32).reshape(4, 2, 3),
        dims=("time", "AP", "ML"),
        coords={"time": [0.0, 0.5, 1.0, 1.5], "AP": [0, 1], "ML": [0, 1, 2]},
        name="lfp",
    )


def _app(*, pair_mode: bool = False):
    return create_app(_grid(), pair_mode=pair_mode)


# ── unit: TensorRegistry mutation surface ─────────────────────────────────


def test_tensor_registry_replace_and_remove() -> None:
    reg = TensorRegistry()
    da = _grid()
    reg.add(TensorNode(name="x", data=da))
    assert "x" in reg

    new_da = da * 2
    reg.replace(TensorNode(name="x", data=new_da))  # overwrite
    assert reg.get("x").data.equals(new_da)

    reg.remove("x")
    assert "x" not in reg
    reg.remove("missing")  # idempotent


# ── unit: wire format roundtrip ───────────────────────────────────────────


def test_dataarray_payload_roundtrip() -> None:
    da = _grid().assign_attrs(units="uV", fs=1000.0)
    out = payload_to_dataarray(dataarray_to_payload(da))
    assert out.dims == da.dims
    assert out.shape == da.shape
    assert out.attrs["units"] == "uV"
    assert (out.values == da.values).all()
    assert (out.coords["time"].values == da.coords["time"].values).all()


def test_dataframe_payload_roundtrip() -> None:
    df = pd.DataFrame({"event_id": [1, 2], "t": [0.5, 1.25], "label": ["a", "b"]})
    out = b64_to_dataframe(dataframe_to_b64(df))
    pd.testing.assert_frame_equal(out, df)


# ── HTTP: tensor injection ────────────────────────────────────────────────


def test_post_tensor_registers_and_overwrites() -> None:
    client = TestClient(_app(pair_mode=True))
    da = xr.DataArray(np.zeros((3, 2)), dims=("time", "channel"),
                      coords={"time": [0.0, 1.0, 2.0], "channel": [0, 1]})
    body = {"name": "synthetic", "payload": dataarray_to_payload(da)}

    resp = client.post("/api/v1/tensors", json=body)
    assert resp.status_code == 200
    summary = resp.json()
    assert summary["name"] == "synthetic"
    assert summary["dims"] == ["time", "channel"]
    assert summary["shape"] == [3, 2]

    # GET shows it
    listed = client.get("/api/v1/tensors").json()
    assert any(t["name"] == "synthetic" for t in listed)

    # Re-POST overwrites without error
    da2 = xr.DataArray(np.ones((5, 4)), dims=("time", "channel"),
                       coords={"time": np.arange(5.0), "channel": np.arange(4)})
    body2 = {"name": "synthetic", "payload": dataarray_to_payload(da2)}
    resp2 = client.post("/api/v1/tensors", json=body2)
    assert resp2.status_code == 200
    assert resp2.json()["shape"] == [5, 4]


# ── HTTP: event injection ─────────────────────────────────────────────────


def test_post_event_stream_registers() -> None:
    client = TestClient(_app(pair_mode=True))
    df = pd.DataFrame({"event_id": [1, 2, 3], "t": [0.1, 0.5, 1.2], "ch": [0, 1, 0]})
    body = {"name": "candidates", "df_b64": dataframe_to_b64(df), "time_col": "t", "id_col": "event_id"}

    resp = client.post("/api/v1/events", json=body)
    assert resp.status_code == 200
    meta = resp.json()
    assert meta["name"] == "candidates"
    assert meta["n_events"] == 3
    assert "ch" in meta["columns"]

    streams = client.get("/api/v1/events").json()
    assert any(s["name"] == "candidates" for s in streams)


# ── pair-mode session sharing ─────────────────────────────────────────────


def test_pair_mode_shares_state_across_clients() -> None:
    app = _app(pair_mode=True)
    a = TestClient(app)
    b = TestClient(app)

    # Inject tensor through client A
    da = xr.DataArray(np.zeros((2, 2)), dims=("time", "channel"),
                      coords={"time": [0.0, 1.0], "channel": [0, 1]})
    a.post("/api/v1/tensors", json={"name": "shared", "payload": dataarray_to_payload(da)})

    # Client B sees it
    listed = b.get("/api/v1/tensors").json()
    assert any(t["name"] == "shared" for t in listed)

    # Selection mutation through A is visible to B
    a.put("/api/v1/selection", json={"time": 1.0, "freq": 0.0, "ap": 1, "ml": 2, "channel": None})
    assert b.get("/api/v1/selection").json()["time"] == 1.0


def test_default_mode_isolates_state_across_clients() -> None:
    """Regression guard — non-pair mode keeps per-cookie isolation."""
    app = _app(pair_mode=False)
    a = TestClient(app)
    b = TestClient(app)

    a.put("/api/v1/selection", json={"time": 1.0, "freq": 0.0, "ap": 0, "ml": 0, "channel": None})
    assert a.get("/api/v1/selection").json()["time"] == 1.0
    assert b.get("/api/v1/selection").json()["time"] == 0.0


# ── pub/sub bus ───────────────────────────────────────────────────────────


def test_publish_delivers_to_subscriber() -> None:
    """Verify the in-process bus delivers events to async subscribers from sync code."""
    from tensorscope.server.state import create_server_state

    state = create_server_state(_grid())

    async def _run():
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue = asyncio.Queue()
        sub = state.subscribe(queue, loop)
        try:
            # publish from the same thread (simulates a sync route handler in
            # threadpool — call_soon_threadsafe handles that case too).
            state.publish("selection_changed", {"time": 7.5})
            msg = await asyncio.wait_for(queue.get(), timeout=2.0)
            assert msg == {"type": "selection_changed", "payload": {"time": 7.5}}
        finally:
            state.unsubscribe(sub)

    asyncio.run(_run())


# ── PairContext end-to-end ────────────────────────────────────────────────


def test_pair_context_end_to_end() -> None:
    app = _app(pair_mode=True)
    client = TestClient(app)
    ctx = PairContext(client=client)

    # list/read
    assert any(t["name"] == "signal" for t in ctx.list_tensors())
    sel = ctx.read_selection()
    assert sel["time"] == 0.0

    # add tensor
    da = xr.DataArray(np.ones((3, 2)), dims=("time", "channel"),
                      coords={"time": [0.0, 1.0, 2.0], "channel": [0, 1]})
    ctx.add_tensor("synth", da)
    assert any(t["name"] == "synth" for t in ctx.list_tensors())

    # add events
    df = pd.DataFrame({"event_id": [1], "t": [0.5]})
    ctx.add_events("evs", df)
    assert any(s["name"] == "evs" for s in ctx.list_events())

    # set selection
    out = ctx.set_selection(time=1.5, ap=1)
    assert out["time"] == 1.5
    assert out["ap"] == 1


# ── EventStream input shape on add_events ─────────────────────────────────


def test_pair_context_accepts_event_stream() -> None:
    app = _app(pair_mode=True)
    ctx = PairContext(client=TestClient(app))

    stream = EventStream(
        name="ignored_use_post_name",
        df=pd.DataFrame({"event_id": [1, 2], "t": [0.1, 0.4]}),
    )
    out = ctx.add_events("from_stream", stream)
    assert out["name"] == "from_stream"
    assert out["n_events"] == 2


# ── SSE end-to-end via PUT /selection (publishes selection_changed) ──────


def test_selection_change_publishes_event() -> None:
    """An end-to-end check that the publish hook fires on PUT /selection.

    We can't easily consume the SSE stream synchronously from TestClient, so
    instead we attach a subscriber directly to the shared ServerState and then
    issue a PUT through the same app.
    """
    app = _app(pair_mode=True)
    client = TestClient(app)
    # Touch state once so the shared ServerState is materialised.
    client.get("/api/v1/state")
    state = app.state.session_manager._records["pair"].state  # type: ignore[attr-defined]

    async def _run():
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue = asyncio.Queue()
        sub = state.subscribe(queue, loop)
        try:
            client.put(
                "/api/v1/selection",
                json={"time": 2.5, "freq": 0.0, "ap": 0, "ml": 0, "channel": None},
            )
            msg = await asyncio.wait_for(queue.get(), timeout=2.0)
            assert msg["type"] == "selection_changed"
            assert msg["payload"]["time"] == 2.5
        finally:
            state.unsubscribe(sub)

    asyncio.run(_run())
