"""Tests for M5 workspace DAG model, lineage queries, and executor integration."""

from __future__ import annotations

import numpy as np
import pytest
import xarray as xr

from tensorscope.core.state import TensorNode, TensorRegistry
from tensorscope.core.transforms.builtins import register_builtins
from tensorscope.core.transforms.cache import TransformCache
from tensorscope.core.transforms.dag import (
    DAGTensorNode,
    DAGTransformNode,
    ProvenanceStep,
    TransformEdge,
    WorkspaceDAG,
)
from tensorscope.core.transforms.executor import TransformExecutor
from tensorscope.core.transforms.registry import TransformRegistry


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _make_grid_tensor(name: str = "signal", n_time: int = 200) -> TensorNode:
    rng = np.random.default_rng(42)
    fs = 100.0
    time = np.arange(n_time) / fs
    data = xr.DataArray(
        rng.standard_normal((n_time, 2, 3)),
        dims=("time", "AP", "ML"),
        coords={"time": time, "AP": [0, 1], "ML": [0, 1, 2]},
        attrs={"fs": fs},
    )
    return TensorNode(name=name, data=data)


def _build_simple_dag() -> WorkspaceDAG:
    """Build a simple DAG: source → transform → derived."""
    dag = WorkspaceDAG()
    dag.add_tensor_node(DAGTensorNode(id="raw", tensor_id="raw", node_type="source"))
    dag.add_transform_node(DAGTransformNode(
        id="tx_bp", transform_name="bandpass",
        params={"lo_hz": 1.0, "hi_hz": 40.0}, status="computed",
    ))
    dag.add_tensor_node(DAGTensorNode(
        id="bp_raw", tensor_id="bp_raw", node_type="derived",
    ))
    dag.add_edge(TransformEdge(source_id="raw", target_id="tx_bp", edge_type="input"))
    dag.add_edge(TransformEdge(source_id="tx_bp", target_id="bp_raw", edge_type="output"))
    return dag


def _build_chain_dag() -> WorkspaceDAG:
    """Build a chain DAG: raw → bandpass → bp_raw → psd → psd_bp."""
    dag = _build_simple_dag()
    dag.add_transform_node(DAGTransformNode(
        id="tx_psd", transform_name="psd",
        params={"window_s": 0.5}, status="computed",
    ))
    dag.add_tensor_node(DAGTensorNode(
        id="psd_bp", tensor_id="psd_bp", node_type="derived",
    ))
    dag.add_edge(TransformEdge(source_id="bp_raw", target_id="tx_psd", edge_type="input"))
    dag.add_edge(TransformEdge(source_id="tx_psd", target_id="psd_bp", edge_type="output"))
    return dag


# ---------------------------------------------------------------------------
# DAG Node operations
# ---------------------------------------------------------------------------

class TestDAGNodes:
    def test_add_tensor_node(self):
        dag = WorkspaceDAG()
        node = DAGTensorNode(id="sig", tensor_id="sig", node_type="source")
        dag.add_tensor_node(node)
        assert dag.has_node("sig")
        assert dag.get_node_type("sig") == "tensor"
        assert dag.n_tensor_nodes == 1

    def test_add_transform_node(self):
        dag = WorkspaceDAG()
        node = DAGTransformNode(id="tx1", transform_name="bandpass")
        dag.add_transform_node(node)
        assert dag.has_node("tx1")
        assert dag.get_node_type("tx1") == "transform"
        assert dag.n_transform_nodes == 1

    def test_duplicate_node_raises(self):
        dag = WorkspaceDAG()
        dag.add_tensor_node(DAGTensorNode(id="x", tensor_id="x"))
        with pytest.raises(ValueError, match="already exists"):
            dag.add_tensor_node(DAGTensorNode(id="x", tensor_id="x2"))

    def test_get_missing_node_raises(self):
        dag = WorkspaceDAG()
        with pytest.raises(KeyError):
            dag.get_tensor_node("missing")
        with pytest.raises(KeyError):
            dag.get_transform_node("missing")
        with pytest.raises(KeyError):
            dag.get_node_type("missing")


# ---------------------------------------------------------------------------
# Edges
# ---------------------------------------------------------------------------

class TestDAGEdges:
    def test_add_edge(self):
        dag = WorkspaceDAG()
        dag.add_tensor_node(DAGTensorNode(id="a", tensor_id="a"))
        dag.add_transform_node(DAGTransformNode(id="tx", transform_name="test"))
        dag.add_edge(TransformEdge(source_id="a", target_id="tx", edge_type="input"))
        assert dag.n_edges == 1

    def test_edge_missing_node_raises(self):
        dag = WorkspaceDAG()
        dag.add_tensor_node(DAGTensorNode(id="a", tensor_id="a"))
        with pytest.raises(KeyError):
            dag.add_edge(TransformEdge(source_id="a", target_id="missing", edge_type="input"))

    def test_cycle_detection(self):
        dag = WorkspaceDAG()
        dag.add_tensor_node(DAGTensorNode(id="a", tensor_id="a"))
        dag.add_transform_node(DAGTransformNode(id="tx", transform_name="test"))
        dag.add_tensor_node(DAGTensorNode(id="b", tensor_id="b"))
        dag.add_edge(TransformEdge(source_id="a", target_id="tx", edge_type="input"))
        dag.add_edge(TransformEdge(source_id="tx", target_id="b", edge_type="output"))
        # Adding b → tx would create a cycle.
        dag.add_transform_node(DAGTransformNode(id="tx2", transform_name="test2"))
        dag.add_edge(TransformEdge(source_id="b", target_id="tx2", edge_type="input"))
        with pytest.raises(ValueError, match="cycle"):
            dag.add_edge(TransformEdge(source_id="tx2", target_id="a", edge_type="output"))


# ---------------------------------------------------------------------------
# Visibility
# ---------------------------------------------------------------------------

class TestVisibility:
    def test_set_visible(self):
        dag = _build_simple_dag()
        dag.set_tensor_visible("bp_raw", False)
        assert not dag.get_tensor_node("bp_raw").visible
        assert dag.get_tensor_node("raw").visible
        # list_visible_tensors should exclude hidden
        visible = dag.list_visible_tensors()
        ids = [n.id for n in visible]
        assert "raw" in ids
        assert "bp_raw" not in ids

    def test_set_exploratory(self):
        dag = _build_simple_dag()
        dag.set_tensor_exploratory("bp_raw", True)
        assert dag.get_tensor_node("bp_raw").exploratory


# ---------------------------------------------------------------------------
# Lineage queries
# ---------------------------------------------------------------------------

class TestLineageQueries:
    def test_get_upstream_simple(self):
        dag = _build_simple_dag()
        upstream = dag.get_upstream("bp_raw")
        names = [n.transform_name for n in upstream]
        assert "bandpass" in names

    def test_get_upstream_chain(self):
        dag = _build_chain_dag()
        upstream = dag.get_upstream("psd_bp")
        names = [n.transform_name for n in upstream]
        assert "psd" in names
        assert "bandpass" in names

    def test_get_upstream_source_is_empty(self):
        dag = _build_simple_dag()
        upstream = dag.get_upstream("raw")
        assert upstream == []

    def test_get_downstream_simple(self):
        dag = _build_simple_dag()
        downstream = dag.get_downstream("raw")
        ids = [n.id for n in downstream]
        assert "tx_bp" in ids
        assert "bp_raw" in ids

    def test_get_downstream_chain(self):
        dag = _build_chain_dag()
        downstream = dag.get_downstream("raw")
        ids = [n.id for n in downstream]
        assert "bp_raw" in ids
        assert "tx_psd" in ids
        assert "psd_bp" in ids

    def test_get_downstream_leaf_is_empty(self):
        dag = _build_chain_dag()
        downstream = dag.get_downstream("psd_bp")
        assert downstream == []

    def test_get_provenance_chain(self):
        dag = _build_chain_dag()
        chain = dag.get_provenance_chain("psd_bp")
        assert len(chain) == 2
        # Root-first order.
        assert chain[0].transform_name == "bandpass"
        assert chain[0].input_tensor_id == "raw"
        assert chain[0].output_tensor_id == "bp_raw"
        assert chain[1].transform_name == "psd"
        assert chain[1].input_tensor_id == "bp_raw"
        assert chain[1].output_tensor_id == "psd_bp"

    def test_get_provenance_source_is_empty(self):
        dag = _build_simple_dag()
        chain = dag.get_provenance_chain("raw")
        assert chain == []

    def test_direct_inputs_outputs(self):
        dag = _build_simple_dag()
        assert dag.get_direct_inputs("tx_bp") == ["raw"]
        assert dag.get_direct_outputs("tx_bp") == ["bp_raw"]
        assert dag.get_direct_inputs("raw") == []
        assert dag.get_direct_outputs("bp_raw") == []


# ---------------------------------------------------------------------------
# Serialization
# ---------------------------------------------------------------------------

class TestDAGSerialization:
    def test_round_trip(self):
        dag = _build_chain_dag()
        d = dag.to_dict()
        restored = WorkspaceDAG.from_dict(d)
        assert restored.n_tensor_nodes == dag.n_tensor_nodes
        assert restored.n_transform_nodes == dag.n_transform_nodes
        assert restored.n_edges == dag.n_edges

        # Lineage queries should work on restored DAG.
        chain = restored.get_provenance_chain("psd_bp")
        assert len(chain) == 2
        assert chain[0].transform_name == "bandpass"

    def test_tensor_node_round_trip(self):
        node = DAGTensorNode(
            id="t1", tensor_id="t1", node_type="derived",
            visible=False, exploratory=True, display_name="My Tensor",
        )
        d = node.to_dict()
        restored = DAGTensorNode.from_dict(d)
        assert restored.id == node.id
        assert restored.visible == False
        assert restored.exploratory == True
        assert restored.display_name == "My Tensor"

    def test_transform_node_round_trip(self):
        node = DAGTransformNode(
            id="tx1", transform_name="psd",
            params={"window_s": 0.5}, status="error", error="boom",
        )
        d = node.to_dict()
        restored = DAGTransformNode.from_dict(d)
        assert restored.transform_name == "psd"
        assert restored.status == "error"
        assert restored.error == "boom"


# ---------------------------------------------------------------------------
# record_execution convenience
# ---------------------------------------------------------------------------

class TestRecordExecution:
    def test_record_creates_nodes_and_edges(self):
        dag = WorkspaceDAG()
        t_node = dag.record_execution(
            input_tensor_ids=["raw"],
            transform_name="bandpass",
            params={"lo_hz": 1.0, "hi_hz": 40.0},
            output_tensor_id="bp_raw",
        )
        assert dag.n_tensor_nodes == 2  # raw + bp_raw
        assert dag.n_transform_nodes == 1
        assert dag.n_edges == 2  # raw→tx, tx→bp_raw
        assert t_node.status == "computed"
        assert dag.get_tensor_node("raw").node_type == "source"
        assert dag.get_tensor_node("bp_raw").node_type == "derived"

    def test_record_existing_input(self):
        dag = WorkspaceDAG()
        dag.add_tensor_node(DAGTensorNode(id="raw", tensor_id="raw"))
        dag.record_execution(
            input_tensor_ids=["raw"],
            transform_name="prewhiten",
            params={},
            output_tensor_id="pw_raw",
        )
        # raw should not be duplicated.
        assert dag.n_tensor_nodes == 2

    def test_record_error(self):
        dag = WorkspaceDAG()
        t_node = dag.record_execution(
            input_tensor_ids=["raw"],
            transform_name="bad_transform",
            params={},
            output_tensor_id="err_out",
            status="error",
            error="computation failed",
        )
        assert t_node.status == "error"
        assert t_node.error == "computation failed"


# ---------------------------------------------------------------------------
# Executor + DAG integration
# ---------------------------------------------------------------------------

class TestExecutorDAGIntegration:
    def _setup(self):
        treg = TransformRegistry()
        register_builtins(treg)
        tensor_reg = TensorRegistry()
        tensor_reg.add(_make_grid_tensor("signal"))
        dag = WorkspaceDAG()
        dag.add_tensor_node(DAGTensorNode(
            id="signal", tensor_id="signal", node_type="source",
        ))
        cache = TransformCache()
        executor = TransformExecutor(treg, tensor_reg, cache, dag=dag)
        return executor, dag

    def test_execution_records_in_dag(self):
        executor, dag = self._setup()
        executor.execute("prewhiten", ["signal"], tensor_id="pw_signal")
        assert dag.has_node("pw_signal")
        assert dag.get_tensor_node("pw_signal").node_type == "derived"
        assert dag.n_transform_nodes == 1
        # Provenance chain from pw_signal.
        chain = dag.get_provenance_chain("pw_signal")
        assert len(chain) == 1
        assert chain[0].transform_name == "prewhiten"
        assert chain[0].input_tensor_id == "signal"

    def test_chained_execution_builds_lineage(self):
        executor, dag = self._setup()
        try:
            executor.execute(
                "bandpass", ["signal"],
                {"lo_hz": 1.0, "hi_hz": 40.0},
                tensor_id="bp_signal",
            )
            executor.execute(
                "psd", ["bp_signal"],
                {"window_s": 0.5},
                tensor_id="psd_bp",
            )
        except ImportError:
            pytest.skip("scipy not available")

        chain = dag.get_provenance_chain("psd_bp")
        assert len(chain) == 2
        assert chain[0].transform_name == "bandpass"
        assert chain[1].transform_name == "psd"

        upstream = dag.get_upstream("psd_bp")
        names = [n.transform_name for n in upstream]
        assert "bandpass" in names
        assert "psd" in names

    def test_cached_execution_does_not_duplicate_dag(self):
        executor, dag = self._setup()
        executor.execute("prewhiten", ["signal"], tensor_id="pw1")
        n_transforms_before = dag.n_transform_nodes
        # Cache hit should not add new DAG nodes.
        executor.execute("prewhiten", ["signal"], tensor_id="pw1")
        assert dag.n_transform_nodes == n_transforms_before
