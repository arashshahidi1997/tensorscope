# Prompt 32: Spatial Selection

Read first:

- [00_context.md](./00_context.md)
- [30_spatial_layout_model.md](./30_spatial_layout_model.md)
- [31_channel_grid_renderer.md](./31_channel_grid_renderer.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: support spatial selection of electrodes.

Scope:

- click electrode
- multi-select electrodes
- brush spatial region

Implementation Tasks:

- define the shared-state representation for spatial selections
- specify single-select, multi-select, and brush behavior
- describe how spatial selection updates downstream linked views
- keep the contract compatible with current `SelectionState` direction

Constraints:

- selections must update the shared `SelectionState`
- do not create a separate spatial-only coordination mechanism
- keep selection semantics explicit and bounded

Acceptance Criteria:

- selecting an electrode highlights corresponding timeseries channel
- multi-select and region selection behavior are defined
- spatial selection remains aligned with shared navigation state

Deliverables:

- prompt-ready spatial-selection contract
- explicit single-select and multi-select behavior
