"""Workspace DAG inspection and navigation endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from tensorscope.server.models import (
    DAGNodeVisibilityDTO,
    DAGTensorNodeDTO,
    DAGTransformNodeDTO,
    ProvenanceStepDTO,
    TransformEdgeDTO,
    WorkspaceDAGDTO,
)
from tensorscope.server.routers.deps import get_server_state
from tensorscope.server.state import ServerState

router = APIRouter(prefix="/dag", tags=["dag"])


def _tensor_node_dto(node) -> DAGTensorNodeDTO:
    return DAGTensorNodeDTO(
        id=node.id,
        tensor_id=node.tensor_id,
        node_type=node.node_type,
        visible=node.visible,
        exploratory=node.exploratory,
        pipeline_selected=node.pipeline_selected,
        display_name=node.display_name,
    )


def _transform_node_dto(node) -> DAGTransformNodeDTO:
    return DAGTransformNodeDTO(
        id=node.id,
        transform_name=node.transform_name,
        params=node.params,
        status=node.status,
        error=node.error,
    )


@router.get("", response_model=WorkspaceDAGDTO)
async def get_dag(
    state: ServerState = Depends(get_server_state),
) -> WorkspaceDAGDTO:
    """Return the full workspace DAG."""
    dag = state.dag
    return WorkspaceDAGDTO(
        tensor_nodes=[_tensor_node_dto(n) for n in dag.list_tensor_nodes()],
        transform_nodes=[_transform_node_dto(n) for n in dag.list_transform_nodes()],
        edges=[
            TransformEdgeDTO(
                source_id=e.source_id,
                target_id=e.target_id,
                edge_type=e.edge_type,
            )
            for e in dag.list_edges()
        ],
    )


@router.get("/tensors/{node_id}", response_model=DAGTensorNodeDTO)
async def get_tensor_node(
    node_id: str,
    state: ServerState = Depends(get_server_state),
) -> DAGTensorNodeDTO:
    """Get a specific tensor node."""
    node = state.dag.get_tensor_node(node_id)
    return _tensor_node_dto(node)


@router.get("/transforms/{node_id}", response_model=DAGTransformNodeDTO)
async def get_transform_node(
    node_id: str,
    state: ServerState = Depends(get_server_state),
) -> DAGTransformNodeDTO:
    """Get a specific transform node."""
    node = state.dag.get_transform_node(node_id)
    return _transform_node_dto(node)


@router.put("/tensors/{node_id}/visibility", response_model=DAGTensorNodeDTO)
async def update_tensor_visibility(
    node_id: str,
    body: DAGNodeVisibilityDTO,
    state: ServerState = Depends(get_server_state),
) -> DAGTensorNodeDTO:
    """Update visibility or exploratory state of a tensor node."""
    dag = state.dag
    if body.visible is not None:
        dag.set_tensor_visible(node_id, body.visible)
    if body.exploratory is not None:
        dag.set_tensor_exploratory(node_id, body.exploratory)
    node = dag.get_tensor_node(node_id)
    return _tensor_node_dto(node)


@router.get("/upstream/{node_id}", response_model=list[DAGTransformNodeDTO])
async def get_upstream(
    node_id: str,
    state: ServerState = Depends(get_server_state),
) -> list[DAGTransformNodeDTO]:
    """Get all upstream transform nodes (recursive)."""
    transforms = state.dag.get_upstream(node_id)
    return [_transform_node_dto(n) for n in transforms]


@router.get("/downstream/{node_id}", response_model=list[DAGTensorNodeDTO | DAGTransformNodeDTO])
async def get_downstream(
    node_id: str,
    state: ServerState = Depends(get_server_state),
) -> list[dict]:
    """Get all downstream nodes (recursive)."""
    from tensorscope.core.transforms.dag import DAGTensorNode
    nodes = state.dag.get_downstream(node_id)
    result = []
    for n in nodes:
        if isinstance(n, DAGTensorNode):
            result.append(_tensor_node_dto(n).model_dump())
        else:
            result.append(_transform_node_dto(n).model_dump())
    return result


@router.get("/provenance/{tensor_node_id}", response_model=list[ProvenanceStepDTO])
async def get_provenance_chain(
    tensor_node_id: str,
    state: ServerState = Depends(get_server_state),
) -> list[ProvenanceStepDTO]:
    """Get the full provenance chain from root to the given tensor."""
    chain = state.dag.get_provenance_chain(tensor_node_id)
    return [
        ProvenanceStepDTO(
            input_tensor_id=step.input_tensor_id,
            transform_name=step.transform_name,
            params=step.params,
            output_tensor_id=step.output_tensor_id,
        )
        for step in chain
    ]
