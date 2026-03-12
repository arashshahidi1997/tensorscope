# TensorScope M6 Context

Use this file as the shared context preamble for M6 tasks.

Read first:

- [../README.md](../README.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)
- [../../architecture/invariants.md](../../architecture/invariants.md)
- [../context_snapshot.md](../context_snapshot.md)
- [../tensorscope-m5/README.md](../tensorscope-m5/README.md)

## Conceptual architecture

M6 introduces a pipeline export layer that serializes curated transform state into a durable specification such as YAML or JSON. That specification should describe:

- source tensors
- promoted transforms
- parameters
- derived tensors
- declared outputs
- execution metadata

The exported pipeline document is then "cooked" into a workflow system such as Snakemake.

## What this milestone enables

- reproducible export of curated analysis state
- explicit separation between exploratory workspace nodes and execution-ready nodes
- workflow generation from interactive analysis structure
- durable provenance for pipeline runs and outputs
- pipeline state files with cooker profile and execution metadata

## Guardrails

- pipeline export must not replace the interactive workspace
- only curated or promoted nodes should enter the pipeline DAG
- the export format must preserve provenance and parameter intent clearly enough for reproducible execution
- exploratory temporary nodes may exist in the workspace DAG without being serialized
- execution metadata belongs to the export layer, not the shared navigation state
- workflow cooking should target reproducible systems such as Snakemake

## Expected integration points

- transform DAG model from M5
- transform and tensor registries from M4 and earlier milestones
- session metadata and inspector surfaces for promotion/review workflows
- Snakemake workflow generation or similar cooking adapters
- [../../architecture/pipeline-export.md](../../architecture/pipeline-export.md)

## Reference studies

[docs/reference-studies/perspective.md](../../reference-studies/perspective.md) contributes the `save()` / `restore()` two-level pattern: per-node local state is serialized individually and then aggregated at the workspace level. In M6 terms, each promoted node calls its own `toJSON()` and the pipeline document aggregates those outputs. The `save()` output must round-trip through `restore()` without re-running the transform — the serialized form is the contract, not the in-memory object.

[docs/reference-studies/neuroglancer.md](../../reference-studies/neuroglancer.md) contributes the `Trackable` interface (`toJSON()` / `restoreState()` / `reset()` / `changed` signal). Every promoted node must implement this interface so the pipeline document can be reconstructed from JSON alone. `restoreState()` must not trigger re-execution — it restores parameter state only.

[docs/reference-studies/observable-plot.md](../../reference-studies/observable-plot.md) contributes `composeTransform` as the model for the `WorkflowCooker` adapter pipeline. Each cooking step is a pure function that accepts a partial pipeline document and returns a transformed version; the adapter chain composes these steps in order. A Snakemake cooking adapter is one such step — it must not embed knowledge of other adapters or of workspace interaction.
