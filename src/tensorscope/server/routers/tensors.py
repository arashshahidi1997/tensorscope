"""Tensor metadata and slice endpoints."""

from __future__ import annotations

from fastapi import APIRouter

from tensorscope.core.state import TensorNode
from tensorscope.pairing.wire import payload_to_dataarray
from tensorscope.server.models import (
    ApiErrorDTO,
    TensorMetaDTO,
    TensorPostDTO,
    TensorSliceDTO,
    TensorSliceRequestDTO,
    TensorSummaryDTO,
)
from tensorscope.server.routers.deps import SessionState, SessionStateDep
from tensorscope.server.state import tensor_summary

router = APIRouter(prefix="/tensors", tags=["tensors"])


@router.get("", response_model=list[TensorSummaryDTO], responses={404: {"model": ApiErrorDTO}})
def list_tensors(session: SessionState = SessionStateDep) -> list[TensorSummaryDTO]:
    _, state = session
    return [state.tensor_meta(node.name) for node in state.iter_nodes()]


@router.post("", response_model=TensorSummaryDTO, responses={400: {"model": ApiErrorDTO}})
def post_tensor(body: TensorPostDTO, session: SessionState = SessionStateDep) -> TensorSummaryDTO:
    """Register or replace a tensor by name. Used by the agent-pairing API."""
    _, state = session
    da = payload_to_dataarray(body.payload)
    node = TensorNode(
        name=body.name,
        data=da,
        source=body.source,
        transform=body.transform,
        params=dict(body.params),
    )
    state.app_state.tensors.replace(node)
    summary = tensor_summary(node)
    state.publish("tensor_added", summary.model_dump())
    return summary


@router.get("/{name}", response_model=TensorMetaDTO, responses={404: {"model": ApiErrorDTO}})
def get_tensor(name: str, session: SessionState = SessionStateDep) -> TensorMetaDTO:
    _, state = session
    return state.tensor_meta(name)


@router.post(
    "/{name}/slice",
    response_model=TensorSliceDTO,
    responses={404: {"model": ApiErrorDTO}, 400: {"model": ApiErrorDTO}},
)
def get_tensor_slice(
    name: str,
    request: TensorSliceRequestDTO,
    session: SessionState = SessionStateDep,
) -> TensorSliceDTO:
    _, state = session
    return state.tensor_slice(name, request)
