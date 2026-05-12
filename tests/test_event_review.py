"""Tests for the G9 event-review decision export router."""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import xarray as xr
from fastapi.testclient import TestClient

from tensorscope.core.events import EventRegistry, EventStream
from tensorscope.server.app import create_app


def _grid_data() -> xr.DataArray:
    return xr.DataArray(
        [
            [[0.0, 1.0, 2.0], [3.0, 4.0, 5.0]],
            [[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]],
        ],
        dims=("time", "AP", "ML"),
        coords={"time": [0.0, 0.5], "AP": [0, 1], "ML": [0, 1, 2]},
        name="lfp",
    )


def _registry() -> EventRegistry:
    reg = EventRegistry()
    reg.register(
        EventStream(
            "ripples",
            pd.DataFrame(
                {"event_id": [1, 2, 3], "t": [0.1, 0.2, 0.3]},
            ),
        )
    )
    return reg


def _client(tmp_path: Path) -> TestClient:
    app = create_app(
        _grid_data(),
        events_registry=_registry(),
        dataset_dir=tmp_path,
    )
    return TestClient(app)


def test_post_then_get_round_trips_full_payload(tmp_path: Path) -> None:
    client = _client(tmp_path)
    payload = {
        "decisions": [
            {
                "event_id": 1,
                "status": "accepted",
                "decided_at": 1715000000000,
                "notes": "clean ripple",
                "tags": ["high-snr", "AP=0"],
            },
            {
                "event_id": 2,
                "status": "rejected",
                "decided_at": 1715000000500,
                "notes": None,
                "tags": [],
            },
            {
                "event_id": 3,
                "status": "maybe",
                "decided_at": 1715000001000,
                "tags": ["double-event"],
            },
        ]
    }
    post = client.post("/api/v1/events/ripples/decisions", json=payload)
    assert post.status_code == 200, post.text
    body = post.json()
    assert body["stream"] == "ripples"
    assert body["n_decisions"] == 3
    assert body["format"] in ("parquet", "csv")
    assert Path(body["path"]).exists()
    assert Path(body["path"]).parent == tmp_path / "review"
    assert Path(body["path"]).name.startswith("ripples__decisions")

    get = client.get("/api/v1/events/ripples/decisions")
    assert get.status_code == 200, get.text
    g = get.json()
    assert g["stream"] == "ripples"
    assert g["saved_at"] is not None
    assert g["path"] == body["path"]
    # Order is preserved by the writer.
    statuses = [(d["event_id"], d["status"]) for d in g["decisions"]]
    assert statuses == [("1", "accepted"), ("2", "rejected"), ("3", "maybe")] or \
           statuses == [(1, "accepted"), (2, "rejected"), (3, "maybe")]
    decisions = g["decisions"]
    # Notes / tags round-trip without corruption.
    assert decisions[0]["notes"] == "clean ripple"
    assert decisions[0]["tags"] == ["high-snr", "AP=0"]
    assert decisions[1]["notes"] is None
    assert decisions[1]["tags"] == []
    assert decisions[2]["tags"] == ["double-event"]


def test_get_returns_empty_when_no_file_exists(tmp_path: Path) -> None:
    client = _client(tmp_path)
    res = client.get("/api/v1/events/ripples/decisions")
    assert res.status_code == 200
    body = res.json()
    assert body["decisions"] == []
    assert body["saved_at"] is None
    assert body["path"] is None


def test_post_overwrites_existing(tmp_path: Path) -> None:
    client = _client(tmp_path)
    client.post(
        "/api/v1/events/ripples/decisions",
        json={"decisions": [
            {"event_id": 1, "status": "accepted", "decided_at": 1, "tags": []},
            {"event_id": 2, "status": "rejected", "decided_at": 2, "tags": []},
        ]},
    )
    # Second write — fewer decisions, different statuses.
    client.post(
        "/api/v1/events/ripples/decisions",
        json={"decisions": [
            {"event_id": 1, "status": "maybe", "decided_at": 999, "tags": ["edited"]},
        ]},
    )
    body = client.get("/api/v1/events/ripples/decisions").json()
    assert len(body["decisions"]) == 1
    assert body["decisions"][0]["status"] == "maybe"
    assert body["decisions"][0]["tags"] == ["edited"]


def test_post_creates_review_subdir(tmp_path: Path) -> None:
    client = _client(tmp_path)
    assert not (tmp_path / "review").exists()
    client.post(
        "/api/v1/events/ripples/decisions",
        json={"decisions": []},
    )
    assert (tmp_path / "review").is_dir()


def test_post_returns_404_for_missing_stream(tmp_path: Path) -> None:
    client = _client(tmp_path)
    res = client.post(
        "/api/v1/events/no_such_stream/decisions",
        json={"decisions": []},
    )
    assert res.status_code == 404


def test_post_returns_403_without_dataset_dir() -> None:
    """No dataset_dir means no place to write — surface a 403, not a 500."""
    app = create_app(_grid_data(), events_registry=_registry())  # dataset_dir=None
    client = TestClient(app)
    res = client.post(
        "/api/v1/events/ripples/decisions",
        json={"decisions": [
            {"event_id": 1, "status": "accepted", "decided_at": 0, "tags": []},
        ]},
    )
    assert res.status_code == 403
    assert "dataset directory" in res.json()["detail"].lower() or \
           "dataset directory" in res.text.lower()


def test_get_returns_empty_without_dataset_dir() -> None:
    """GET is informational — empty rather than 403 keeps the frontend simple."""
    app = create_app(_grid_data(), events_registry=_registry())
    client = TestClient(app)
    res = client.get("/api/v1/events/ripples/decisions")
    assert res.status_code == 200
    body = res.json()
    assert body["decisions"] == []
    assert body["saved_at"] is None


def test_atomic_write_does_not_corrupt_existing(tmp_path: Path, monkeypatch) -> None:
    """Simulate a failure mid-write — the existing decisions file survives."""
    client = _client(tmp_path)
    # Seed disk with a known-good file.
    client.post(
        "/api/v1/events/ripples/decisions",
        json={"decisions": [
            {"event_id": 1, "status": "accepted", "decided_at": 42, "tags": ["v1"]},
        ]},
    )
    target = tmp_path / "review" / "ripples__decisions.parquet"
    assert target.exists()
    original_bytes = target.read_bytes()

    # Force the next write to blow up after writing the .tmp but before
    # the atomic replace. The good file must remain untouched.
    def boom(*_args, **_kwargs) -> None:
        raise OSError("simulated crash during rename")

    monkeypatch.setattr(
        "tensorscope.server.routers.event_review.os.replace", boom,
    )
    try:
        res = client.post(
            "/api/v1/events/ripples/decisions",
            json={"decisions": [
                {"event_id": 99, "status": "rejected", "decided_at": 99, "tags": []},
            ]},
        )
        # If the framework caught it, expect 500 — the test focuses on
        # *disk* state, not the HTTP code.
        assert res.status_code in (200, 500)
    except OSError:
        # TestClient may re-raise the OSError (raise_server_exceptions=True).
        pass

    # The original file is byte-identical to before the failed write.
    assert target.exists()
    assert target.read_bytes() == original_bytes


def test_stream_name_with_path_separator_is_rejected(tmp_path: Path) -> None:
    """A stream name like ``../etc/passwd`` must not escape the review dir."""
    client = _client(tmp_path)
    # Stream doesn't exist — we get a 404 before path-sanitisation matters,
    # but the file safety guarantee still must hold for any name. Register
    # a stream with a benign name and then try to address it with `/`.
    res = client.post(
        "/api/v1/events/..%2Fescape/decisions",
        json={"decisions": []},
    )
    # The forbidden output is "no parquet anywhere outside review/". The
    # exact code is FastAPI's routing decision — 405 happens because the
    # decoded path `../escape/decisions` no longer matches the
    # `{stream_name}/decisions` segment, before any handler runs. 400/404
    # apply when the handler does run with a sanitised name. All three
    # block the write, which is the actual guarantee under test.
    assert res.status_code in (400, 404, 405)
    # And no rogue files leaked into the dataset dir's parent.
    assert not any(p.suffix == ".parquet" for p in tmp_path.parent.iterdir() if p.is_file())
