"""Event stream endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Query

from tensorscope.core.events.detectors import get_detector, list_detectors
from tensorscope.core.events.model import EventStream
from tensorscope.server.models import (
    ApiErrorDTO,
    DetectorDefinitionDTO,
    DetectorParamSpecDTO,
    DetectRequestDTO,
    DetectResultDTO,
    EventRecordDTO,
    EventStreamMetaDTO,
)
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


@router.get("/detectors", response_model=list[DetectorDefinitionDTO])
def list_event_detectors() -> list[DetectorDefinitionDTO]:
    """List all registered event detectors."""
    return [
        DetectorDefinitionDTO(
            name=d.name,
            description=d.description,
            param_schema={
                k: DetectorParamSpecDTO(
                    dtype=v.dtype,
                    default=v.default,
                    description=v.description,
                    min_value=v.min_value,
                    max_value=v.max_value,
                    choices=v.choices,
                )
                for k, v in d.param_schema.items()
            },
        )
        for d in list_detectors()
    ]


@router.post("/detect", response_model=DetectResultDTO, responses={400: {"model": ApiErrorDTO}, 404: {"model": ApiErrorDTO}})
def run_detector(body: DetectRequestDTO, session: SessionState = SessionStateDep) -> DetectResultDTO:
    """Run an event detector on a tensor and register the resulting event stream."""
    _, state = session

    detector = get_detector(body.detector_name)
    if detector is None:
        raise KeyError(f"Detector {body.detector_name!r} not found")

    # Get the tensor data
    node = state.get_node(body.tensor_name)
    data = node.data

    # Run detection
    stream = detector.detect(data, body.params)

    # Override stream name if requested
    if body.stream_name:
        stream = EventStream(
            name=body.stream_name,
            df=stream.df,
            time_col=stream.time_col,
            id_col=stream.id_col,
            style=stream.style,
        )

    # Register in event registry
    state.events.register(stream)

    return DetectResultDTO(
        stream_name=stream.name,
        n_events=len(stream),
        detector_name=body.detector_name,
    )
