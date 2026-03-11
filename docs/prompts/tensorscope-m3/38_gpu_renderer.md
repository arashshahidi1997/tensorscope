# Prompt 38: GPU Renderer

Read first:

- [00_context.md](./00_context.md)
- [31_channel_grid_renderer.md](./31_channel_grid_renderer.md)
- [34_propagation_view.md](./34_propagation_view.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)
- [../../architecture/invariants.md](../../architecture/invariants.md)

Goal: prepare optional GPU rendering for spatial views.

Scope:

- renderer abstraction
- WebGL renderer option
- fallback Canvas renderer

Implementation Tasks:

- define the minimum renderer abstraction needed for spatial views
- describe how a WebGL option can sit beside the CPU/Canvas path
- specify fallback behavior and backend choice rules
- keep current spatial view semantics independent from backend details

Constraints:

- do not require GPU
- CPU path must remain fully functional
- do not over-abstract the renderer before the spatial-view contracts are stable

Acceptance Criteria:

- renderer abstraction allows spatial views to choose Canvas or WebGL backend
- fallback CPU path remains intact
- backend separation does not break earlier spatial-view contracts

Deliverables:

- prompt-ready spatial-renderer abstraction spec
- bounded implementation target for optional GPU acceleration
