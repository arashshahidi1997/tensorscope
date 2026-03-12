# Prompt 61: Node Promotion Rules

Read first:

- [00_context.md](./00_context.md)
- [60_pipeline_state_schema.md](./60_pipeline_state_schema.md)
- [../tensorscope-m5/53_visibility_controls.md](../tensorscope-m5/53_visibility_controls.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: define the rules by which workspace DAG nodes are promoted from exploratory to curated, and from curated to pipeline-eligible, for inclusion in the pipeline export schema.

Scope:

- promotion action semantics
- what changes when a node is promoted
- validation rules before promotion
- the promotion surface in the UI

Implementation Tasks:

- define the two promotion levels: `exploratory → curated` (eligible for pipeline) and `curated → output` (designated as a pipeline output tensor)
- specify what changes at each level: `exploratory → curated` marks `TensorNode.exploratory = false`; the node's `toJSON()` snapshot is locked (parameters can no longer be changed without demoting first); `curated → output` adds the tensor id to the `outputs` list in the pipeline schema
- specify validation rules before promotion: (1) the node's input chain must be fully curated — no exploratory nodes upstream; (2) the node's transform parameters must be explicitly set (no defaults left unreviewed); (3) the node must have a non-empty display name
- define demotion: a curated node can be demoted to exploratory; this removes it from the pipeline schema and unfreezes its parameters; downstream curated nodes that depended on it must be notified (they become invalid until their inputs are re-curated)
- specify the promotion UI surface: a promotion action in the inspector panel (from `52_graph_inspection_ui.md`); not a separate promotion modal

Constraints:

- promotion is a deliberate user action, not an automatic consequence of visibility or compute status
- exploratory nodes must never silently enter the pipeline schema
- demotion must cascade — a curated node cannot have exploratory inputs
- the promotion surface is in the inspector panel; M6 does not add a new top-level UI region for this

Acceptance Criteria:

- two-level promotion model is defined with explicit state transitions
- validation rules before promotion are specified
- demotion and cascading invalidity are defined
- the promotion surface is identified (inspector panel action, not a separate UI)

Deliverables:

- prompt-ready node promotion spec
- explicit promotion/demotion state machine
