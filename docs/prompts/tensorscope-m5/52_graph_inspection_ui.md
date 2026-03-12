# Prompt 52: Graph Inspection UI Contracts

Read first:

- [00_context.md](./00_context.md)
- [50_dag_model.md](./50_dag_model.md)
- [51_lineage_queries.md](./51_lineage_queries.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: define the UI contracts for DAG inspection: which node is focused, what is shown in the inspector panel, and how the user navigates the graph.

Scope:

- focused node state
- inspector panel content per node type
- graph navigation interactions

Implementation Tasks:

- define `focusedNodeId: string | null` in the workspace store — the node most recently selected by the user; drives the inspector panel content
- specify inspector panel content per node type: `TensorNode` → tensor metadata, coordinate schema, visibility toggle, downstream consumers; `TransformNode` → transform id, parameter snapshot, execution status, input/output tensor links
- define graph navigation: clicking a tensor node focuses it and shows its inspector content; clicking a transform node focuses it; clicking an edge navigates to the upstream or downstream node
- specify that the graph inspection UI inspects and navigates — it does not execute transforms, modify parameters, or reorder edges

Constraints:

- the graph UI should inspect and navigate; it must not become an execution engine
- `focusedNodeId` is the only new global state M5 adds to the workspace store; it must not grow into a full DAG editing surface in M5
- graph visibility controls must not erase provenance — hiding a node hides its rendering, not its record

Acceptance Criteria:

- `focusedNodeId` is defined in the workspace store with explicit setter semantics
- inspector panel content contracts are defined per node type
- graph navigation interactions (click, edge traversal) are specified
- the distinction between "focused for inspection" and "selected for export" is documented (M6 uses the latter)

Deliverables:

- prompt-ready graph inspection UI contract
- explicit focused-node state and inspector content specs

## Reference

JupyterLab's `WidgetTracker` / `focusedViewId` pattern (`packages/apputils/src/widgettracker.ts`) is the direct model for `focusedNodeId`: the tracker holds the currently focused widget; the inspector panel subscribes and swaps its content when focus changes. No prop-drilling from the root component.

The `IInspector` source-swap pattern: each node type registers a content provider; the inspector panel calls `setContent(provider.render(nodeId))` on focus change. The panel is node-type–agnostic.

See [docs/reference-studies/jupyterlab.md §2.4](../../reference-studies/jupyterlab.md).
