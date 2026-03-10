"""Tensor metadata and slice endpoints."""

from __future__ import annotations

from fastapi import APIRouter

from tensorscope.server.models import ApiErrorDTO, TensorMetaDTO, TensorSliceDTO, TensorSliceRequestDTO, TensorSummaryDTO
from tensorscope.server.routers.deps import SessionState, SessionStateDep

router = APIRouter(prefix="/tensors", tags=["tensors"])


@router.get("", response_model=list[TensorSummaryDTO], responses={404: {"model": ApiErrorDTO}})
def list_tensors(session: SessionState = SessionStateDep) -> list[TensorSummaryDTO]:
    _, state = session
    return [state.tensor_meta(node.name) for node in state.iter_nodes()]


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
