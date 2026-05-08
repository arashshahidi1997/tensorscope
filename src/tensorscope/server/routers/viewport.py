"""Viewport (visible-window) endpoints.

Decoupled from the cursor-style ``SelectionDTO`` so an agent can pan / frame
the visible time range independently of where the cursor sits. See
``docs/log/issue/issue-arash-20260508-142724-956601.md`` for the design.
"""

from __future__ import annotations

from fastapi import APIRouter

from tensorscope.server.models import ApiErrorDTO, ViewportDTO, ViewportUpdateDTO
from tensorscope.server.routers.deps import SessionState, SessionStateDep

router = APIRouter(prefix="/viewport", tags=["viewport"])


@router.get("", response_model=ViewportDTO, responses={400: {"model": ApiErrorDTO}})
def get_viewport(session: SessionState = SessionStateDep) -> ViewportDTO:
    _, state = session
    return ViewportDTO.from_viewport(state.app_state.viewport)


@router.put("", response_model=ViewportDTO, responses={400: {"model": ApiErrorDTO}})
def update_viewport(
    body: ViewportUpdateDTO,
    session: SessionState = SessionStateDep,
) -> ViewportDTO:
    _, state = session
    t_lo, t_hi = body.resolve()
    updated = state.update_viewport(t_lo, t_hi)
    state.publish("viewport_changed", updated.model_dump())
    return updated
