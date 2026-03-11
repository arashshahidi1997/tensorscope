# TensorScope M3 Prompt Pack

Milestone: M3 - Spatial Dynamics And Propagation

Read first:

- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)
- [../../architecture/invariants.md](../../architecture/invariants.md)
- [../context_snapshot.md](../context_snapshot.md)
- [../README.md](../README.md)
- [../tensorscope-m2/README.md](../tensorscope-m2/README.md)

## Milestone purpose

M3 adds spatial exploration of neural signals after M2 provides scalable data access and linked scientific views.

Primary focus:

- electrode geometry and spatial layout
- spatial activity maps
- propagation animations
- phase and power maps
- spatial brushing and selection
- optional GPU acceleration around a CPU-first baseline

## What must already exist

- M1 architecture boundaries should be stable
- M2 data-access and scientific-view contracts should be stable enough to extend
- shared navigation state should already be the coordination mechanism
- architecture and context docs should reflect the post-M2 state

## What this milestone should produce

- a spatial model for electrode layouts
- reusable spatial rendering and selection contracts
- linked spatial exploration with timeseries and spectrogram views
- propagation and event-centered spatial views
- renderer separation that keeps Canvas viable while allowing future GPU work

## Prompt order

1. [00_context.md](./00_context.md)
2. [30_spatial_layout_model.md](./30_spatial_layout_model.md)
3. [31_channel_grid_renderer.md](./31_channel_grid_renderer.md)
4. [32_spatial_selection.md](./32_spatial_selection.md)
5. [33_phase_power_maps.md](./33_phase_power_maps.md)
6. [34_propagation_view.md](./34_propagation_view.md)
7. [35_animation_controller.md](./35_animation_controller.md)
8. [36_spatial_linking.md](./36_spatial_linking.md)
9. [37_spatial_event_views.md](./37_spatial_event_views.md)
10. [38_gpu_renderer.md](./38_gpu_renderer.md)

## Recommended workflow for agents

1. Read the architecture doc, invariants, context snapshot, and this README.
2. Confirm M2 assumptions still hold before starting M3 work.
3. Start from [00_context.md](./00_context.md) and then [30_spatial_layout_model.md](./30_spatial_layout_model.md).
4. Keep one bounded spatial concern per run.
5. Update architecture/context docs if M3 changes state, renderer, or linking assumptions.

## M3 guardrails

- spatial views must integrate with shared `SelectionState`
- spatial views must not invent separate cross-view coordination mechanisms
- views must not call each other directly
- rendering hot paths must stay outside React rerender loops
- CPU-first rendering remains required
- GPU acceleration stays optional and must not break the CPU path

## Exit criteria

Treat M3 as done when:

- electrode layouts and spatial rendering contracts are explicit
- spatial selection and linking work through shared navigation state
- propagation and event-centered spatial views are operational
- optional GPU support fits behind a renderer abstraction without replacing the CPU baseline
