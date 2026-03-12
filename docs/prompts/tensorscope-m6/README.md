# TensorScope M6 Prompt Pack

Milestone: M6 - Pipeline Export And Workflow Cooking

Read first:

- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)
- [../../architecture/invariants.md](../../architecture/invariants.md)
- [../context_snapshot.md](../context_snapshot.md)
- [../README.md](../README.md)
- [../tensorscope-m5/README.md](../tensorscope-m5/README.md)

## Milestone purpose

M6 adds an execution-layer export path from curated workspace state to reproducible workflows.

Primary focus:

- pipeline state files
- transform graph serialization
- promotion from workspace DAG nodes to pipeline DAG nodes
- execution metadata and output declarations
- workflow cooking for Snakemake-oriented execution
- curated graph export rather than whole-workspace dump

## Architectural role

M6 is the bridge between interactive exploration and reproducible execution. It exports curated analysis structure without replacing the interactive workspace or forcing every exploratory node into a durable pipeline.

See [../../architecture/pipeline-export.md](../../architecture/pipeline-export.md).

## Relationship to earlier milestones

- M4 makes transforms and derived tensors explicit.
- M5 makes transform lineage inspectable as a workspace DAG.
- M6 serializes a curated subset of that graph into a durable execution specification.

## Key subsystems introduced

- pipeline state schema
- graph serialization and validation
- node-promotion rules
- workflow cooking adapters
- execution metadata model
- distinction between workspace state and pipeline export state

## Prompt order

1. [00_context.md](./00_context.md)
2. [60_pipeline_state_schema.md](./60_pipeline_state_schema.md) — pipeline document schema, serialization format, and `toJSON()` / `restoreState()` contracts
3. [61_node_promotion.md](./61_node_promotion.md) — exploratory → curated → output promotion model, parameter locking, demotion cascading
4. [62_workflow_cooking.md](./62_workflow_cooking.md) — `WorkflowCooker` adapter interface, Snakemake translation rules, pure function constraint

## Recommended workflow for agents

1. Read the architecture doc, invariants, context snapshot, M5 README, and this README.
2. Confirm M5 DAG model and visibility/promotion concepts are stable before starting M6 export work.
3. Start from [00_context.md](./00_context.md) and then [60_pipeline_state_schema.md](./60_pipeline_state_schema.md).
4. Keep one bounded export concern per run.
5. The pipeline state schema (60) must be defined before promotion rules (61) or cooking adapters (62) can be specified correctly.

## M6 guardrails

- pipeline export does not replace the interactive workspace — exploration continues in M5's DAG
- only curated or output-tagged nodes enter the exported pipeline document
- the `WorkflowCooker` is a pure translation adapter — it must not trigger execution or mutate workspace state
- parameter locking on promotion must not prevent further inspection in the inspector panel
- M6 does not define execution monitoring or run tracking — those are post-M6 concerns

## Exit criteria

Treat M6 as done when:

- pipeline document schema is defined with explicit field contracts
- node promotion model (exploratory → curated → output) is specified with locking and demotion rules
- `WorkflowCooker` interface is defined with a concrete Snakemake translation example
- export path from M5 DAG curated state to pipeline document is traceable without ambiguity
