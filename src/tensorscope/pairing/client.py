"""Synchronous HTTP client for the agent-pairing API."""

from __future__ import annotations

from typing import Any

import httpx
import pandas as pd
import xarray as xr

from tensorscope.core.events.model import EventStream
from tensorscope.pairing.wire import dataarray_to_payload, dataframe_to_b64

DEFAULT_HOST = "http://127.0.0.1:8000"


class PairContext:
    """Thin wrapper over the tensorscope HTTP API for paired-agent workflows.

    Use against a server launched with ``tensorscope serve --pair`` so that
    the agent's mutations are visible in the browser session.
    """

    def __init__(
        self,
        host: str = DEFAULT_HOST,
        *,
        timeout: float = 30.0,
        client: httpx.Client | None = None,
    ):
        if client is not None:
            self._client = client
            self._owns_client = False
        else:
            self._client = httpx.Client(base_url=host.rstrip("/"), timeout=timeout)
            self._owns_client = True

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def __enter__(self) -> "PairContext":
        return self

    def __exit__(self, *_exc: Any) -> None:
        self.close()

    # ── reads ────────────────────────────────────────────────────────────
    def list_tensors(self) -> list[dict[str, Any]]:
        resp = self._client.get("/api/v1/tensors")
        resp.raise_for_status()
        return resp.json()

    def list_events(self) -> list[dict[str, Any]]:
        resp = self._client.get("/api/v1/events")
        resp.raise_for_status()
        return resp.json()

    def read_selection(self) -> dict[str, Any]:
        resp = self._client.get("/api/v1/selection")
        resp.raise_for_status()
        return resp.json()

    def read_viewport(self) -> dict[str, Any]:
        resp = self._client.get("/api/v1/viewport")
        resp.raise_for_status()
        return resp.json()

    # ── mutations ────────────────────────────────────────────────────────
    def add_tensor(
        self,
        name: str,
        data: xr.DataArray,
        *,
        source: str | None = None,
        transform: str = "signal",
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        body = {
            "name": name,
            "payload": dataarray_to_payload(data),
            "source": source,
            "transform": transform,
            "params": params or {},
        }
        resp = self._client.post("/api/v1/tensors", json=body)
        resp.raise_for_status()
        return resp.json()

    def add_events(
        self,
        name: str,
        events: pd.DataFrame | EventStream,
        *,
        time_col: str = "t",
        id_col: str = "event_id",
        style: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if isinstance(events, EventStream):
            df = events.df
            time_col = events.time_col
            id_col = events.id_col
        else:
            df = events
        body = {
            "name": name,
            "df_b64": dataframe_to_b64(df),
            "time_col": time_col,
            "id_col": id_col,
            "style": style,
        }
        resp = self._client.post("/api/v1/events", json=body)
        resp.raise_for_status()
        return resp.json()

    def set_selection(
        self,
        *,
        time: float | None = None,
        freq: float | None = None,
        ap: int | None = None,
        ml: int | None = None,
        channel: int | None = None,
        follow_with_window_s: float | None = None,
    ) -> dict[str, Any]:
        """Mutate the cursor selection.

        Parameters
        ----------
        follow_with_window_s
            When set, the server also updates the viewport to a window of this
            width centered on the new ``time``. The browser settle order is
            ``selection_changed`` first, then ``viewport_changed`` — matching
            the SSE contract documented in
            ``docs/log/issue/issue-arash-20260508-142724-956601.md``.
        """
        current = self.read_selection()
        for key, value in (
            ("time", time), ("freq", freq), ("ap", ap), ("ml", ml), ("channel", channel),
        ):
            if value is not None:
                current[key] = value
        params: dict[str, Any] | None = None
        if follow_with_window_s is not None:
            params = {"follow_with_window_s": float(follow_with_window_s)}
        resp = self._client.put("/api/v1/selection", json=current, params=params)
        resp.raise_for_status()
        return resp.json()

    def set_viewport(
        self,
        *,
        t_lo: float | None = None,
        t_hi: float | None = None,
        t_center: float | None = None,
        t_window: float | None = None,
    ) -> dict[str, Any]:
        """Pan / frame the visible time window.

        Supply either ``(t_lo, t_hi)`` directly or ``(t_center, t_window)``
        for the centered convenience form (``t_lo = t_center - t_window/2``,
        ``t_hi = t_center + t_window/2``). Publishes ``viewport_changed``
        on the SSE bus on success.
        """
        body: dict[str, Any] = {}
        if t_lo is not None:
            body["t_lo"] = float(t_lo)
        if t_hi is not None:
            body["t_hi"] = float(t_hi)
        if t_center is not None:
            body["t_center"] = float(t_center)
        if t_window is not None:
            body["t_window"] = float(t_window)
        resp = self._client.put("/api/v1/viewport", json=body)
        resp.raise_for_status()
        return resp.json()


def get_context(host: str = DEFAULT_HOST, *, timeout: float = 30.0) -> PairContext:
    """Open a paired session against a running ``tensorscope serve --pair``."""
    return PairContext(host, timeout=timeout)
