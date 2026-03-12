# Prompt 60: Pipeline State Schema

Read first:

- [00_context.md](./00_context.md)
- [../tensorscope-m5/50_dag_model.md](../tensorscope-m5/50_dag_model.md)
- [../tensorscope-m5/53_visibility_controls.md](../tensorscope-m5/53_visibility_controls.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: define the pipeline state schema — the serialized specification that represents a curated subset of the workspace DAG as a durable, reproducible pipeline document.

Scope:

- pipeline document structure
- source tensor declarations
- promoted transform declarations
- parameter snapshots
- derived tensor declarations
- declared outputs
- execution metadata

Implementation Tasks:

- define the top-level pipeline document schema: `{ version, name, source_tensors, transforms, derived_tensors, outputs, execution_metadata }`
- specify `source_tensors`: list of base tensor ids and their data source references (file path, session key, or data source URI)
- specify `transforms`: list of promoted `TransformNode` entries, each with `{ transform_id, params, inputs: [tensor_id], output: tensor_id }`; parameters are the `toJSON()` snapshot from the M4 `DerivedTensor.params`
- specify `derived_tensors`: list of all promoted derived tensor ids and their coordinate schemas
- specify `outputs`: list of tensor ids designated as final pipeline outputs; these are the tensors a downstream consumer (Snakemake rule, notebook) is expected to read
- specify `execution_metadata`: `{ created_at, session_id, description }` — human-readable context for the pipeline run
- keep the schema human-readable YAML/JSON; avoid binary formats that obscure intent

Constraints:

- only curated (non-exploratory) nodes from the M5 DAG enter the pipeline schema
- the schema must be reproducible: given the same source tensors and parameters, re-running the pipeline must produce bit-identical derived tensors
- the schema is a snapshot, not a live link to the workspace DAG; it must not require the workspace session to be active
- execution metadata belongs in the export schema, not in the shared navigation state

Acceptance Criteria:

- the pipeline schema covers all required fields with explicit types
- only curated DAG nodes are included; exploratory nodes are absent
- the schema is human-readable and round-trippable (serialize → deserialize → re-serialize produces identical output)

Deliverables:

- prompt-ready pipeline state schema spec
- explicit field types and serialization rules

## Reference

Perspective's two-level `save()` / `restore()` pattern (`packages/workspace/src/ts/workspace/workspace.ts`) is the right model: each node provides its own `save()` output (the `toJSON()` snapshot from M4); the pipeline schema aggregates all node snapshots plus layout into a single document. The `AsyncMutex` pattern for concurrent save/restore prevents partial schema writes.

See [docs/reference-studies/perspective.md §2c](../../reference-studies/perspective.md).

Neuroglancer's `Trackable` interface `toJSON()` / `restoreState()` contract (`src/trackable_value.ts`) is the per-node serialization primitive. Every promoted `TransformNode` and `TensorNode` already satisfies this contract from M4/M5 — the pipeline schema is the aggregation layer on top.

See [docs/reference-studies/neuroglancer.md §4.3](../../reference-studies/neuroglancer.md).
