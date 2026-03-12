"""Tests for M6 pipeline export system."""

from __future__ import annotations

import json
import pytest

from tensorscope.core.transforms.dag import (
    DAGTensorNode,
    DAGTransformNode,
    TransformEdge,
    WorkspaceDAG,
)
from tensorscope.core.pipeline.spec import (
    PipelineSpec,
    PipelineSourceTensor,
    PipelineTransformNode,
    PipelineDerivedTensor,
    ExecutionMetadata,
)
from tensorscope.core.pipeline.selection import (
    extract_pipeline,
    PipelineSelectionError,
)
from tensorscope.core.pipeline.export import (
    export_json,
    import_json,
    export_pipeline,
)
from tensorscope.core.pipeline.cooker import (
    SnakemakeCooker,
    get_cooker,
)


# ── helpers ──────────────────────────────────────────────────────


def _make_linear_dag() -> WorkspaceDAG:
    """Build: raw → bandpass_tx → filtered → spec_tx → spectrogram."""
    dag = WorkspaceDAG()
    dag.add_tensor_node(DAGTensorNode(id="raw", tensor_id="raw", node_type="source"))
    dag.add_transform_node(DAGTransformNode(
        id="tx_bandpass_001",
        transform_name="bandpass",
        params={"lo_hz": 1.0, "hi_hz": 80.0},
        status="computed",
    ))
    dag.add_tensor_node(DAGTensorNode(
        id="filtered", tensor_id="filtered", node_type="derived",
    ))
    dag.add_transform_node(DAGTransformNode(
        id="tx_spectrogram_001",
        transform_name="spectrogram",
        params={"window_s": 0.5, "overlap": 0.5},
        status="computed",
    ))
    dag.add_tensor_node(DAGTensorNode(
        id="spectrogram", tensor_id="spectrogram", node_type="derived",
    ))

    dag.add_edge(TransformEdge(source_id="raw", target_id="tx_bandpass_001", edge_type="input"))
    dag.add_edge(TransformEdge(source_id="tx_bandpass_001", target_id="filtered", edge_type="output"))
    dag.add_edge(TransformEdge(source_id="filtered", target_id="tx_spectrogram_001", edge_type="input"))
    dag.add_edge(TransformEdge(source_id="tx_spectrogram_001", target_id="spectrogram", edge_type="output"))

    return dag


def _make_diamond_dag() -> WorkspaceDAG:
    """Build: raw → bp_tx → filtered, raw → psd_tx → psd_out."""
    dag = WorkspaceDAG()
    dag.add_tensor_node(DAGTensorNode(id="raw", tensor_id="raw", node_type="source"))

    dag.add_transform_node(DAGTransformNode(
        id="tx_bandpass_001", transform_name="bandpass",
        params={"lo_hz": 1.0, "hi_hz": 80.0}, status="computed",
    ))
    dag.add_tensor_node(DAGTensorNode(
        id="filtered", tensor_id="filtered", node_type="derived",
    ))
    dag.add_edge(TransformEdge(source_id="raw", target_id="tx_bandpass_001", edge_type="input"))
    dag.add_edge(TransformEdge(source_id="tx_bandpass_001", target_id="filtered", edge_type="output"))

    dag.add_transform_node(DAGTransformNode(
        id="tx_psd_001", transform_name="psd",
        params={"window_s": 1.0}, status="computed",
    ))
    dag.add_tensor_node(DAGTensorNode(
        id="psd_out", tensor_id="psd_out", node_type="derived",
    ))
    dag.add_edge(TransformEdge(source_id="raw", target_id="tx_psd_001", edge_type="input"))
    dag.add_edge(TransformEdge(source_id="tx_psd_001", target_id="psd_out", edge_type="output"))

    return dag


# ── PipelineSpec ─────────────────────────────────────────────────


class TestPipelineSpec:

    def test_round_trip(self) -> None:
        spec = PipelineSpec(
            name="test_pipeline",
            source_tensors=[PipelineSourceTensor(tensor_id="raw", data_ref="raw.nc")],
            transforms=[PipelineTransformNode(
                node_id="tx_1", transform_name="bandpass",
                params={"lo_hz": 1.0}, inputs=["raw"], output="filtered",
            )],
            derived_tensors=[PipelineDerivedTensor(tensor_id="filtered", dims=("time", "channel"), dtype="float64")],
            outputs=["filtered"],
            cooker_profile="snakemake",
        )
        d = spec.to_dict()
        restored = PipelineSpec.from_dict(d)
        assert restored.name == spec.name
        assert restored.version == spec.version
        assert len(restored.source_tensors) == 1
        assert restored.source_tensors[0].tensor_id == "raw"
        assert len(restored.transforms) == 1
        assert restored.transforms[0].transform_name == "bandpass"
        assert restored.outputs == ["filtered"]
        assert restored.cooker_profile == "snakemake"

    def test_default_id_generated(self) -> None:
        s1 = PipelineSpec()
        s2 = PipelineSpec()
        assert s1.id != s2.id
        assert len(s1.id) == 12


# ── Selection ────────────────────────────────────────────────────


class TestPipelineSelection:

    def test_linear_chain(self) -> None:
        dag = _make_linear_dag()
        spec = extract_pipeline(dag, ["spectrogram"], name="linear")
        assert spec.name == "linear"
        assert len(spec.source_tensors) == 1
        assert spec.source_tensors[0].tensor_id == "raw"
        assert len(spec.transforms) == 2
        assert len(spec.derived_tensors) == 2
        assert spec.outputs == ["spectrogram"]
        # Topo order: bandpass before spectrogram
        names = [t.transform_name for t in spec.transforms]
        assert names.index("bandpass") < names.index("spectrogram")

    def test_shared_ancestor(self) -> None:
        dag = _make_diamond_dag()
        spec = extract_pipeline(dag, ["filtered", "psd_out"])
        assert len(spec.source_tensors) == 1  # raw appears once
        assert spec.source_tensors[0].tensor_id == "raw"
        assert len(spec.transforms) == 2
        assert set(spec.outputs) == {"filtered", "psd_out"}

    def test_rejects_exploratory(self) -> None:
        dag = _make_linear_dag()
        dag.set_tensor_exploratory("filtered", True)
        with pytest.raises(PipelineSelectionError, match="exploratory"):
            extract_pipeline(dag, ["spectrogram"])

    def test_missing_node(self) -> None:
        dag = _make_linear_dag()
        with pytest.raises(PipelineSelectionError, match="not found"):
            extract_pipeline(dag, ["nonexistent"])

    def test_empty_outputs(self) -> None:
        dag = _make_linear_dag()
        with pytest.raises(PipelineSelectionError, match="No output"):
            extract_pipeline(dag, [])

    def test_source_only(self) -> None:
        """Selecting a source tensor produces a minimal spec."""
        dag = _make_linear_dag()
        spec = extract_pipeline(dag, ["raw"])
        assert len(spec.source_tensors) == 1
        assert len(spec.transforms) == 0
        assert len(spec.derived_tensors) == 0
        assert spec.outputs == ["raw"]


# ── Export ───────────────────────────────────────────────────────


class TestPipelineExport:

    def test_json_round_trip(self) -> None:
        dag = _make_linear_dag()
        spec = extract_pipeline(dag, ["spectrogram"], name="json_test")
        text = export_json(spec)
        data = json.loads(text)
        assert data["name"] == "json_test"
        restored = import_json(text)
        assert restored.name == "json_test"
        assert len(restored.transforms) == 2

    def test_export_pipeline_json(self) -> None:
        spec = PipelineSpec(name="fmt_test")
        text = export_pipeline(spec, fmt="json")
        assert '"name": "fmt_test"' in text

    def test_export_pipeline_yaml(self) -> None:
        spec = PipelineSpec(name="yaml_test")
        text = export_pipeline(spec, fmt="yaml")
        assert "yaml_test" in text


# ── Cooker ───────────────────────────────────────────────────────


class TestSnakemakeCooker:

    def test_cook_basic(self) -> None:
        dag = _make_linear_dag()
        spec = extract_pipeline(dag, ["spectrogram"], name="cook_test", cooker_profile="snakemake")
        cooker = SnakemakeCooker()
        artifacts = cooker.cook(spec)
        filenames = {a.filename for a in artifacts}
        assert "Snakefile" in filenames
        assert "config.yaml" in filenames

        snakefile = next(a for a in artifacts if a.filename == "Snakefile").content
        assert "rule all:" in snakefile
        assert "spectrogram.nc" in snakefile
        assert "tensorscope compute bandpass" in snakefile
        assert "tensorscope compute spectrogram" in snakefile

    def test_cook_config(self) -> None:
        dag = _make_linear_dag()
        spec = extract_pipeline(dag, ["spectrogram"], name="cfg_test")
        cooker = SnakemakeCooker()
        artifacts = cooker.cook(spec)
        config_text = next(a for a in artifacts if a.filename == "config.yaml").content
        assert "cfg_test" in config_text
        assert "raw" in config_text

    def test_get_cooker_snakemake(self) -> None:
        c = get_cooker("snakemake")
        assert isinstance(c, SnakemakeCooker)

    def test_get_cooker_unknown(self) -> None:
        with pytest.raises(ValueError, match="Unknown cooker"):
            get_cooker("airflow")
