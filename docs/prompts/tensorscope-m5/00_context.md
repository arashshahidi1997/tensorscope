# TensorScope M5 Context

Use this file as the shared context preamble for M5 tasks.

Read first:

- [../README.md](../README.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)
- [../../architecture/invariants.md](../../architecture/invariants.md)
- [../context_snapshot.md](../context_snapshot.md)
- [../tensorscope-m4/README.md](../tensorscope-m4/README.md)

## Conceptual architecture

M5 models the analysis workspace as a transform DAG composed of:

- `TensorNode` for source and derived tensors
- `TransformNode` for registered analysis operations
- `TransformEdge` for lineage between tensors and transforms

The DAG integrates with the existing registry direction from the architecture docs. `TensorRegistry` remains the canonical source of tensor objects. `TransformRegistry` remains the canonical source of transform definitions. M5 adds the graph structure that connects them for inspection and navigation.

## What this milestone enables

- inspection of transform lineage from any tensor
- navigation across upstream and downstream analysis steps
- visibility toggles for exploratory nodes
- surfacing intermediate tensors for inspection and rendering
- parameter inspection for transform nodes without embedding analysis logic inside views
- a lineage tree or graph surface inside the workspace shell

## Guardrails

- the transform DAG is part of the analysis model, not a view-local convenience layer
- shared navigation state remains the only cross-view coordination mechanism
- graph visibility controls must not erase provenance
- exploratory workspace nodes and curated exportable nodes must remain distinct concepts
- the graph UI should inspect and navigate transforms; it should not become an execution engine
- the graph UI should not become a freeform node editor

## Expected integration points

- `TensorRegistry` and tensor metadata
- `TransformRegistry` and transform descriptors
- inspector and workspace-shell surfaces introduced in M1
- scientific and spatial views from M2 and M3 that need intermediate tensor inspection
- pipeline export work in M6, which should consume curated graph state rather than the raw exploratory DAG
- [../../architecture/transform-dag.md](../../architecture/transform-dag.md)

## Reference studies

[docs/reference-studies/jupyterlab.md](../../reference-studies/jupyterlab.md) contributes two M5-relevant patterns: (1) `WidgetTracker` / `focusedViewId` pattern (`packages/apputils/src/widgettracker.ts`) — the direct model for M5's `focusedNodeId` in the workspace store; the inspector panel subscribes to focus changes and swaps content without prop-drilling from the root; (2) the `IInspector` source-swap pattern — each node type registers an inspector content provider; the inspector panel is node-type–agnostic (linked from `52_graph_inspection_ui.md`).

[docs/reference-studies/neuroglancer.md](../../reference-studies/neuroglancer.md) contributes the `DataSourceRegistry` side-effect import pattern (`src/datasource/index.ts`): importing a transform node module registers the node type with the DAG's node factory, enabling `restoreState()` to reconstruct nodes from serialized type strings. Also: `CompoundTrackable` composing child `Trackable` pieces — the DAG itself should be serializable as a `CompoundTrackable` where each node contributes its own `toJSON()` output (linked from `50_dag_model.md`).

[docs/reference-studies/observable-plot.md](../../reference-studies/observable-plot.md) contributes the `composeRender` middleware chain pattern (`src/mark.js`). In M5's terms, a lineage path from source tensor to derived tensor is a composed transform chain; the DAG traversal composes provenance records in the same middleware style — each step calls `next()` and records its contribution (linked from `51_lineage_queries.md`).

[docs/reference-studies/higlass.md](../../reference-studies/higlass.md) contributes the pub/sub decoupling pattern — DAG node state changes (visibility toggle, execution status update) should emit typed events via a lightweight pub/sub bus rather than triggering React re-renders directly. This keeps the DAG model decoupled from the rendering layer and allows multiple inspector panels to subscribe independently.
