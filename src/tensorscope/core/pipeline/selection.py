"""Pipeline selection: extract minimal subgraph from workspace DAG.

Given a set of output tensor node IDs, walk upstream to collect
all required source tensors, transforms, and derived tensors.
"""

from __future__ import annotations

from tensorscope.core.transforms.dag import WorkspaceDAG
from tensorscope.core.pipeline.spec import (
    PipelineSpec,
    PipelineSourceTensor,
    PipelineTransformNode,
    PipelineDerivedTensor,
    ExecutionMetadata,
)


class PipelineSelectionError(Exception):
    """Raised when pipeline selection encounters invalid state."""


def extract_pipeline(
    dag: WorkspaceDAG,
    output_tensor_ids: list[str],
    *,
    name: str = "",
    cooker_profile: str | None = None,
    session_id: str = "",
    description: str = "",
) -> PipelineSpec:
    """Extract a minimal pipeline subgraph for the given output tensors.

    Algorithm:
    1. Validate all output_tensor_ids exist as tensor nodes
    2. Walk upstream from each output, collecting all reachable nodes
    3. Reject if any required node is exploratory
    4. Build PipelineSpec from collected nodes and edges

    Parameters
    ----------
    dag : WorkspaceDAG
        The full workspace DAG.
    output_tensor_ids : list[str]
        Tensor node IDs designated as pipeline outputs.
    name : str
        Pipeline name.
    cooker_profile : str | None
        Target workflow system (e.g. "snakemake").
    session_id : str
        Session identifier for metadata.
    description : str
        Human-readable description.

    Returns
    -------
    PipelineSpec

    Raises
    ------
    PipelineSelectionError
        If any output doesn't exist, or upstream contains exploratory nodes.
    """
    if not output_tensor_ids:
        raise PipelineSelectionError("No output tensor IDs provided")

    # Validate outputs exist
    for tid in output_tensor_ids:
        if not dag.has_node(tid):
            raise PipelineSelectionError(f"Tensor node '{tid}' not found in DAG")
        if dag.get_node_type(tid) != "tensor":
            raise PipelineSelectionError(f"Node '{tid}' is not a tensor node")

    # Walk upstream from each output to collect required nodes
    visited_tensors: set[str] = set()
    visited_transforms: set[str] = set()

    def _walk_upstream(node_id: str) -> None:
        """Recursively collect all upstream nodes."""
        node_type = dag.get_node_type(node_id)

        if node_type == "tensor":
            if node_id in visited_tensors:
                return
            visited_tensors.add(node_id)
        elif node_type == "transform":
            if node_id in visited_transforms:
                return
            visited_transforms.add(node_id)
        else:
            return

        for parent_id in dag.get_direct_inputs(node_id):
            _walk_upstream(parent_id)

    for tid in output_tensor_ids:
        _walk_upstream(tid)

    # Check for exploratory nodes
    for tid in visited_tensors:
        tnode = dag.get_tensor_node(tid)
        if tnode.exploratory:
            raise PipelineSelectionError(
                f"Tensor node '{tid}' is exploratory and cannot be included "
                f"in a pipeline. Promote it to curated first."
            )

    # Build spec components
    source_tensors: list[PipelineSourceTensor] = []
    derived_tensors: list[PipelineDerivedTensor] = []

    for tid in sorted(visited_tensors):
        tnode = dag.get_tensor_node(tid)
        if tnode.node_type == "source":
            source_tensors.append(PipelineSourceTensor(tensor_id=tnode.tensor_id))
        else:
            derived_tensors.append(PipelineDerivedTensor(tensor_id=tnode.tensor_id))

    # Build transform nodes with their inputs/outputs from edges
    transforms: list[PipelineTransformNode] = []
    for txid in sorted(visited_transforms):
        txnode = dag.get_transform_node(txid)
        inputs = dag.get_direct_inputs(txid)
        outputs = dag.get_direct_outputs(txid)
        transforms.append(PipelineTransformNode(
            node_id=txnode.id,
            transform_name=txnode.transform_name,
            params=dict(txnode.params),
            inputs=inputs,
            output=outputs[0] if outputs else "",
        ))

    # Topological sort transforms by dependency order
    transforms = _topo_sort_transforms(transforms, visited_tensors)

    return PipelineSpec(
        name=name or "pipeline",
        source_tensors=source_tensors,
        transforms=transforms,
        derived_tensors=derived_tensors,
        outputs=list(output_tensor_ids),
        execution_metadata=ExecutionMetadata(
            session_id=session_id,
            description=description,
        ),
        cooker_profile=cooker_profile,
    )


def _topo_sort_transforms(
    transforms: list[PipelineTransformNode],
    all_tensors: set[str],
) -> list[PipelineTransformNode]:
    """Sort transforms in dependency order (inputs before outputs).

    Uses Kahn's algorithm on the transform subgraph.
    """
    # Map output tensor → producing transform
    output_to_tx: dict[str, PipelineTransformNode] = {}
    for tx in transforms:
        if tx.output:
            output_to_tx[tx.output] = tx

    # Build adjacency: tx depends on another tx if any input is that tx's output
    tx_by_id: dict[str, PipelineTransformNode] = {tx.node_id: tx for tx in transforms}
    in_degree: dict[str, int] = {tx.node_id: 0 for tx in transforms}
    dependents: dict[str, list[str]] = {tx.node_id: [] for tx in transforms}

    for tx in transforms:
        for inp in tx.inputs:
            if inp in output_to_tx:
                producer = output_to_tx[inp]
                if producer.node_id != tx.node_id:
                    in_degree[tx.node_id] += 1
                    dependents[producer.node_id].append(tx.node_id)

    # Kahn's algorithm
    queue = [tid for tid, deg in in_degree.items() if deg == 0]
    result: list[PipelineTransformNode] = []

    while queue:
        queue.sort()  # deterministic ordering
        nid = queue.pop(0)
        result.append(tx_by_id[nid])
        for dep_id in dependents[nid]:
            in_degree[dep_id] -= 1
            if in_degree[dep_id] == 0:
                queue.append(dep_id)

    return result
