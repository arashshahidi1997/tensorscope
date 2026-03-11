"""Processing pipeline endpoints."""

from __future__ import annotations

from fastapi import APIRouter

from tensorscope.server.models import ProcessingParamsDTO
from tensorscope.server.routers.deps import SessionState, SessionStateDep

router = APIRouter(prefix="/processing", tags=["processing"])


@router.get("", response_model=ProcessingParamsDTO)
def get_processing(session: SessionState = SessionStateDep) -> ProcessingParamsDTO:
    """Return current processing parameters for this session."""
    _, state = session
    return state.get_processing()


@router.put("", response_model=ProcessingParamsDTO)
def set_processing(
    params: ProcessingParamsDTO,
    session: SessionState = SessionStateDep,
) -> ProcessingParamsDTO:
    """Update processing parameters for this session."""
    _, state = session
    return state.set_processing(params)
