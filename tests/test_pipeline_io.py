"""Tests for pipeline replay + serialise/import HTTP endpoints."""

from __future__ import annotations

import numpy as np
import xarray as xr
from fastapi.testclient import TestClient

from tensorscope.core.events import EventRegistry
from tensorscope.core.pipeline.export import export_yaml, import_yaml
from tensorscope.core.pipeline.replay import (
    PipelineReplayError,
    replay_pipeline,
)
from tensorscope.core.pipeline.selection import extract_pipeline
from tensorscope.core.pipeline.spec import (
    ExecutionMetadata,
    PipelineSourceTensor,
    PipelineSpec,
    PipelineTransformNode,
)
from tensorscope.core.state import TensorNode, TensorRegistry, TensorScopeState
from tensorscope.core.transforms.builtins import register_builtins
from tensorscope.core.transforms.dag import (
    DAGTensorNode,
    DAGTransformNode,
    TransformEdge,
    WorkspaceDAG,
)
from tensorscope.core.transforms.executor import TransformExecutor
from tensorscope.core.transforms.registry import TransformRegistry
from tensorscope.server.app import create_app


# ── Fixtures / helpers ────────────────────────────────────────────────


def _grid_data(name: str = "raw") -> xr.DataArray:
    rng = np.random.default_rng(0)
    n_time = 256
    t = np.linspace(0.0, 1.0, n_time)  # fs ≈ 256 Hz
    arr = rng.standard_normal((n_time, 2, 3))
    return xr.DataArray(
        arr,
        dims=("time", "AP", "ML"),
        coords={"time": t, "AP": [0, 1], "ML": [0, 1, 2]},
        name=name,
    )


def _make_executor(data: xr.DataArray) -> tuple[TransformExecutor, WorkspaceDAG, TensorRegistry]:
    registry = TensorRegistry()
    registry.add(TensorNode(name=data.name, data=data))
    transforms = TransformRegistry()
    register_builtins(transforms)
    dag = WorkspaceDAG()
    dag.add_tensor_node(DAGTensorNode(
        id=data.name, tensor_id=data.name, node_type="source",
    ))
    executor = TransformExecutor(transforms, registry, dag=dag)
    return executor, dag, registry


def _client() -> TestClient:
    app = create_app(_grid_data(), events_registry=EventRegistry())
    return TestClient(app)


# ── replay_pipeline ────────────────────────────────────────────────────


def test_replay_executes_transforms_in_order() -> None:
    executor, _dag, registry = _make_executor(_grid_data())

    spec = PipelineSpec(
        name="test",
        source_tensors=[PipelineSourceTensor(tensor_id="raw")],
        transforms=[
            PipelineTransformNode(
                node_id="tx_bandpass_001",
                transform_name="bandpass",
                params={"lo_hz": 1.0, "hi_hz": 80.0, "order": 4},
                inputs=["raw"],
                output="filtered_v1",
            ),
        ],
        outputs=["filtered_v1"],
        execution_metadata=ExecutionMetadata(),
    )

    result = replay_pipeline(spec, executor)

    assert result.executed == ["filtered_v1"]
    assert result.skipped == []
    assert result.errors == {}
    assert "filtered_v1" in registry


def test_replay_chains_transforms() -> None:
    executor, _dag, registry = _make_executor(_grid_data())

    spec = PipelineSpec(
        source_tensors=[PipelineSourceTensor(tensor_id="raw")],
        transforms=[
            PipelineTransformNode(
                node_id="tx_a", transform_name="bandpass",
                params={"lo_hz": 1.0, "hi_hz": 80.0, "order": 4},
                inputs=["raw"], output="filtered_v1",
            ),
            PipelineTransformNode(
                node_id="tx_b", transform_name="psd",
                params={"window_s": 0.5, "overlap": 0.5},
                inputs=["filtered_v1"], output="psd_v1",
            ),
        ],
        outputs=["psd_v1"],
    )

    result = replay_pipeline(spec, executor)

    assert result.executed == ["filtered_v1", "psd_v1"]
    assert "psd_v1" in registry


def test_replay_missing_source_raises() -> None:
    executor, _dag, _registry = _make_executor(_grid_data())

    spec = PipelineSpec(
        source_tensors=[PipelineSourceTensor(tensor_id="not_there")],
        transforms=[],
        outputs=[],
    )

    try:
        replay_pipeline(spec, executor)
    except PipelineReplayError as exc:
        assert "not_there" in str(exc)
    else:
        raise AssertionError("expected PipelineReplayError")


def test_replay_skips_existing_outputs() -> None:
    executor, _dag, registry = _make_executor(_grid_data())
    # Pre-populate the output tensor.
    registry.add(TensorNode(
        name="filtered_v1", data=_grid_data("filtered_v1"),
    ))

    spec = PipelineSpec(
        source_tensors=[PipelineSourceTensor(tensor_id="raw")],
        transforms=[
            PipelineTransformNode(
                node_id="tx_a", transform_name="bandpass",
                params={"lo_hz": 1.0, "hi_hz": 80.0, "order": 4},
                inputs=["raw"], output="filtered_v1",
            ),
        ],
        outputs=["filtered_v1"],
    )

    result = replay_pipeline(spec, executor)

    assert result.skipped == ["filtered_v1"]
    assert result.executed == []


def test_replay_captures_per_transform_errors() -> None:
    executor, _dag, _registry = _make_executor(_grid_data())

    spec = PipelineSpec(
        source_tensors=[PipelineSourceTensor(tensor_id="raw")],
        transforms=[
            PipelineTransformNode(
                node_id="tx_bad", transform_name="bandpass",
                # Missing required params (lo_hz/hi_hz) → executor raises.
                params={},
                inputs=["raw"], output="filtered_v1",
            ),
        ],
        outputs=["filtered_v1"],
    )

    result = replay_pipeline(spec, executor)

    assert result.executed == []
    assert "filtered_v1" in result.errors


# ── round-trip via extract → yaml → import → replay ────────────────────


def test_extract_yaml_roundtrip_replay() -> None:
    executor, dag, registry = _make_executor(_grid_data())

    # Run a transform so the DAG has something to extract.
    derived = executor.execute(
        "bandpass", ["raw"],
        {"lo_hz": 1.0, "hi_hz": 80.0, "order": 4},
        tensor_id="filtered_v1",
    )
    assert derived.status == "computed"

    spec = extract_pipeline(dag=dag, output_tensor_ids=["filtered_v1"], name="rt")
    yaml_text = export_yaml(spec)
    reparsed = import_yaml(yaml_text)

    # Fresh workspace with only the source tensor.
    executor2, _dag2, registry2 = _make_executor(_grid_data())
    result = replay_pipeline(reparsed, executor2)

    assert "filtered_v1" in registry2
    assert result.errors == {}
    assert result.executed == ["filtered_v1"]


# ── HTTP endpoints ────────────────────────────────────────────────────


def test_serialize_returns_yaml_attachment() -> None:
    client = _client()
    # Run a transform via the HTTP API so it's recorded in the session DAG.
    r = client.post("/api/v1/transforms/execute", json={
        "transform_name": "bandpass",
        "input_names": ["signal"],
        "params": {"lo_hz": 1.0, "hi_hz": 80.0, "order": 4},
        "tensor_id": "filtered_v1",
    })
    assert r.status_code == 200, r.text

    r = client.post(
        "/api/v1/pipeline/serialize?fmt=yaml",
        json={"output_tensor_ids": ["filtered_v1"], "name": "rt"},
    )
    assert r.status_code == 200, r.text
    assert r.headers["content-disposition"].startswith("attachment")
    assert "pipeline.yaml" in r.headers["content-disposition"]
    assert "transforms:" in r.text
    # body must round-trip through the YAML parser
    spec = import_yaml(r.text)
    assert spec.outputs == ["filtered_v1"]


def test_serialize_json_format() -> None:
    client = _client()
    client.post("/api/v1/transforms/execute", json={
        "transform_name": "bandpass",
        "input_names": ["signal"],
        "params": {"lo_hz": 1.0, "hi_hz": 80.0, "order": 4},
        "tensor_id": "filtered_v1",
    })
    r = client.post(
        "/api/v1/pipeline/serialize?fmt=json",
        json={"output_tensor_ids": ["filtered_v1"]},
    )
    assert r.status_code == 200
    assert "pipeline.json" in r.headers["content-disposition"]
    body = r.json()
    assert body["outputs"] == ["filtered_v1"]


def test_import_replays_pipeline() -> None:
    # Source session: build + serialise.
    src = _client()
    src.post("/api/v1/transforms/execute", json={
        "transform_name": "bandpass",
        "input_names": ["signal"],
        "params": {"lo_hz": 1.0, "hi_hz": 80.0, "order": 4},
        "tensor_id": "filtered_v1",
    })
    serialised = src.post(
        "/api/v1/pipeline/serialize?fmt=yaml",
        json={"output_tensor_ids": ["filtered_v1"]},
    ).text

    # Fresh session: import.
    dst = _client()
    r = dst.post("/api/v1/pipeline/import", json={
        "content": serialised,
        "format": "yaml",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["executed"] == ["filtered_v1"]
    assert body["errors"] == {}

    # The replayed tensor should be queryable.
    meta = dst.get("/api/v1/tensors/filtered_v1").json()
    assert meta["name"] == "filtered_v1"


def test_import_rejects_missing_source() -> None:
    dst = _client()
    spec = PipelineSpec(
        source_tensors=[PipelineSourceTensor(tensor_id="not_present")],
        transforms=[],
        outputs=[],
    )
    r = dst.post("/api/v1/pipeline/import", json={
        "content": export_yaml(spec),
        "format": "yaml",
    })
    assert r.status_code == 400
    assert "not_present" in r.json()["detail"]


def test_import_format_auto_detect() -> None:
    src = _client()
    src.post("/api/v1/transforms/execute", json={
        "transform_name": "bandpass",
        "input_names": ["signal"],
        "params": {"lo_hz": 1.0, "hi_hz": 80.0, "order": 4},
        "tensor_id": "filtered_v1",
    })
    body = src.post(
        "/api/v1/pipeline/serialize?fmt=json",
        json={"output_tensor_ids": ["filtered_v1"]},
    ).text

    dst = _client()
    r = dst.post("/api/v1/pipeline/import", json={
        "content": body,
        # no explicit format → auto
    })
    assert r.status_code == 200, r.text
    assert r.json()["executed"] == ["filtered_v1"]
