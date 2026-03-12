# Prompt 62: Workflow Cooking

Read first:

- [00_context.md](./00_context.md)
- [60_pipeline_state_schema.md](./60_pipeline_state_schema.md)
- [61_node_promotion.md](./61_node_promotion.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: define the workflow cooking adapter that translates a curated pipeline state schema into a Snakemake-compatible workflow specification.

Scope:

- schema-to-Snakemake translation rules
- rule naming and output file conventions
- parameter injection
- adapter interface for future cooking targets

Implementation Tasks:

- define the `WorkflowCooker` interface: `cook(schema: PipelineSchema) → WorkflowSpec`; the interface is adapter-agnostic so future cooking targets (Nextflow, Python script) can be added without modifying the pipeline schema
- specify Snakemake translation rules: each promoted `TransformNode` becomes one Snakemake rule; rule name = `transform_id`; `input:` = source tensor file paths; `output:` = derived tensor file paths following a convention (`{output_dir}/{transform_id}/{tensor_id}.zarr` or similar); `params:` = the `params` snapshot from `toJSON()`
- specify how `source_tensors` map to Snakemake `input:` blocks: base tensors reference file paths that must be provided to the workflow at run time; they are not auto-discovered
- specify that the cooker is a pure function: `cook(schema)` produces a `WorkflowSpec` string without side effects; it does not write files, submit jobs, or modify workspace state
- define the output file naming convention: consistent with the pipeline schema's `tensor_id` values so the schema's `outputs` list can be used to locate Snakemake output files without additional mapping

Constraints:

- the cooker must not couple the pipeline schema format to Snakemake specifically — the schema is the stable interface; the Snakemake adapter is one implementation
- the pipeline export must not replace the interactive workspace; the cooker reads from the schema, not from live workspace state
- cooking produces a text specification; TensorScope does not run Snakemake directly

Acceptance Criteria:

- `WorkflowCooker` interface is defined with explicit input/output types
- Snakemake translation rules are specified (transform → rule, tensor → file)
- the cooker is a pure function with no side effects
- the adapter interface allows future cooking targets without schema changes

Deliverables:

- prompt-ready workflow cooking spec
- explicit Snakemake translation rules and adapter interface

## Reference

The adapter pattern is the only safe coupling point between the pipeline schema and Snakemake. If the cooking logic bleeds into the graph model, you are locked into Snakemake. Keep cooking in a thin `SnakemakeAdapter` class that implements `WorkflowCooker` and can be replaced with a `NextflowAdapter` or `ScriptAdapter` without touching the schema or graph model.

Observable Plot's `composeTransform` composability provides the right model for the adapter pipeline: `cook = compose(validateSchema, generateRules, renderTemplate)`. Each step is independently testable and the composition is explicit.

See [docs/reference-studies/observable-plot.md §4.2](../../reference-studies/observable-plot.md).
