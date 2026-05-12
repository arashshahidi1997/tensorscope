"""Channel-mask endpoints.

A *channel mask* is a per-tensor list of flat channel ids excluded from
view reductions. For grid (AP, ML) tensors the id is ``ap_idx * n_ml +
ml_idx``; for (channel,) tensors it's the channel index. The mask is
honoured by ``apply_slice_request`` — masked cells become NaN before the
view-specific reductions / FFTs run, so spatial means and per-freq
baselines automatically skip them.

The masks are workflow state (which channels are bad), not data state, so
they live in ``ServerState`` and don't persist across server restarts.
"""

from __future__ import annotations

from fastapi import APIRouter

from tensorscope.server.models import ApiErrorDTO, MaskStateDTO, MaskUpdateDTO
from tensorscope.server.routers.deps import SessionState, SessionStateDep

router = APIRouter(prefix="/masks", tags=["masks"])


@router.get(
    "/{tensor}",
    response_model=MaskStateDTO,
    responses={404: {"model": ApiErrorDTO}},
)
def get_mask(tensor: str, session: SessionState = SessionStateDep) -> MaskStateDTO:
    _, state = session
    state.get_node(tensor)  # 404 if missing
    return MaskStateDTO(tensor=tensor, masked_ids=state.channel_mask_for(tensor))


@router.put(
    "/{tensor}",
    response_model=MaskStateDTO,
    responses={400: {"model": ApiErrorDTO}, 404: {"model": ApiErrorDTO}},
)
def update_mask(
    tensor: str,
    body: MaskUpdateDTO,
    session: SessionState = SessionStateDep,
) -> MaskStateDTO:
    _, state = session
    updated = state.set_channel_mask(tensor, body.masked_ids)
    dto = MaskStateDTO(tensor=tensor, masked_ids=updated)
    state.publish("mask_changed", dto.model_dump(mode="json"))
    return dto
