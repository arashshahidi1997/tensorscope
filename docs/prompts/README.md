# TensorScope Prompt Docs

Use these docs together, not interchangeably.

## File roles

- [roadmap.md](./roadmap.md): human planning, milestone ordering, future direction
- [../architecture/tensorscope.md](../architecture/tensorscope.md): current architecture, near-term target, guardrails, open design questions
- [context_snapshot.md](./context_snapshot.md): current repo status and handoff context for a new agent session
- [agent_runbook.md](./agent_runbook.md): operating guide for safe, repeatable coding-agent sessions
- [prompt_registry.md](./prompt_registry.md): catalog of all current agent prompts across milestone packs
- [task_status.md](./task_status.md): lightweight manual tracker for prompt execution status
- [`templates/`](./templates/): reusable note templates for handoffs, session summaries, and architecture-change notes
- [M1 prompt pack](./tensorscope/README.md): linked multiscale explorer milestone
- [M2 prompt pack](./tensorscope-m2/README.md): data scalability and scientific-view milestone

## How to use these docs with agents

Recommended flow for a coding session:

1. Read [../architecture/tensorscope.md](/storage2/arash/projects/tensorscope/docs/architecture/tensorscope.md).
2. Read [../architecture/invariants.md](/storage2/arash/projects/tensorscope/docs/architecture/invariants.md) before major architecture changes.
3. Read [context_snapshot.md](/storage2/arash/projects/tensorscope/docs/prompts/context_snapshot.md).
4. Choose one scoped task in [`tensorscope/`](./tensorscope/00_context.md).
5. Inspect the referenced code before editing.
6. Make one bounded change set.
7. If the architecture or milestone state changed materially, update the architecture doc and context snapshot in the same session.

## Safe task execution expectations

- plan before editing
- inspect the relevant modules first
- keep prompts single-run sized
- document current reality, not intended future state
- prefer linking to existing docs instead of restating them

## Recommended prompt order

Milestone index:

- [M1 README](./tensorscope/README.md)

1. [00_context.md](./tensorscope/00_context.md)
2. [01_types.md](./tensorscope/01_types.md)
3. [02_selection_store.md](./tensorscope/02_selection_store.md)
4. [03_workspace_shell.md](./tensorscope/03_workspace_shell.md)
5. [04_timeseries_view.md](./tensorscope/04_timeseries_view.md)
6. [05_gesture_toolbar.md](./tensorscope/05_gesture_toolbar.md)
7. [06_overview_detail.md](./tensorscope/06_overview_detail.md)
8. [07_event_track.md](./tensorscope/07_event_track.md)
9. [08_registries.md](./tensorscope/08_registries.md)
10. [09_inspector.md](./tensorscope/09_inspector.md)
11. [10_docs.md](./tensorscope/10_docs.md)
12. [11_m1_integration.md](./tensorscope/11_m1_integration.md)

This order is guidance, not a hard dependency chain. Skip ahead only when the earlier contract is already stable in code.

## Prompt Pack M2: Data And Scientific Views

Milestone index:

- [M2 README](./tensorscope-m2/README.md)

M1 builds the architectural spine.
M2 introduces scalable data handling and scientific visualizations.

M2 lives in [`docs/prompts/tensorscope-m2/`](./tensorscope-m2/00_context.md) and focuses on:

- multiscale data access
- LOD and worker-backed aggregation
- linked scientific views such as spectrogram, channel grid, event browser, and peri-event views
- CPU-first rendering that can later accommodate optional GPU paths

Recommended M2 order:

1. [00_context.md](./tensorscope-m2/00_context.md)
2. [12_data_source.md](./tensorscope-m2/12_data_source.md)
3. [13_lod_pipeline.md](./tensorscope-m2/13_lod_pipeline.md)
4. [14_worker_downsampling.md](./tensorscope-m2/14_worker_downsampling.md)
5. [15_spectrogram_view.md](./tensorscope-m2/15_spectrogram_view.md)
6. [16_channel_grid_view.md](./tensorscope-m2/16_channel_grid_view.md)
7. [17_linked_crosshair.md](./tensorscope-m2/17_linked_crosshair.md)
8. [18_event_browser.md](./tensorscope-m2/18_event_browser.md)
9. [19_perievent_views.md](./tensorscope-m2/19_perievent_views.md)
10. [20_spatial_propagation.md](./tensorscope-m2/20_spatial_propagation.md)
11. [21_renderer_abstraction.md](./tensorscope-m2/21_renderer_abstraction.md)

## Prompt Pack M3: Spatial Dynamics

Milestone index:

- [M3 README](./tensorscope-m3/README.md)

M3 adds spatial exploration capabilities after M2 provides scalable data access and linked scientific views.

M3 lives in [`docs/prompts/tensorscope-m3/`](./tensorscope-m3/00_context.md) and focuses on:

- electrode geometry and spatial layouts
- spatial activity maps
- propagation and animation views
- phase and power maps
- spatial brushing and selection
- optional GPU acceleration behind a CPU-first path

Recommended M3 order:

1. [00_context.md](./tensorscope-m3/00_context.md)
2. [30_spatial_layout_model.md](./tensorscope-m3/30_spatial_layout_model.md)
3. [31_channel_grid_renderer.md](./tensorscope-m3/31_channel_grid_renderer.md)
4. [32_spatial_selection.md](./tensorscope-m3/32_spatial_selection.md)
5. [33_phase_power_maps.md](./tensorscope-m3/33_phase_power_maps.md)
6. [34_propagation_view.md](./tensorscope-m3/34_propagation_view.md)
7. [35_animation_controller.md](./tensorscope-m3/35_animation_controller.md)
8. [36_spatial_linking.md](./tensorscope-m3/36_spatial_linking.md)
9. [37_spatial_event_views.md](./tensorscope-m3/37_spatial_event_views.md)
10. [38_gpu_renderer.md](./tensorscope-m3/38_gpu_renderer.md)

## Prompt Pack M4: Analysis And Derived Tensors

Milestone index:

- [M4 README](./tensorscope-m4/README.md)

M4 transforms TensorScope from a viewer into an interactive analysis environment by making transforms and derived tensors explicit system objects.

M4 lives in [`docs/prompts/tensorscope-m4/`](./tensorscope-m4/00_context.md) and focuses on:

- transform registration and discovery
- derived tensor provenance and compatibility
- explicit analysis outputs such as spectrogram, PSD, band power, coherence, and event-aligned tensors
- worker-based computation
- transform caching and reuse

Recommended M4 order:

1. [00_context.md](./tensorscope-m4/00_context.md)
2. [40_transform_registry.md](./tensorscope-m4/40_transform_registry.md)
3. [41_derived_tensor_model.md](./tensorscope-m4/41_derived_tensor_model.md)
4. [42_spectrogram_tensor.md](./tensorscope-m4/42_spectrogram_tensor.md)
5. [43_psd_tensor.md](./tensorscope-m4/43_psd_tensor.md)
6. [44_bandpower_tensor.md](./tensorscope-m4/44_bandpower_tensor.md)
7. [45_coherence_tensor.md](./tensorscope-m4/45_coherence_tensor.md)
8. [46_event_aligned_tensor.md](./tensorscope-m4/46_event_aligned_tensor.md)
9. [47_state_space_view.md](./tensorscope-m4/47_state_space_view.md)
10. [48_computation_workers.md](./tensorscope-m4/48_computation_workers.md)
11. [49_transform_cache.md](./tensorscope-m4/49_transform_cache.md)

## Future Scaffolded Packs

These packs are placeholders only. They reserve milestone boundaries and high-level themes, but they are not ready to execute yet.

- [M5 README](./tensorscope-m5/README.md): Agentic Exploration
- [M5 context placeholder](./tensorscope-m5/00_context.md)
