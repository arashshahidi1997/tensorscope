# Prompt 33: Phase And Power Maps

Read first:

- [00_context.md](./00_context.md)
- [31_channel_grid_renderer.md](./31_channel_grid_renderer.md)
- [32_spatial_selection.md](./32_spatial_selection.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: visualize spatial maps of signal features.

Scope:

- band power
- phase maps
- feature overlays

Implementation Tasks:

- define the view/data contract for spatial feature maps
- specify how band power and phase values map onto spatial layouts
- define overlay behavior for derived feature layers
- keep updates tied to the active time window and shared navigation state

Constraints:

- do not treat derived feature maps as unrelated to the shared selection model
- keep feature-layer semantics explicit
- preserve a CPU-first rendering path

Acceptance Criteria:

- spatial heatmaps update based on time window
- band power and phase mapping rules are explicit
- overlays fit within the existing spatial renderer direction

Deliverables:

- scoped prompt for spatial feature-map implementation
- explicit derived-feature mapping contract
