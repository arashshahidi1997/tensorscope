# Prompt 50: Transform DAG Model

Read first:

- [00_context.md](./00_context.md)
- [../tensorscope-m4/40_transform_registry.md](../tensorscope-m4/40_transform_registry.md)
- [../tensorscope-m4/41_derived_tensor_model.md](../tensorscope-m4/41_derived_tensor_model.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: define the workspace transform DAG as an explicit data model composed of `TensorNode`, `TransformNode`, and `TransformEdge`.

Scope:

- node and edge types
- DAG construction rules
- connection between the DAG model and the M4 registries

Implementation Tasks:

- define `TensorNode`: wraps a base or derived tensor from the `TensorRegistry`; carries display name, visibility state, and a reference to the underlying `DerivedTensor` or base tensor id
- define `TransformNode`: wraps a registered transform from the `TransformRegistry`; carries parameter snapshot (the same `toJSON()` output from `DerivedTensor.params`), execution status, and any error state
- define `TransformEdge`: directed edge from a `TensorNode` (input) to a `TransformNode`, and from a `TransformNode` to a `TensorNode` (output); each edge carries coordinate compatibility metadata
- specify DAG construction rules: a new edge is valid only if the input tensor's coordinate schema is compatible with the transform's declared `requires`; reject incompatible edges at construction time with an explicit error
- specify how the DAG integrates with the M4 registries: `TensorRegistry` remains the source of truth for tensor objects; `TransformRegistry` remains the source of truth for transform definitions; the DAG is the graph structure that connects them for inspection

Constraints:

- the DAG is part of the analysis model, not a view-local convenience layer
- shared navigation state remains the only cross-view coordination mechanism; the DAG does not introduce a second coordination channel
- the DAG model must be serializable via `toJSON()` / `restoreState()` for session persistence

Acceptance Criteria:

- `TensorNode`, `TransformNode`, and `TransformEdge` are defined with explicit field contracts
- DAG construction validates coordinate compatibility at edge insertion time
- the DAG model integrates with M4 registries without duplicating registry logic

Deliverables:

- prompt-ready DAG model spec
- explicit node/edge type contracts and construction rules

## Reference

Neuroglancer's `DataSourceRegistry` side-effect import pattern (`src/datasource/index.ts`) applies to transform node registration: importing a transform module registers the node type with the DAG's node factory, enabling `restoreState()` to reconstruct nodes from serialized type strings without a centralized type switch.

See [docs/reference-studies/neuroglancer.md §2.5](../../reference-studies/neuroglancer.md).

Observable Plot's `composeTransform` middleware chain is the right model for DAG edge traversal: a path from source tensor to derived tensor is a composed transform that records each step as provenance. The DAG traversal does not need to execute transforms — it only needs to compose the provenance chain.

See [docs/reference-studies/observable-plot.md §4.2](../../reference-studies/observable-plot.md).
