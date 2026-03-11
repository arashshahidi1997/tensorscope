# Prompt 31: Channel Grid Renderer

Read first:

- [00_context.md](./00_context.md)
- [30_spatial_layout_model.md](./30_spatial_layout_model.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: create a reusable `ChannelGridRenderer`.

Scope:

- render electrodes as grid cells
- color cells by signal value
- hover highlighting

Implementation Tasks:

- define the reusable renderer boundary for spatial grid views
- specify how signal values map to cell colors
- define hover-highlighting behavior
- keep the renderer aligned with the spatial layout model

Constraints:

- must work using Canvas first
- must be compatible with future WebGL acceleration
- do not couple renderer logic directly to other views

Acceptance Criteria:

- electrode grid renders correctly and updates with new data
- color mapping and hover behavior are explicit
- the renderer can evolve behind a later backend abstraction

Deliverables:

- prompt-ready renderer contract for channel-grid rendering
- bounded implementation target for one agent run
