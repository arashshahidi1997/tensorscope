"""Pipeline export/import API endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import PlainTextResponse

from tensorscope.server.models import (
    PipelineExportRequestDTO,
    PipelineExportResponseDTO,
    PipelineImportRequestDTO,
    PipelineImportResponseDTO,
    PipelineSpecDTO,
    WorkflowArtifactDTO,
)
from tensorscope.server.routers.deps import SessionState, SessionStateDep
from tensorscope.core.pipeline.selection import extract_pipeline, PipelineSelectionError
from tensorscope.core.pipeline.cooker import get_cooker
from tensorscope.core.pipeline.export import (
    export_yaml,
    export_json,
    import_json,
    import_yaml,
)
from tensorscope.core.pipeline.replay import replay_pipeline, PipelineReplayError


router = APIRouter(prefix="/pipeline", tags=["pipeline"])


def _build_spec(state, output_tensor_ids, name, cooker_profile, description):
    try:
        return extract_pipeline(
            dag=state._dag,
            output_tensor_ids=output_tensor_ids,
            name=name,
            cooker_profile=cooker_profile,
            description=description,
        )
    except PipelineSelectionError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


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
    spec = _build_spec(
        state, req.output_tensor_ids, req.name, req.cooker_profile, req.description,
    )

    spec_dto = PipelineSpecDTO(**spec.to_dict())

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


@router.post("/serialize", response_class=PlainTextResponse)
def serialize_pipeline(
    req: PipelineExportRequestDTO,
    fmt: str = Query("yaml", pattern="^(yaml|json)$"),
    session: SessionState = SessionStateDep,
) -> PlainTextResponse:
    """Serialise a pipeline directly to a downloadable text file.

    Same selection semantics as ``/export`` but returns the raw YAML/JSON
    document with a ``Content-Disposition: attachment`` header so the
    browser saves it as ``pipeline.yaml`` / ``pipeline.json``.
    """
    _sid, state = session
    spec = _build_spec(
        state, req.output_tensor_ids, req.name, req.cooker_profile, req.description,
    )

    if fmt == "yaml":
        body = export_yaml(spec)
        media_type = "application/yaml"
        filename = "pipeline.yaml"
    else:
        body = export_json(spec)
        media_type = "application/json"
        filename = "pipeline.json"

    return PlainTextResponse(
        content=body,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _detect_format(text: str) -> str:
    stripped = text.lstrip()
    if stripped.startswith("{") or stripped.startswith("["):
        return "json"
    return "yaml"


@router.post("/import", response_model=PipelineImportResponseDTO)
def import_pipeline(
    req: PipelineImportRequestDTO,
    session: SessionState = SessionStateDep,
) -> PipelineImportResponseDTO:
    """Parse a serialised pipeline and replay its transforms.

    Source tensors named in the spec must already be loaded in the
    workspace; the import does not load datasets. Transforms run in
    topological order; per-transform failures are reported in
    ``response.errors`` rather than aborting the whole replay.
    """
    _sid, state = session

    fmt = req.format if req.format != "auto" else _detect_format(req.content)
    try:
        if fmt == "json":
            spec = import_json(req.content)
        elif fmt == "yaml":
            spec = import_yaml(req.content)
        else:
            raise HTTPException(status_code=400, detail=f"unknown format {fmt!r}")
    except (ValueError, KeyError) as exc:
        raise HTTPException(status_code=400, detail=f"failed to parse pipeline: {exc}")

    try:
        result = replay_pipeline(
            spec, state._transform_executor, skip_existing=req.skip_existing,
        )
    except PipelineReplayError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return PipelineImportResponseDTO(
        spec=PipelineSpecDTO(**spec.to_dict()),
        executed=result.executed,
        skipped=result.skipped,
        errors=result.errors,
    )


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
