"""Brainstate interval endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

from tensorscope.server.models import ApiErrorDTO
from tensorscope.server.routers.deps import SessionState, SessionStateDep
from tensorscope.server.state import brainstate_intervals, brainstate_meta

router = APIRouter(prefix="/brainstates", tags=["brainstates"])


@router.get(
    "",
    response_model=dict[str, Any],
    responses={404: {"model": ApiErrorDTO}},
)
def get_brainstate_meta(
    session: SessionState = SessionStateDep,
) -> dict[str, Any]:
    """Return brainstate metadata (state names, time range, availability)."""
    _, state = session
    if state.brainstates is None:
        return {"available": False, "state_names": [], "time_range": [None, None], "n_steps": 0}
    return brainstate_meta(state.brainstates)


@router.get(
    "/intervals",
    response_model=list[dict[str, Any]],
    responses={404: {"model": ApiErrorDTO}},
)
def get_brainstate_intervals(
    t0: float | None = Query(default=None, ge=0.0),
    t1: float | None = Query(default=None, ge=0.0),
    session: SessionState = SessionStateDep,
) -> list[dict[str, Any]]:
    """Return brainstate intervals, optionally filtered to a time window."""
    _, state = session
    if state.brainstates is None:
        return []
    return brainstate_intervals(state.brainstates, t0, t1)
