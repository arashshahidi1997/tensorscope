"""FastAPI app factory for TensorScope."""

from __future__ import annotations

from typing import Any

import pandas as pd
import xarray as xr
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from tensorscope.core.events import EventRegistry, EventStream
from tensorscope.server.models import ApiErrorDTO
from tensorscope.server.routers import brainstates as brainstates_router_mod
from tensorscope.server.routers import dag, events, layout, pipeline, processing, selection, state, tensors, transforms
from tensorscope.server.session import SESSION_COOKIE_NAME, SessionManager
from tensorscope.server.state import ServerState, create_server_state


def create_app(
    data: xr.DataArray,
    *,
    tensor_name: str = "signal",
    events_registry: EventRegistry | None = None,
    brainstates: xr.DataArray | None = None,
    title: str = "TensorScope API",
) -> FastAPI:
    """Create a Phase 2 FastAPI app bound to a single dataset."""
    base_state = create_server_state(data, tensor_name=tensor_name, events=events_registry, brainstates=brainstates)
    app = FastAPI(title=title, version="0.2.0")
    app.state.session_manager = SessionManager(base_state)

    register_error_handlers(app)

    app.include_router(state.router, prefix="/api/v1")
    app.include_router(tensors.router, prefix="/api/v1")
    app.include_router(selection.router, prefix="/api/v1")
    app.include_router(layout.router, prefix="/api/v1")
    app.include_router(events.router, prefix="/api/v1")
    app.include_router(processing.router, prefix="/api/v1")
    app.include_router(transforms.router, prefix="/api/v1")
    app.include_router(dag.router, prefix="/api/v1")
    app.include_router(pipeline.router, prefix="/api/v1")
    app.include_router(brainstates_router_mod.router, prefix="/api/v1")
    return app


def register_error_handlers(app: FastAPI) -> None:
    """Install structured error handlers."""

    @app.exception_handler(KeyError)
    async def handle_key_error(_: Request, exc: KeyError) -> JSONResponse:
        payload = ApiErrorDTO(code="not_found", message=str(exc), details=None)
        return JSONResponse(status_code=404, content=payload.model_dump())

    @app.exception_handler(ValueError)
    async def handle_value_error(_: Request, exc: ValueError) -> JSONResponse:
        payload = ApiErrorDTO(code="invalid_request", message=str(exc), details=None)
        return JSONResponse(status_code=400, content=payload.model_dump())


def demo_app() -> FastAPI:
    """Convenience app for local manual testing."""
    coords = {"time": [0.0, 0.5, 1.0, 1.5], "AP": [0, 1], "ML": [0, 1, 2]}
    data = xr.DataArray(
        [[[0.0, 1.0, 2.0], [3.0, 4.0, 5.0]], [[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]], [[2.0, 3.0, 4.0], [5.0, 6.0, 7.0]], [[3.0, 4.0, 5.0], [6.0, 7.0, 8.0]]],
        dims=("time", "AP", "ML"),
        coords=coords,
        name="lfp",
    )
    registry = EventRegistry()
    registry.register(
        EventStream(
            "demo_events",
            pd.DataFrame({"event_id": [1, 2], "t": [0.5, 1.25], "label": ["a", "b"]}),
        )
    )
    return create_app(data, events_registry=registry)
