"""Transform registry and execution endpoints."""

from __future__ import annotations

from fastapi import APIRouter

from tensorscope.core.transforms.registry import ParamSpec, TransformDefinition
from tensorscope.server.models import (
    DerivedTensorDTO,
    TransformDefinitionDTO,
    TransformParamSpecDTO,
    TransformProvenanceDTO,
    TransformRequestDTO,
)
from tensorscope.server.routers.deps import SessionState, SessionStateDep

router = APIRouter(prefix="/transforms", tags=["transforms"])


def _param_spec_to_dto(spec: ParamSpec) -> TransformParamSpecDTO:
    return TransformParamSpecDTO(
        dtype=spec.dtype,
        default=None if spec.is_required else spec.default,
        required=spec.is_required,
        description=spec.description,
        min_value=spec.min_value,
        max_value=spec.max_value,
        choices=list(spec.choices) if spec.choices else None,
    )


def _defn_to_dto(defn: TransformDefinition) -> TransformDefinitionDTO:
    return TransformDefinitionDTO(
        name=defn.name,
        description=defn.description,
        required_dims=list(defn.input_spec.required_dims),
        param_schema={
            pname: _param_spec_to_dto(spec)
            for pname, spec in defn.param_schema.items()
        },
        output_dims=list(defn.output_spec.dims),
        output_dtype=defn.output_spec.dtype,
    )


@router.get("", response_model=list[TransformDefinitionDTO])
async def list_transforms(
    session: SessionState = SessionStateDep,
) -> list[TransformDefinitionDTO]:
    """List all registered transforms."""
    _sid, state = session
    return [_defn_to_dto(defn) for defn in state.transform_registry.list_definitions()]


@router.get("/{name}", response_model=TransformDefinitionDTO)
async def get_transform(
    name: str,
    session: SessionState = SessionStateDep,
) -> TransformDefinitionDTO:
    """Get a specific transform definition."""
    _sid, state = session
    defn = state.transform_registry.get(name)
    return _defn_to_dto(defn)


@router.get("/compatible/{tensor_name}", response_model=list[TransformDefinitionDTO])
async def list_compatible_transforms(
    tensor_name: str,
    session: SessionState = SessionStateDep,
) -> list[TransformDefinitionDTO]:
    """List transforms compatible with a given tensor."""
    _sid, state = session
    node = state.get_node(tensor_name)
    compatible = state.transform_registry.list_compatible(node)
    return [_defn_to_dto(defn) for defn in compatible]


@router.post("/execute", response_model=DerivedTensorDTO)
async def execute_transform(
    request: TransformRequestDTO,
    session: SessionState = SessionStateDep,
) -> DerivedTensorDTO:
    """Execute a transform and return the derived tensor metadata."""
    _sid, state = session
    derived = state.execute_transform(
        transform_name=request.transform_name,
        input_names=request.input_names,
        params=request.params,
        tensor_id=request.tensor_id,
    )
    return DerivedTensorDTO(
        id=derived.id,
        provenance=TransformProvenanceDTO(
            transform_name=derived.provenance.transform_name,
            params=derived.provenance.params,
            parent_ids=list(derived.provenance.parent_ids),
        ),
        dims=list(derived.dims),
        shape=list(derived.shape),
        dtype=derived.dtype,
        status=derived.status,
        cache_key=derived.cache_key,
        error=derived.error,
    )
