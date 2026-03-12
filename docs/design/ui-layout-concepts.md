# UI Layout Concepts

These layout concepts are exploratory and not yet part of the official architecture.

Role: design exploration note for possible TensorScope workspace layouts.

Use this file for:

- candidate UI layout patterns
- possible workspace regions
- speculative navigation structures
- future layout experiments

Do not use this file as a source of architectural requirements. For confirmed architecture, use [../architecture/tensorscope.md](../architecture/tensorscope.md) and [../architecture/invariants.md](../architecture/invariants.md).

## 1. General layout philosophy

TensorScope is a multi-view scientific exploration environment rather than a single-chart application.

A useful comparison set is:

- VS Code
- JupyterLab
- Grafana

Those tools suggest that a dockable multi-panel workspace may be a good fit for TensorScope, especially when users need to inspect tensors, compare multiple synchronized views, and move between exploratory analysis and more structured workflow tasks.

This is still under evaluation. The goal of this note is to capture candidate layout directions without locking the product into a finalized shell.

## 2. Proposed UI regions

One possible design is a five-region layout:

- top bar
- left sidebar
- center workspace
- right inspector
- bottom panel

Possible responsibilities:

### Top bar

- dataset or tensor selection
- layout presets
- global navigation state
- session or workspace identity

### Left sidebar

- navigation tabs
- tensor browsing
- transform graph access
- pipeline tools

### Center workspace

- scientific visualizations
- multi-view dockable panels
- synchronized exploration surfaces

### Right inspector

- inspectors for selected items
- node parameters
- view configuration
- metadata summaries

### Bottom panel

- timeline navigation
- event lists
- computation logs
- task-specific status surfaces

Candidate diagram:

```text
+----------------------------------------------------------------------------------+
| Top Bar: dataset/tensor selection | layout presets | global navigation state     |
+------------------------+--------------------------------------+--------------------+
| Left Sidebar           | Center Workspace                     | Right Inspector    |
|                        |                                      |                    |
| Explore                |  dockable scientific views           | selected node      |
| Graph                  |  synchronized panels                 | parameters         |
| Tensors                |  traces / spectrogram / spatial      | view config        |
| Events                 |  map / tables / state-space          | metadata           |
| Pipeline               |                                      |                    |
+------------------------+--------------------------------------+--------------------+
| Bottom Panel: timeline navigation | event lists | computation logs               |
+----------------------------------------------------------------------------------+
```

This should be treated as a candidate layout, not a requirement.

## 3. Navigation tabs concept

One possible left-sidebar tab structure is:

- Explore
- Graph
- Tensors
- Events
- Pipeline

Possible meanings:

### Explore

A general entry point for common viewing tasks, layout presets, and high-level workspace actions.

### Graph

A place to inspect the exploration DAG, lineage tree, or transform relationships between tensors.

### Tensors

A browser for available source tensors and derived tensors, including schema or metadata summaries.

### Events

A task-focused surface for event lists, interval browsing, and event-centric navigation.

### Pipeline

A later-stage surface for curated workflow state, export actions, or reproducibility-oriented tools.

This is only a candidate UI structure. The final shell may combine or rename these tabs.

## 4. Workspace layout ideas

The center workspace may eventually support dockable views, similar to:

- VS Code panels
- JupyterLab layout
- Grafana dashboards

Possible features:

- multiple synchronized views
- resizable panels
- drag-to-rearrange layout
- layout presets

This would fit TensorScope's multi-view exploration model, where a user may want to compare traces, spectrograms, spatial maps, tables, and inspectors at the same time.

Layout persistence may be represented as JSON workspace configs. That would allow the system to restore a previous arrangement or switch between task-oriented presets without treating the layout as a hard-coded shell.

## 5. Graph vs Pipeline panels

It is useful to keep a conceptual distinction between:

- Graph: exploration DAG
- Pipeline: curated reproducible workflow

The Graph surface would focus on interactive lineage and temporary workspace structure.

The Pipeline surface would focus on promoted, curated, exportable workflow state.

These may appear as separate tabs or separate modes in the same sidebar.

Short example:

- In `Graph`, a user might inspect two alternative spectrogram parameter branches and keep both temporarily visible.
- In `Pipeline`, the user might promote only one branch as the reproducible workflow to export later.

This distinction matters because exploratory graph state and durable pipeline state should not be treated as the same thing, even if they share some underlying nodes.

## 6. Future UI experiments

Possible future experiments include:

- lineage tree view for the transform DAG
- optional graph visualization mode
- command palette
- task-specific workspace layouts

Candidate task-oriented layouts:

- Signal inspection
- Event inspection
- Spatial propagation
- Pipeline authoring

These should be treated as exploratory ideas for future UI work, not as committed product decisions.

## 7. Relationship to roadmap milestones

These layout ideas likely evolve alongside the later milestones:

- M4: derived tensors and transform registry
- M5: transform DAG and graph UI
- M6: pipeline export

The layout should therefore be expected to change as those milestones clarify what needs to be visible in the workspace, what belongs in inspection surfaces, and what becomes part of a curated pipeline workflow.

For roadmap context, see [../prompts/roadmap.md](../prompts/roadmap.md).
