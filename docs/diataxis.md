# Diataxis Map For TensorScope

TensorScope already has the directory shape for Diataxis:

- `tutorials/`
- `how-to/`
- `reference/`
- `explanation/`

What was missing was the TensorScope-specific guidance for what belongs in each quadrant.

## Working rule

Choose the document type by the reader's need, not by the subsystem being described.

- Tutorials are for learning by doing.
- How-to guides are for completing one concrete task.
- Reference is for factual lookup.
- Explanation is for understanding why the system is shaped the way it is.

## What belongs where in TensorScope

### Tutorials

Use tutorials for guided first contact with the product and repo. A tutorial should assume the reader is still learning the workflow and should produce a visible result.

Good TensorScope tutorial candidates:

- start the demo server and open the workspace
- load `data/demo_lfp.nc` and inspect linked views
- trace one interaction from shared selection to rendered slice
- add a simple new view end to end with a guided implementation path

### How-to guides

Use how-to guides for operator and contributor tasks with a clear success condition.

Good TensorScope how-to candidates:

- run the backend or full dev UI locally
- generate or refresh the demo dataset
- debug a broken tensor slice request
- add a new backend endpoint
- register a frontend view
- inspect session state or processing parameters

### Reference

Use reference for stable facts, wire contracts, schemas, commands, and invariants. Reference should be scannable and should avoid teaching prose.

Good TensorScope reference candidates:

- CLI command reference for `tensorscope serve`
- API endpoint and DTO reference
- selection state schema
- view registry rules
- supported tensor dims and metadata expectations
- transform DAG and pipeline export formats

### Explanation

Use explanation for design intent, tradeoffs, and architecture. This is where TensorScope should explain why it is tensor-centric, why shared selection is the coordination contract, and why the rendering stack is CPU-first today.

Good TensorScope explanation candidates:

- tensor-centric workspace model
- shared selection versus view-local state
- why the server returns Arrow IPC slices
- why `uPlot` is used for hot timeseries paths
- why slot-based layout is preserved
- milestone-driven architecture direction from M1 to M9

## Existing docs mapped into Diataxis

Current best fit of the existing docs:

- `explanation`: `architecture/tensorscope.md`, `architecture/invariants.md`, `architecture/transform-dag.md`, `architecture/pipeline-export.md`, `design/ui-layout-concepts.md`, ADRs in `adr/`
- `reference`: `api/openapi.yaml`, `api/phase2.md` once split into endpoint and DTO lookup pages, any future CLI/API/schema pages
- `tutorials`: currently underfilled
- `how-to`: currently underfilled

## What not to force into Diataxis

Some docs in this repo are internal engineering artifacts rather than user-facing product docs:

- `prompts/`
- `log/`
- `research/`
- `reference-studies/`

Keep those collections, but do not treat them as substitutes for tutorials, how-to guides, reference, or explanation. They support engineering work; they are not the main documentation experience.

## Immediate doc gaps

The highest-value missing pages are:

1. A beginner tutorial that starts the demo app and explains the main linked views.
2. A how-to guide for running backend, frontend, and full-stack dev workflows.
3. A reference page for the backend API and DTOs.
4. A reference page for frontend and backend view registration.
5. An explanation page that summarizes the end-to-end data flow from selection mutation to rendered slice.
