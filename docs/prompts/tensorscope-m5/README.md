# TensorScope M5 Prompt Pack

Milestone: M5 - Transform DAG And Workspace Graph

Read first:

- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)
- [../../architecture/invariants.md](../../architecture/invariants.md)
- [../context_snapshot.md](../context_snapshot.md)
- [../README.md](../README.md)
- [../tensorscope-m4/README.md](../tensorscope-m4/README.md)

## Milestone purpose

M5 exposes TensorScope's transform lineage as a navigable workspace graph.

Primary focus:

- `TensorNode`, `TransformNode`, and `TransformEdge`
- provenance tracking across source and derived tensors
- DAG inspection and navigation
- lineage tree or graph presentation
- visibility controls for exploratory nodes
- inspection of intermediate tensors and transform parameters
- display toggles for workspace nodes

## Architectural role

M5 turns the transform layer from M4 into an explicit graph model that users can inspect and navigate inside the workspace. This is still part of the interactive analysis architecture, not the execution/export layer.

See [../../architecture/transform-dag.md](../../architecture/transform-dag.md).

## Relationship to earlier milestones

- M1 provides the shared selection and workspace shell contracts.
- M2 provides scalable tensor access and linked scientific views.
- M3 provides spatial dynamics on top of the shared tensor model.
- M4 provides explicit transforms and derived tensors that M5 organizes into a graph.

## Key subsystems introduced

- workspace transform DAG model
- lineage and provenance queries
- graph inspection UI contracts
- node visibility and intermediate tensor inspection rules
- distinction between workspace DAG inspection and freeform workflow editing

## Prompt order

1. [00_context.md](./00_context.md)
2. [50_dag_model.md](./50_dag_model.md) — `TensorNode`, `TransformNode`, `TransformEdge` types and construction rules
3. [51_lineage_queries.md](./51_lineage_queries.md) — upstream/downstream traversal and provenance chain API
4. [52_graph_inspection_ui.md](./52_graph_inspection_ui.md) — focused node state, inspector panel content per node type
5. [53_visibility_controls.md](./53_visibility_controls.md) — node visibility, intermediate tensor surfacing, exploratory vs. curated distinction

## Recommended workflow for agents

1. Read the architecture doc, invariants, context snapshot, M4 README, and this README.
2. Confirm M4 transform and derived tensor contracts are stable before starting M5 graph work.
3. Start from [00_context.md](./00_context.md) and then [50_dag_model.md](./50_dag_model.md).
4. Keep one bounded graph concern per run.
5. The DAG model in prompt 50 must be defined before lineage queries (51) or UI contracts (52) can be specified correctly.

## M5 guardrails

- the graph UI inspects and navigates — it does not execute transforms
- `focusedNodeId` is the only new global state M5 adds — do not grow a full DAG editing surface
- graph visibility controls hide rendering, not provenance
- exploratory and curated nodes are distinct concepts — do not conflate with visibility
- M5 does not define pipeline export — that is M6

## Exit criteria

Treat M5 as done when:

- `TensorNode`, `TransformNode`, `TransformEdge` are defined with explicit contracts
- lineage queries (upstream, downstream, provenance chain) are specified
- graph inspection UI contracts are defined (focused node, inspector content)
- visibility and exploratory / curated distinction are specified for M6 consumption
