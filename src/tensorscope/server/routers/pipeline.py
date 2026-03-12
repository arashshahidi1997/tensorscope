"""Pipeline export API endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from tensorscope.server.models import (
    PipelineExportRequestDTO,
    PipelineExportResponseDTO,
    PipelineSpecDTO,
    WorkflowArtifactDTO,
)
from tensorscope.server.routers.deps import SessionState, SessionStateDep
from tensorscope.server.state import ServerState
from tensorscope.core.pipeline.selection import extract_pipeline, PipelineSelectionError
from tensorscope.core.pipeline.cooker import get_cooker


router = APIRouter(prefix="/pipeline", tags=["pipeline"])


@router.post("/export", response_model=PipelineExportResponseDTO)
def export_pipeline(
    req: PipelineExportRequestDTO,
    session: SessionState = SessionStateDep,
) -> PipelineExportResponseDTO:
    """Export a pipeline from the workspace DAG.

    Selects the minimal subgraph for the given output tensors,
    builds a PipelineSpec, and optionally generates workflow artifacts.
    """
    _sid, state = session
    try:
        spec = extract_pipeline(
            dag=state._dag,
            output_tensor_ids=req.output_tensor_ids,
            name=req.name,
            cooker_profile=req.cooker_profile,
            description=req.description,
        )
    except PipelineSelectionError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    # Convert spec to DTO
    spec_dict = spec.to_dict()
    spec_dto = PipelineSpecDTO(**spec_dict)

    # Generate workflow artifacts if cooker specified
    artifacts: list[WorkflowArtifactDTO] = []
    if spec.cooker_profile:
        try:
            cooker = get_cooker(spec.cooker_profile)
            for art in cooker.cook(spec):
                artifacts.append(WorkflowArtifactDTO(
                    filename=art.filename,
                    content=art.content,
                ))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    return PipelineExportResponseDTO(spec=spec_dto, workflow_artifacts=artifacts)


@router.post("/promote/{tensor_node_id}")
def promote_tensor(
    tensor_node_id: str,
    session: SessionState = SessionStateDep,
) -> dict:
    """Promote a tensor node to pipeline-selected status."""
    _sid, state = session
    dag = state._dag
    if not dag.has_node(tensor_node_id):
        raise HTTPException(status_code=404, detail=f"Node '{tensor_node_id}' not found")
    if dag.get_node_type(tensor_node_id) != "tensor":
        raise HTTPException(status_code=400, detail=f"Node '{tensor_node_id}' is not a tensor node")

    tnode = dag.get_tensor_node(tensor_node_id)
    if tnode.exploratory:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot promote exploratory node '{tensor_node_id}'. Mark as curated first.",
        )

    dag.set_tensor_pipeline_selected(tensor_node_id, True)
    return {"status": "promoted", "tensor_node_id": tensor_node_id}


@router.post("/demote/{tensor_node_id}")
def demote_tensor(
    tensor_node_id: str,
    session: SessionState = SessionStateDep,
) -> dict:
    """Remove pipeline-selected status from a tensor node."""
    _sid, state = session
    dag = state._dag
    if not dag.has_node(tensor_node_id):
        raise HTTPException(status_code=404, detail=f"Node '{tensor_node_id}' not found")
    if dag.get_node_type(tensor_node_id) != "tensor":
        raise HTTPException(status_code=400, detail=f"Node '{tensor_node_id}' is not a tensor node")

    dag.set_tensor_pipeline_selected(tensor_node_id, False)
    return {"status": "demoted", "tensor_node_id": tensor_node_id}
