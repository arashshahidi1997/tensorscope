"""Workspace DAG: graph model over tensors and transforms with lineage queries.

The DAG connects source/derived tensors to transforms via directed edges.
It provides inspection and navigation without becoming an execution engine.

Node types:
  - DAGTensorNode: wraps a source or derived tensor
  - DAGTransformNode: wraps a transform execution with parameter snapshot

Edge type:
  - TransformEdge: directed (tensor → transform) or (transform → tensor)

The DAG is automatically maintained by TransformExecutor.  Manual construction
is supported for session restore.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any, Literal


# ---------------------------------------------------------------------------
# Node types
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class DAGTensorNode:
    """A tensor in the workspace graph (source or derived).

    Parameters
    ----------
    id
        Unique node id (matches tensor name in TensorRegistry).
    tensor_id
        Reference to TensorRegistry entry.
    node_type
        "source" for root tensors, "derived" for transform outputs.
    visible
        Whether this tensor appears in view registry's available views.
    exploratory
        Temporary/experimental flag; exploratory nodes are not eligible
        for pipeline export (M6).
    pipeline_selected
        Whether this tensor is selected for pipeline export (M6).
    display_name
        Human-readable label (defaults to tensor_id).
    """

    id: str
    tensor_id: str
    node_type: Literal["source", "derived"] = "source"
    visible: bool = True
    exploratory: bool = False
    pipeline_selected: bool = False
    display_name: str = ""

    def __post_init__(self) -> None:
        if not self.display_name:
            self.display_name = self.tensor_id

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "tensor_id": self.tensor_id,
            "node_type": self.node_type,
            "visible": self.visible,
            "exploratory": self.exploratory,
            "pipeline_selected": self.pipeline_selected,
            "display_name": self.display_name,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> DAGTensorNode:
        return cls(**data)


@dataclass(slots=True)
class DAGTransformNode:
    """A transform execution in the workspace graph.

    Parameters
    ----------
    id
        Unique node id.
    transform_name
        Registry key of the transform.
    params
        Parameter snapshot used for this execution.
    status
        Execution state: pending, computed, error.
    error
        Error message if status == "error".
    """

    id: str
    transform_name: str
    params: dict[str, Any] = field(default_factory=dict)
    status: Literal["pending", "computed", "error"] = "pending"
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "transform_name": self.transform_name,
            "params": self.params,
            "status": self.status,
            "error": self.error,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> DAGTransformNode:
        return cls(**data)


# ---------------------------------------------------------------------------
# Edge type
# ---------------------------------------------------------------------------

@dataclass(frozen=True, slots=True)
class TransformEdge:
    """Directed edge in the workspace graph.

    Edges connect:
      tensor → transform  (input relationship)
      transform → tensor  (output relationship)

    Parameters
    ----------
    source_id
        Id of the source node (tensor or transform).
    target_id
        Id of the target node (transform or tensor).
    edge_type
        "input" = tensor feeds into transform.
        "output" = transform produces tensor.
    """

    source_id: str
    target_id: str
    edge_type: Literal["input", "output"]

    def to_dict(self) -> dict[str, Any]:
        return {
            "source_id": self.source_id,
            "target_id": self.target_id,
            "edge_type": self.edge_type,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> TransformEdge:
        return cls(**data)


# ---------------------------------------------------------------------------
# Provenance chain
# ---------------------------------------------------------------------------

@dataclass(frozen=True, slots=True)
class ProvenanceStep:
    """One step in a provenance chain: input tensor → transform → output tensor."""

    input_tensor_id: str
    transform_name: str
    params: dict[str, Any]
    output_tensor_id: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "input_tensor_id": self.input_tensor_id,
            "transform_name": self.transform_name,
            "params": self.params,
            "output_tensor_id": self.output_tensor_id,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ProvenanceStep:
        return cls(**data)


# ---------------------------------------------------------------------------
# Workspace DAG
# ---------------------------------------------------------------------------

class WorkspaceDAG:
    """Workspace graph of tensors and transforms.

    Maintains the graph structure connecting source and derived tensors
    via transform nodes.  Provides lineage queries for inspection.

    The DAG enforces:
    - No cycles (acyclic invariant)
    - No duplicate node ids
    - Edges must reference existing nodes
    """

    def __init__(self) -> None:
        self._tensor_nodes: dict[str, DAGTensorNode] = {}
        self._transform_nodes: dict[str, DAGTransformNode] = {}
        self._edges: list[TransformEdge] = []
        # Index: node_id → edges where node is source or target
        self._outgoing: dict[str, list[TransformEdge]] = {}
        self._incoming: dict[str, list[TransformEdge]] = {}

    # -- Node operations ---------------------------------------------------

    def add_tensor_node(self, node: DAGTensorNode) -> None:
        """Add a tensor node. Raises ValueError if id already exists."""
        if node.id in self._tensor_nodes or node.id in self._transform_nodes:
            raise ValueError(f"Node {node.id!r} already exists in DAG")
        self._tensor_nodes[node.id] = node
        self._outgoing.setdefault(node.id, [])
        self._incoming.setdefault(node.id, [])

    def add_transform_node(self, node: DAGTransformNode) -> None:
        """Add a transform node. Raises ValueError if id already exists."""
        if node.id in self._tensor_nodes or node.id in self._transform_nodes:
            raise ValueError(f"Node {node.id!r} already exists in DAG")
        self._transform_nodes[node.id] = node
        self._outgoing.setdefault(node.id, [])
        self._incoming.setdefault(node.id, [])

    def get_tensor_node(self, node_id: str) -> DAGTensorNode:
        if node_id not in self._tensor_nodes:
            raise KeyError(f"Tensor node {node_id!r} not found in DAG")
        return self._tensor_nodes[node_id]

    def get_transform_node(self, node_id: str) -> DAGTransformNode:
        if node_id not in self._transform_nodes:
            raise KeyError(f"Transform node {node_id!r} not found in DAG")
        return self._transform_nodes[node_id]

    def has_node(self, node_id: str) -> bool:
        return node_id in self._tensor_nodes or node_id in self._transform_nodes

    def get_node_type(self, node_id: str) -> Literal["tensor", "transform"]:
        if node_id in self._tensor_nodes:
            return "tensor"
        if node_id in self._transform_nodes:
            return "transform"
        raise KeyError(f"Node {node_id!r} not found in DAG")

    # -- Edge operations ---------------------------------------------------

    def add_edge(self, edge: TransformEdge) -> None:
        """Add a directed edge. Validates nodes exist and no cycle is created."""
        if not self.has_node(edge.source_id):
            raise KeyError(f"Source node {edge.source_id!r} not found in DAG")
        if not self.has_node(edge.target_id):
            raise KeyError(f"Target node {edge.target_id!r} not found in DAG")

        # Check for cycles: would adding this edge create a path from target back to source?
        if self._would_create_cycle(edge.source_id, edge.target_id):
            raise ValueError(
                f"Adding edge {edge.source_id!r} → {edge.target_id!r} "
                "would create a cycle"
            )

        self._edges.append(edge)
        self._outgoing[edge.source_id].append(edge)
        self._incoming[edge.target_id].append(edge)

    def _would_create_cycle(self, source_id: str, target_id: str) -> bool:
        """Check if adding source→target would create a cycle (DFS from target)."""
        visited: set[str] = set()
        stack = [target_id]
        while stack:
            current = stack.pop()
            if current == source_id:
                return True
            if current in visited:
                continue
            visited.add(current)
            for edge in self._outgoing.get(current, []):
                stack.append(edge.target_id)
        return False

    # -- Visibility controls -----------------------------------------------

    def set_tensor_visible(self, tensor_node_id: str, visible: bool) -> None:
        """Toggle tensor visibility (hides from views, preserves provenance)."""
        node = self.get_tensor_node(tensor_node_id)
        node.visible = visible

    def set_tensor_exploratory(self, tensor_node_id: str, exploratory: bool) -> None:
        """Mark tensor as exploratory or curated."""
        node = self.get_tensor_node(tensor_node_id)
        node.exploratory = exploratory

    def set_tensor_pipeline_selected(self, tensor_node_id: str, selected: bool) -> None:
        """Mark tensor as selected for pipeline export."""
        node = self.get_tensor_node(tensor_node_id)
        node.pipeline_selected = selected

    # -- Lineage queries ---------------------------------------------------

    def get_upstream(self, node_id: str) -> list[DAGTransformNode]:
        """Return all transform nodes upstream of the given node (recursive)."""
        result: list[DAGTransformNode] = []
        visited: set[str] = set()
        self._collect_upstream_transforms(node_id, result, visited)
        return result

    def _collect_upstream_transforms(
        self,
        node_id: str,
        result: list[DAGTransformNode],
        visited: set[str],
    ) -> None:
        if node_id in visited:
            return
        visited.add(node_id)
        for edge in self._incoming.get(node_id, []):
            source = edge.source_id
            if source in self._transform_nodes and source not in visited:
                result.append(self._transform_nodes[source])
            self._collect_upstream_transforms(source, result, visited)

    def get_downstream(self, node_id: str) -> list[DAGTensorNode | DAGTransformNode]:
        """Return all nodes downstream of the given node (recursive)."""
        result: list[DAGTensorNode | DAGTransformNode] = []
        visited: set[str] = set()
        self._collect_downstream(node_id, result, visited)
        return result

    def _collect_downstream(
        self,
        node_id: str,
        result: list[DAGTensorNode | DAGTransformNode],
        visited: set[str],
    ) -> None:
        if node_id in visited:
            return
        visited.add(node_id)
        for edge in self._outgoing.get(node_id, []):
            target = edge.target_id
            if target not in visited:
                if target in self._tensor_nodes:
                    result.append(self._tensor_nodes[target])
                elif target in self._transform_nodes:
                    result.append(self._transform_nodes[target])
                self._collect_downstream(target, result, visited)

    def get_provenance_chain(self, tensor_node_id: str) -> list[ProvenanceStep]:
        """Return ordered provenance chain from root source(s) to the given tensor.

        Each step records: input tensor → transform (with params) → output tensor.
        Steps are ordered root-first (earliest ancestor first).
        """
        node = self.get_tensor_node(tensor_node_id)
        if node.node_type == "source":
            return []

        chain: list[ProvenanceStep] = []
        self._build_provenance_chain(tensor_node_id, chain, set())
        # Reverse so root is first.
        chain.reverse()
        return chain

    def _build_provenance_chain(
        self,
        node_id: str,
        chain: list[ProvenanceStep],
        visited: set[str],
    ) -> None:
        if node_id in visited:
            return
        visited.add(node_id)

        # Find incoming edges to this node.
        for edge in self._incoming.get(node_id, []):
            source_id = edge.source_id
            if source_id in self._transform_nodes:
                transform_node = self._transform_nodes[source_id]
                # Find input tensors feeding this transform.
                for input_edge in self._incoming.get(source_id, []):
                    input_tensor_id = input_edge.source_id
                    chain.append(ProvenanceStep(
                        input_tensor_id=input_tensor_id,
                        transform_name=transform_node.transform_name,
                        params=transform_node.params,
                        output_tensor_id=node_id,
                    ))
                    # Recurse upstream.
                    self._build_provenance_chain(input_tensor_id, chain, visited)

    def get_direct_inputs(self, node_id: str) -> list[str]:
        """Return immediate input node ids."""
        return [e.source_id for e in self._incoming.get(node_id, [])]

    def get_direct_outputs(self, node_id: str) -> list[str]:
        """Return immediate output node ids."""
        return [e.target_id for e in self._outgoing.get(node_id, [])]

    # -- Listing -----------------------------------------------------------

    def list_tensor_nodes(self) -> list[DAGTensorNode]:
        return list(self._tensor_nodes.values())

    def list_transform_nodes(self) -> list[DAGTransformNode]:
        return list(self._transform_nodes.values())

    def list_edges(self) -> list[TransformEdge]:
        return list(self._edges)

    def list_visible_tensors(self) -> list[DAGTensorNode]:
        """Return only visible tensor nodes."""
        return [n for n in self._tensor_nodes.values() if n.visible]

    @property
    def n_tensor_nodes(self) -> int:
        return len(self._tensor_nodes)

    @property
    def n_transform_nodes(self) -> int:
        return len(self._transform_nodes)

    @property
    def n_edges(self) -> int:
        return len(self._edges)

    # -- Serialization -----------------------------------------------------

    def to_dict(self) -> dict[str, Any]:
        """Serialize the full DAG for session persistence."""
        return {
            "tensor_nodes": [n.to_dict() for n in self._tensor_nodes.values()],
            "transform_nodes": [n.to_dict() for n in self._transform_nodes.values()],
            "edges": [e.to_dict() for e in self._edges],
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> WorkspaceDAG:
        """Restore DAG from serialized data."""
        dag = cls()
        for nd in data.get("tensor_nodes", []):
            dag.add_tensor_node(DAGTensorNode.from_dict(nd))
        for nd in data.get("transform_nodes", []):
            dag.add_transform_node(DAGTransformNode.from_dict(nd))
        for ed in data.get("edges", []):
            dag.add_edge(TransformEdge.from_dict(ed))
        return dag

    # -- Convenience: build from execution ---------------------------------

    def record_execution(
        self,
        input_tensor_ids: list[str],
        transform_name: str,
        params: dict[str, Any],
        output_tensor_id: str,
        *,
        status: Literal["pending", "computed", "error"] = "computed",
        error: str | None = None,
    ) -> DAGTransformNode:
        """Record a transform execution in the DAG.

        Adds tensor nodes for any inputs/output not already in the graph,
        creates a transform node, and wires up the edges.

        Returns the created DAGTransformNode.
        """
        # Ensure input tensor nodes exist.
        for tid in input_tensor_ids:
            if not self.has_node(tid):
                self.add_tensor_node(DAGTensorNode(
                    id=tid, tensor_id=tid, node_type="source",
                ))

        # Ensure output tensor node exists.
        if not self.has_node(output_tensor_id):
            self.add_tensor_node(DAGTensorNode(
                id=output_tensor_id,
                tensor_id=output_tensor_id,
                node_type="derived",
            ))

        # Create transform node.
        t_node_id = f"tx_{transform_name}_{uuid.uuid4().hex[:8]}"
        t_node = DAGTransformNode(
            id=t_node_id,
            transform_name=transform_name,
            params=params,
            status=status,
            error=error,
        )
        self.add_transform_node(t_node)

        # Wire edges: inputs → transform → output.
        for tid in input_tensor_ids:
            self.add_edge(TransformEdge(
                source_id=tid, target_id=t_node_id, edge_type="input",
            ))
        self.add_edge(TransformEdge(
            source_id=t_node_id, target_id=output_tensor_id, edge_type="output",
        ))

        return t_node
