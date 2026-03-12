# Prompt 51: Lineage Queries

Read first:

- [00_context.md](./00_context.md)
- [50_dag_model.md](./50_dag_model.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: define the lineage query API that allows inspection of upstream and downstream relationships from any tensor or transform node.

Scope:

- upstream traversal (what tensors and transforms produced this tensor?)
- downstream traversal (what tensors and views consume this tensor?)
- path queries (what is the full provenance chain from a base tensor to a derived tensor?)

Implementation Tasks:

- define `getUpstream(nodeId): TransformNode[]` — returns all transforms that produced this tensor, recursively to base tensors
- define `getDownstream(nodeId): (TransformNode | TensorNode)[]` — returns all transforms and tensors that depend on this node
- define `getProvenance(tensorId): ProvenanceChain` — returns the full ordered sequence of `(tensor, transform, params)` tuples from root to the given derived tensor
- specify how cycles are detected and rejected (the DAG invariant must be enforced at edge insertion, not at query time)
- specify that lineage queries are read-only operations on the DAG model; they do not trigger computation or modify state

Constraints:

- lineage queries must remain correct if the DAG contains disconnected subgraphs (e.g., two independent base tensors)
- lineage queries are synchronous and cheap; they operate on the in-memory DAG structure only
- the `ProvenanceChain` output must be serializable for use in pipeline export (M6)

Acceptance Criteria:

- upstream and downstream traversal APIs are defined with explicit return types
- `ProvenanceChain` is defined and serializable
- lineage queries do not trigger computation or modify state

Deliverables:

- prompt-ready lineage query API spec
- explicit traversal and provenance chain contracts
