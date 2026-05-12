"""Contract v2 tensor slice endpoint.

Sibling of the v1 router in ``tensors.py``. Same handler chain (selection →
processing cache → :func:`apply_slice_request`); only the encoder differs.
The response body is **raw Arrow IPC bytes** (no base64, no JSON wrapper) per
§3.1 of ``docs/design/contract-v2.md``.

This file is intentionally minimal — all the v2-specific logic lives in
:func:`tensorscope.server.state.encode_arrow_v2` and
:meth:`tensorscope.server.state.ServerState.tensor_slice_v2_bytes`. Keeping
the endpoint thin makes it cheap to add ``/slices`` (multi-view fan-out) in
Phase 1.5 without touching the encoder.
"""

from __future__ import annotations

from fastapi import APIRouter, Response

from tensorscope.server.models import ApiErrorDTO, TensorSliceRequestDTO
from tensorscope.server.routers.deps import SessionState, SessionStateDep

router = APIRouter(prefix="/tensors", tags=["tensors-v2"])

#: Wire MIME type for the v2 contract — matches Apache Arrow's official
#: stream-format media type so non-browser clients (Python, R) can detect it.
ARROW_STREAM_MEDIA_TYPE = "application/vnd.apache.arrow.stream"


@router.post(
    "/{name}/slice",
    responses={
        200: {
            "content": {ARROW_STREAM_MEDIA_TYPE: {}},
            "description": "Arrow IPC stream containing one labeled record batch",
        },
        404: {"model": ApiErrorDTO},
        400: {"model": ApiErrorDTO},
    },
)
def get_tensor_slice_v2(
    name: str,
    request: TensorSliceRequestDTO,
    session: SessionState = SessionStateDep,
) -> Response:
    """Return a v2 slice payload as raw Arrow IPC bytes.

    The response is a single record batch with:
      * ``data`` — ``FixedSizeList<float32, prod(shape)>`` row-major
      * ``coords/<dim>`` — one ``FixedSizeList`` per dim
      * Schema metadata under ``tensorscope`` keying a JSON blob with
        ``version``, ``dims``, ``shape``, ``dtype``, ``units``, ``attrs``,
        ``display_transforms``, ``processing``, ``slice_provenance``.

    Decoders should read the metadata first to learn the dim ordering, then
    reshape the ``data`` typed array by ``shape``.
    """
    _, state = session
    payload = state.tensor_slice_v2_bytes(name, request)
    return Response(content=payload, media_type=ARROW_STREAM_MEDIA_TYPE)
