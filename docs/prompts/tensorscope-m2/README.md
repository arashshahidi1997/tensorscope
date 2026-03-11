# TensorScope M2 Prompt Pack

Milestone: M2 - Data And Linked Scientific Views

Read first:

- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)
- [../context_snapshot.md](../context_snapshot.md)
- [../README.md](../README.md)
- [../tensorscope/README.md](../tensorscope/README.md)

## Milestone purpose

M2 extends TensorScope beyond the M1 architectural spine into scalable data handling and core scientific views.

Primary focus:

- chunked and asynchronous data access
- LOD-aware rendering
- worker-backed aggregation
- linked scientific views such as spectrogram, channel grid, event browser, and peri-event views
- renderer separation that remains CPU-first

## What must already exist

- M1 architectural boundaries should be in place
- shared navigation concepts should already be established
- the workspace shell and linked-view basics should already exist
- architecture and context docs should reflect the post-M1 state

## What this milestone should produce

- large-recording interaction that remains usable
- explicit data-access and decimation contracts
- first real scientific view implementations
- reusable cursor, event, and rendering contracts for later milestones

## Prompt order

1. [00_context.md](./00_context.md)
2. [12_data_source.md](./12_data_source.md)
3. [13_lod_pipeline.md](./13_lod_pipeline.md)
4. [14_worker_downsampling.md](./14_worker_downsampling.md)
5. [15_spectrogram_view.md](./15_spectrogram_view.md)
6. [16_channel_grid_view.md](./16_channel_grid_view.md)
7. [17_linked_crosshair.md](./17_linked_crosshair.md)
8. [18_event_browser.md](./18_event_browser.md)
9. [19_perievent_views.md](./19_perievent_views.md)
10. [20_spatial_propagation.md](./20_spatial_propagation.md)
11. [21_renderer_abstraction.md](./21_renderer_abstraction.md)

## Recommended workflow for agents

1. Read the architecture doc, context snapshot, and this README.
2. Confirm M1 assumptions still hold before starting M2 work.
3. Start from [00_context.md](./00_context.md) and then [12_data_source.md](./12_data_source.md).
4. Keep one bounded data/view concern per run.
5. Sync architecture/context docs if M2 changes milestone assumptions.

## M2 guardrails

- keep shared navigation state as the coordination mechanism
- views must not call each other directly
- CPU-first rendering is required
- GPU acceleration stays optional
- data-access layers must not force full tensor loads into interactive views
- keep hover and rendering hot paths outside React rerender loops
- do not weaken M1 architectural boundaries while adding scalability and scientific views

## Exit criteria

Treat M2 as done when:

- larger recordings stay interactive through chunking and LOD-aware access
- core scientific views are linked through shared state
- event browsing and peri-event exploration are operational
- renderer contracts are clear enough to support future CPU/GPU evolution without rewriting view semantics
