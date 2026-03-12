# Pipeline Export And Workflow Cooking

Role: practical architecture note for exporting curated transform graphs into reproducible execution workflows.

Read with:

- [TensorScope architecture](./tensorscope.md)
- [Transform DAG](./transform-dag.md)
- [Architecture invariants](./invariants.md)
- [Prompt roadmap](../prompts/roadmap.md)

## Why TensorScope should support export of curated transform graphs

TensorScope is primarily an interactive analysis workspace, but useful exploratory graphs should be promotable into reproducible execution artifacts.

Export matters because it allows the user to:

- preserve a successful analysis path
- separate temporary exploration from durable intent
- hand a curated graph to an execution system
- reproduce outputs outside the live UI session

Without export, the workspace can explain analysis but cannot reliably operationalize it.

## Interactive workspace state versus pipeline export state

These are different states with different purposes.

### Interactive workspace state

Workspace state is exploratory and may contain:

- temporary nodes
- parameter experiments
- hidden branches
- partially computed or virtual nodes
- UI-specific visibility decisions

This state is useful for exploration but too noisy to treat as a durable execution plan.

### Pipeline export state

Pipeline export state is curated and execution-oriented.

It should contain only the subset of the workspace graph that the user intends to reproduce. Export should therefore be explicit, not automatic.

## Pipeline state file

The export artifact should be a pipeline state file, likely JSON or YAML.

This file is not just a session snapshot. It is a durable description of the curated pipeline DAG and the execution intent attached to it.

## Expected contents of a pipeline state file

The state file should capture the minimum information needed for deterministic workflow cooking.

### Source tensors

The file should identify the source tensors the curated pipeline depends on.

### Selected transforms

It should include the promoted transform nodes that define the curated pipeline DAG.

### Parameters

It should record parameter values for each promoted transform so execution does not depend on transient UI state.

### Derived outputs

It should declare the expected derived tensor outputs of those transforms.

### Outputs and materialization hints

It should mark which outputs are intended to be materialized, retained, or treated as final deliverables.

### Cooker profile and execution metadata

It should include the execution metadata needed by the export layer, such as:

- chosen cooker profile
- target workflow system
- execution namespace or profile name
- version or schema metadata

This metadata belongs to export, not to shared navigation state.

## Promotion from workspace DAG to pipeline DAG

Export should operate on promoted nodes, not on the entire exploratory graph.

Promotion means:

- choosing a source tensor or derived tensor branch as worth keeping
- locking in a transform and parameter set for export
- declaring which outputs matter for downstream execution

The resulting pipeline DAG is a curated subset of the workspace DAG. This preserves the difference between exploration and execution.

## Why export should target reproducible execution systems

The export layer should target reproducible workflow systems such as Snakemake.

That gives TensorScope:

- explicit dependency structure
- reproducible parameter capture
- rerunnable materialization logic
- a clean boundary between interactive exploration and batch execution

Snakemake is a practical first target because it already represents DAG execution well and fits TensorScope's broader scientific workflow direction.

## Workflow cooking

Workflow cooking is the translation step from pipeline state file to an execution-system artifact.

The cooker should:

- read the curated pipeline state file
- validate required fields
- translate promoted nodes into workflow steps
- emit execution-ready workflow configuration or code

The cooker should not mutate live workspace state and should not be treated as part of the viewer's core rendering architecture.

## Why this is a later execution-layer milestone

Pipeline export belongs after explicit transforms and a visible workspace DAG.

It is not part of the core viewer because:

- the viewer must remain useful without export
- export depends on stable transform and graph contracts
- execution metadata should not leak into basic navigation and rendering layers

This keeps M4 and M5 focused on interactive analysis architecture, while M6 adds the execution bridge only after those layers are coherent.

## Milestone placement

### After transform DAG and workspace graph

Export depends on the graph concepts introduced in [transform-dag.md](./transform-dag.md), especially the distinction between workspace DAG and pipeline DAG.

### Likely M6

M6 is the right milestone for:

- pipeline state schema
- promotion rules
- execution metadata
- Snakemake cooking

That keeps the core viewer and the execution layer separate but connected.
