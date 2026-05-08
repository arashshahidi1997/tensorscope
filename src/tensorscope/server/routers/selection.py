"""Selection endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Query

from tensorscope.server.models import ApiErrorDTO, SelectionDTO
from tensorscope.server.routers.deps import SessionState, SessionStateDep

router = APIRouter(prefix="/selection", tags=["selection"])


@router.get("", response_model=SelectionDTO, responses={400: {"model": ApiErrorDTO}})
def get_selection(session: SessionState = SessionStateDep) -> SelectionDTO:
    _, state = session
    return SelectionDTO.from_selection(state.app_state.selection)


@router.put("", response_model=SelectionDTO, responses={400: {"model": ApiErrorDTO}})
def update_selection(
    selection: SelectionDTO,
    follow_with_window_s: float | None = Query(
        default=None,
        gt=0.0,
        description=(
            "Convenience: when set, also update the viewport to a window of this "
            "width centered on `selection.time`. Publishes `selection_changed` "
            "first, then `viewport_changed`, so SSE consumers settle in a "
            "predictable order."
        ),
    ),
    session: SessionState = SessionStateDep,
) -> SelectionDTO:
    _, state = session
    updated = state.update_selection(selection)
    state.publish("selection_changed", updated.model_dump())

    if follow_with_window_s is not None:
        half = float(follow_with_window_s) / 2.0
        t_lo = max(0.0, float(updated.time) - half)
        t_hi = float(updated.time) + half
        viewport = state.update_viewport(t_lo, t_hi)
        # Publish AFTER selection_changed so the frontend processes cursor
        # movement before re-centering the visible window — matches the order
        # specified in the v1.x design note. mode="json" keeps in-process
        # subscribers and the SSE wire on the same payload shape.
        state.publish("viewport_changed", viewport.model_dump(mode="json"))

    return updated
