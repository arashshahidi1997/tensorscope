"""Context-track endpoints (categorical bands + scalar traces).

Generalizes the brainstate strip into N auxiliary, time-aligned tracks. A
categorical track (e.g. brainstate, sleep stage) yields merged intervals; a
scalar track (e.g. speed) yields a window-filtered, decimated series. See
``tensorscope.io.tracks`` and ``server.state`` track helpers.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from tensorscope.server.models import ApiErrorDTO, ScalarSeriesDTO, TrackMetaDTO
from tensorscope.server.routers.deps import SessionState, SessionStateDep
from tensorscope.server.state import (
    list_track_meta,
    track_intervals,
    track_kind,
    track_series,
)

router = APIRouter(prefix="/tracks", tags=["tracks"])


@router.get("", response_model=list[TrackMetaDTO])
def list_tracks(session: SessionState = SessionStateDep) -> list[dict[str, Any]]:
    """List metadata for every context track on the session."""
    _, state = session
    return list_track_meta(state)


@router.get(
    "/{name}/intervals",
    response_model=list[dict[str, Any]],
    responses={404: {"model": ApiErrorDTO}, 400: {"model": ApiErrorDTO}},
)
def get_track_intervals(
    name: str,
    t0: float | None = Query(default=None, ge=0.0),
    t1: float | None = Query(default=None, ge=0.0),
    session: SessionState = SessionStateDep,
) -> list[dict[str, Any]]:
    """Categorical track → merged ``{start,end,state}`` intervals."""
    _, state = session
    da = state.tracks.get(name)
    if da is None:
        raise HTTPException(status_code=404, detail=f"track {name!r} not found")
    if track_kind(da) != "categorical":
        raise HTTPException(status_code=400, detail=f"track {name!r} is not categorical")
    return track_intervals(da, t0, t1)


@router.get(
    "/{name}/series",
    response_model=ScalarSeriesDTO,
    responses={404: {"model": ApiErrorDTO}, 400: {"model": ApiErrorDTO}},
)
def get_track_series(
    name: str,
    t0: float | None = Query(default=None, ge=0.0),
    t1: float | None = Query(default=None, ge=0.0),
    max_points: int = Query(default=2000, ge=2, le=20000),
    session: SessionState = SessionStateDep,
) -> dict[str, Any]:
    """Scalar track → window-filtered, min/max-decimated series."""
    _, state = session
    da = state.tracks.get(name)
    if da is None:
        raise HTTPException(status_code=404, detail=f"track {name!r} not found")
    if track_kind(da) != "scalar":
        raise HTTPException(status_code=400, detail=f"track {name!r} is not scalar")
    return track_series(da, t0, t1, max_points)
