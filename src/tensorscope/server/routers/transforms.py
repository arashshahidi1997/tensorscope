"""Transform registry and execution endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from tensorscope.server.models import (
    DerivedTensorDTO,
    TransformDefinitionDTO,
    TransformParamSpecDTO,
    TransformProvenanceDTO,
    TransformRequestDTO,
)
from tensorscope.server.routers.deps import get_server_state
from tensorscope.server.state import ServerState

router = APIRouter(prefix="/transforms", tags=["transforms"])


@router.get("", response_model=list[TransformDefinitionDTO])
async def list_transforms(
    state: ServerState = Depends(get_server_state),
) -> list[TransformDefinitionDTO]:
    """List all registered transforms."""
    return [
        TransformDefinitionDTO(
            name=defn.name,
            description=defn.description,
            required_dims=list(defn.input_spec.required_dims),
            param_schema={
                name: TransformParamSpecDTO(
                    dtype=spec.dtype,
                    default=spec.default,
                    description=spec.description,
                    min_value=spec.min_value,
                    max_value=spec.max_value,
                    choices=list(spec.choices) if spec.choices else None,
                )
                for name, spec in defn.param_schema.items()
            },
            output_dims=list(defn.output_spec.dims),
            output_dtype=defn.output_spec.dtype,
        )
        for defn in state.transform_registry.list_definitions()
    ]


@router.get("/{name}", response_model=TransformDefinitionDTO)
async def get_transform(
    name: str,
    state: ServerState = Depends(get_server_state),
) -> TransformDefinitionDTO:
    """Get a specific transform definition."""
    defn = state.transform_registry.get(name)
    return TransformDefinitionDTO(
        name=defn.name,
        description=defn.description,
        required_dims=list(defn.input_spec.required_dims),
        param_schema={
            pname: TransformParamSpecDTO(
                dtype=spec.dtype,
                default=spec.default,
                description=spec.description,
                min_value=spec.min_value,
                max_value=spec.max_value,
                choices=list(spec.choices) if spec.choices else None,
            )
            for pname, spec in defn.param_schema.items()
        },
        output_dims=list(defn.output_spec.dims),
        output_dtype=defn.output_spec.dtype,
    )


@router.get("/compatible/{tensor_name}", response_model=list[TransformDefinitionDTO])
async def list_compatible_transforms(
    tensor_name: str,
    state: ServerState = Depends(get_server_state),
) -> list[TransformDefinitionDTO]:
    """List transforms compatible with a given tensor."""
    node = state.get_node(tensor_name)
    compatible = state.transform_registry.list_compatible(node)
    return [
        TransformDefinitionDTO(
            name=defn.name,
            description=defn.description,
            required_dims=list(defn.input_spec.required_dims),
            param_schema={
                pname: TransformParamSpecDTO(
                    dtype=spec.dtype,
                    default=spec.default,
                    description=spec.description,
                    min_value=spec.min_value,
                    max_value=spec.max_value,
                    choices=list(spec.choices) if spec.choices else None,
                )
                for pname, spec in defn.param_schema.items()
            },
            output_dims=list(defn.output_spec.dims),
            output_dtype=defn.output_spec.dtype,
        )
        for defn in compatible
    ]


@router.post("/execute", response_model=DerivedTensorDTO)
async def execute_transform(
    request: TransformRequestDTO,
    state: ServerState = Depends(get_server_state),
) -> DerivedTensorDTO:
    """Execute a transform and return the derived tensor metadata."""
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
