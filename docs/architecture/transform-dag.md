# Transform DAG And Workspace Graph

Role: practical architecture note for lineage, graph inspection, and workspace DAG behavior.

Read with:

- [TensorScope architecture](./tensorscope.md)
- [Architecture invariants](./invariants.md)
- [Pipeline export](./pipeline-export.md)
- [Prompt roadmap](../prompts/roadmap.md)

## Why TensorScope needs an explicit transform graph

M4 makes transforms and derived tensors explicit. That is necessary but not sufficient once the workspace contains multiple derived products, alternative parameterizations, and intermediate analysis steps.

TensorScope needs an explicit transform graph so the system can:

- explain where every derived tensor came from
- show which transforms connect source tensors to downstream views
- distinguish temporary exploratory results from stable curated results
- support inspection, parameter editing, and later export without hiding logic inside views

Without an explicit graph, provenance stays implicit inside ad hoc compute code and the workspace becomes hard to inspect.

## Core graph concepts

The graph should distinguish four concepts clearly.

### Source tensors

Source tensors are the tensors loaded into the workspace from the session or dataset.

They are graph roots. They are not created by workspace transforms.

### Derived tensors

Derived tensors are tensor products created from one or more inputs through an explicit transform.

They remain tensors in the `TensorRegistry`, but they also appear as graph nodes with lineage.

### Transforms

Transforms are registered analysis operations defined by the `TransformRegistry`.

They describe:

- required input tensor schemas
- parameters
- output tensor schemas
- provenance requirements

Transforms are not views and they are not arbitrary graph widgets. They are the typed analysis steps that connect source tensors to derived tensors.

### Graph edges

Graph edges encode lineage between tensor nodes and transform nodes.

The intended pattern is:

`source tensor -> transform -> derived tensor`

This keeps tensor identity separate from transform identity and avoids collapsing data objects and analysis operations into the same node type.

## Why the graph should be visible in the UI

The graph should be visible because TensorScope is an exploration workspace, not only a rendering surface.

Users need to see:

- which derived tensors are currently in play
- which transforms produced them
- which parameter choices shaped those results
- which intermediate tensors are worth displaying or inspecting

UI visibility also makes provenance auditable. A spectrogram or coherence map should not appear as if it were a raw tensor when it is actually the result of a specific transform chain.

## Why this is not a freeform workflow editor

The workspace graph is not the same as a general node editor.

TensorScope should not encourage arbitrary drag-and-drop workflow authoring at this stage. The graph is primarily for:

- lineage inspection
- visibility control
- parameter review and bounded editing
- promotion of useful nodes into a later exportable pipeline

That means:

- graph structure follows registered transforms and tensor compatibility rules
- nodes are typed by TensorScope contracts
- the UI is inspection-first, not canvas-first
- the user is not building an unrestricted workflow language in the browser

## Workspace DAG versus pipeline DAG

TensorScope needs two related but distinct DAG concepts.

### Workspace DAG

The workspace DAG is exploratory, interactive, and temporary.

It may include:

- experimental parameter variants
- intermediate tensors surfaced only for inspection
- abandoned branches
- virtual nodes that are defined but not yet computed

This graph supports interactive analysis inside the viewer.

### Pipeline DAG

The pipeline DAG is curated, exportable, and executable.

It is a selected subset of the workspace graph whose nodes have been promoted into a durable execution description. It should exclude accidental or purely exploratory branches.

M5 is about the workspace DAG.
M6 is about promotion from workspace DAG to pipeline DAG and export of that curated result.

## Node states

Workspace nodes should carry explicit state so the UI and export layer can reason about them.

### Virtual

The node is defined in the graph but its tensor output has not yet been computed.

This is useful for:

- parameter staging
- showing intended lineage before execution
- distinguishing declared analysis steps from computed results

### Computed

The node has been executed and its output tensor is available in memory or cache for inspection and rendering.

### Materialized

The node output has been persisted or marked as durable beyond the transient workspace cache.

Materialized does not by itself mean pipeline-exported, but it signals a stronger persistence boundary than a temporary computed result.

## Intended UI concepts

M5 should stay practical and inspectable.

### Lineage tree

A focused tensor or transform should expose its upstream and downstream lineage as a readable tree or graph view.

### Node toggles for display

Users should be able to toggle whether a node is surfaced in the workspace without deleting it from provenance.

Visibility affects presentation, not lineage.

### Node inspection

Selecting a node should show:

- node type
- tensor schema or transform descriptor
- provenance summary
- status such as virtual, computed, or materialized

### Parameter editing

Transform parameters should be reviewable and, where allowed, editable from inspection surfaces. Parameter edits should remain bounded by transform contracts rather than turning the graph into a freeform editor.

### Pipeline promotion

Useful nodes should be promotable from exploratory workspace state into curated pipeline state. Promotion belongs at the boundary between M5 and M6.

## Relationship to existing registries

The graph complements existing registries rather than replacing them.

### TensorRegistry

`TensorRegistry` remains the canonical store for tensor objects and tensor metadata.

The graph references tensor nodes in the registry and adds lineage structure around them.

### TransformRegistry

`TransformRegistry` remains the canonical source of transform definitions.

The graph instantiates registered transforms as nodes connected to concrete tensor inputs and outputs.

### ViewRegistry

`ViewRegistry` still decides which views can render which tensor schemas.

The transform DAG does not replace view compatibility logic. Instead, it gives views and inspectors a transparent way to explain where a renderable tensor came from.

## Milestone placement

### M4 foundation

M4 must establish:

- explicit transform definitions
- derived tensor contracts
- provenance metadata

That is the foundation the graph relies on.

### M5 DAG UI and workspace graph

M5 should add:

- explicit graph primitives
- lineage queries
- graph inspection UI
- node visibility and inspection rules

M5 should stop short of workflow export. Export belongs to [pipeline-export.md](./pipeline-export.md) and the M6 milestone.
