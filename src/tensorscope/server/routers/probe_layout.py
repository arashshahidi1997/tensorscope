"""Probe-layout sidecar endpoint (G7)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from tensorscope.server.models import ApiErrorDTO, ProbeLayoutDTO
from tensorscope.server.routers.deps import SessionState, SessionStateDep

router = APIRouter(prefix="/probe_layout", tags=["probe_layout"])


@router.get("", response_model=ProbeLayoutDTO, responses={404: {"model": ApiErrorDTO}})
def get_probe_layout(session: SessionState = SessionStateDep) -> ProbeLayoutDTO:
    """Return the loaded probe layout, or 404 when no sidecar was supplied."""
    _, state = session
    dto = state.probe_layout_dto()
    if dto is None:
        raise HTTPException(
            status_code=404,
            detail="no probe layout sidecar loaded for this session",
        )
    return dto
