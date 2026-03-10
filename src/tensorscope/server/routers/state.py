"""State endpoint."""

from __future__ import annotations

from fastapi import APIRouter

from tensorscope.server.models import ApiErrorDTO, StateDTO
from tensorscope.server.routers.deps import SessionState, SessionStateDep

router = APIRouter(tags=["state"])


@router.get(
    "/state",
    response_model=StateDTO,
    responses={404: {"model": ApiErrorDTO}, 400: {"model": ApiErrorDTO}},
)
def get_state(session: SessionState = SessionStateDep) -> StateDTO:
    session_id, state = session
    return state.state_dto(session_id)
