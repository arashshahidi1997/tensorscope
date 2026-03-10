"""Event stream endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Query

from tensorscope.server.models import ApiErrorDTO, EventRecordDTO, EventStreamMetaDTO
from tensorscope.server.routers.deps import SessionState, SessionStateDep
from tensorscope.server.state import event_stream_meta

router = APIRouter(prefix="/events", tags=["events"])


@router.get("", response_model=list[EventStreamMetaDTO], responses={400: {"model": ApiErrorDTO}})
def list_event_streams(session: SessionState = SessionStateDep) -> list[EventStreamMetaDTO]:
    _, state = session
    return [event_stream_meta(stream) for stream in state.iter_events()]


@router.get("/{name}", response_model=EventStreamMetaDTO, responses={404: {"model": ApiErrorDTO}})
def get_event_stream(name: str, session: SessionState = SessionStateDep) -> EventStreamMetaDTO:
    _, state = session
    stream = state.get_event_stream(name)
    if stream is None:
        raise KeyError(f"Event stream {name!r} not found")
    return event_stream_meta(stream)


@router.get(
    "/{name}/window",
    response_model=list[EventRecordDTO],
    responses={404: {"model": ApiErrorDTO}, 400: {"model": ApiErrorDTO}},
)
def get_event_window(
    name: str,
    t0: float = Query(..., ge=0.0),
    t1: float = Query(..., ge=0.0),
    ap: int | None = Query(default=None, ge=0),
    ml: int | None = Query(default=None, ge=0),
    channel: int | None = Query(default=None, ge=0),
    session: SessionState = SessionStateDep,
) -> list[EventRecordDTO]:
    _, state = session
    stream = state.get_event_stream(name)
    if stream is None:
        raise KeyError(f"Event stream {name!r} not found")

    frame = stream.get_events_in_window(t0, t1)
    if ap is not None and "AP" in frame.columns:
        frame = frame[frame["AP"] == ap]
    if ml is not None and "ML" in frame.columns:
        frame = frame[frame["ML"] == ml]
    if channel is not None and "channel" in frame.columns:
        frame = frame[frame["channel"] == channel]

    return [EventRecordDTO(record=row) for row in frame.to_dict(orient="records")]
