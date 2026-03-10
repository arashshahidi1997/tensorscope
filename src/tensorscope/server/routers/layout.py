"""Layout endpoints."""

from __future__ import annotations

from fastapi import APIRouter

from tensorscope.server.models import ApiErrorDTO, LayoutDTO, LayoutUpdateDTO
from tensorscope.server.routers.deps import SessionState, SessionStateDep

router = APIRouter(prefix="/layout", tags=["layout"])


@router.get("", response_model=LayoutDTO, responses={400: {"model": ApiErrorDTO}})
def get_layout(session: SessionState = SessionStateDep) -> LayoutDTO:
    _, state = session
    return state.layout_dto()


@router.put("", response_model=LayoutDTO, responses={400: {"model": ApiErrorDTO}})
def update_layout(
    request: LayoutUpdateDTO,
    session: SessionState = SessionStateDep,
) -> LayoutDTO:
    _, state = session
    return state.set_layout_preset(request.preset)
