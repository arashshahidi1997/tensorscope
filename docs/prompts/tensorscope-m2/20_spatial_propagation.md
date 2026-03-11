# Prompt 20: Spatial Propagation

Read first:

- [00_context.md](./00_context.md)
- [16_channel_grid_view.md](./16_channel_grid_view.md)
- [19_perievent_views.md](./19_perievent_views.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: prepare propagation visualization infrastructure.

Scope:

- time animation controller
- spatial overlay pipeline
- frame-based updates

Implementation Tasks:

- define the minimal propagation-view infrastructure for M2
- specify time-animation ownership and controls
- define the overlay/frame contract for spatial updates across electrodes
- keep the design aligned with peri-event and channel-grid work

Constraints:

- CPU implementation first
- do not require WebGL for the first usable version
- keep animation updates outside expensive React rerender loops

Acceptance Criteria:

- spatial activity can animate across electrodes
- frame update boundaries are explicit
- the propagation scaffold can evolve toward richer renderers later

Deliverables:

- scoped propagation prompt
- explicit CPU-first animation and overlay contract
