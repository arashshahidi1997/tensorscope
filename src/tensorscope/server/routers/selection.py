"""Selection endpoints."""

from __future__ import annotations

from fastapi import APIRouter

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
    session: SessionState = SessionStateDep,
) -> SelectionDTO:
    _, state = session
    return state.update_selection(selection)
