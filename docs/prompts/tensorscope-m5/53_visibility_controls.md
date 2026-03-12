# Prompt 53: Visibility Controls and Intermediate Tensor Inspection

Read first:

- [00_context.md](./00_context.md)
- [50_dag_model.md](./50_dag_model.md)
- [52_graph_inspection_ui.md](./52_graph_inspection_ui.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: define visibility controls for exploratory DAG nodes and the rules for surfacing intermediate tensors in views.

Scope:

- node visibility state
- intermediate tensor surfacing
- distinction between exploratory and curated nodes

Implementation Tasks:

- define `TensorNode.visible: boolean` — when false, the node's tensor is excluded from the view registry's available views; the node remains in the DAG for provenance
- define `TensorNode.exploratory: boolean` — marks a node as temporary and not eligible for pipeline export (M6); exploratory nodes may be visible or hidden
- specify how an intermediate tensor becomes inspectable: setting `TensorNode.visible = true` on any non-output tensor adds it to the view registry as an available view source; the user can then open a view panel for it
- specify the promotion rule: promoting an exploratory node to a curated node (setting `exploratory = false`) is a deliberate user action that makes it eligible for M6 pipeline export
- keep the exploratory / curated distinction explicit in the DAG model, not inferred from visibility state

Constraints:

- graph visibility controls must not erase provenance
- hiding a node hides its rendering contribution, not its record in the DAG
- exploratory nodes and curated nodes must remain distinct concepts; do not conflate with visibility
- M5 does not yet define the pipeline export surface — that is M6's concern

Acceptance Criteria:

- `TensorNode.visible` and `TensorNode.exploratory` are defined with explicit semantics
- intermediate tensor inspection is achievable by toggling visibility on any non-output tensor
- the exploratory / curated distinction is defined and documented for M6 consumption

Deliverables:

- prompt-ready visibility and promotion spec
- explicit node state semantics for both visibility and exploratory status
