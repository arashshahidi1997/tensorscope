"""Tensor metadata and slice endpoints."""

from __future__ import annotations

from fastapi import APIRouter

from tensorscope.core.state import TensorNode
from tensorscope.pairing.wire import payload_to_dataarray
from tensorscope.server.models import (
    ApiErrorDTO,
    ElectrodeLayoutDTO,
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


@router.get(
    "/{name}/electrodes",
    response_model=ElectrodeLayoutDTO,
    responses={404: {"model": ApiErrorDTO}, 400: {"model": ApiErrorDTO}},
)
def get_tensor_electrodes(
    name: str, session: SessionState = SessionStateDep
) -> ElectrodeLayoutDTO:
    """Electrode geometry for a spatial tensor.

    ``geometry`` is ``"grid"`` (dense AP×ML), ``"linear"`` (depth strip), or
    ``"planar"`` (arbitrary 2-D positions in ``x_coords``/``y_coords``). The
    scatter spatial view consumes the planar positions; the grid/linear views
    use ap/ml_coords. KeyError→404 (no tensor), ValueError→400 (no geometry).
    """
    _, state = session
    return state.electrode_layout(name)


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
