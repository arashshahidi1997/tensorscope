# TensorScope Prompt Registry

Use this registry as a quick catalog of the current agent task prompts.

What it is for:

- finding what prompts exist
- seeing which milestone a prompt belongs to
- checking likely prerequisites before starting a task
- identifying the main subsystems a prompt is likely to affect

How to use it:

1. Read [../architecture/tensorscope.md](../architecture/tensorscope.md).
2. Read [context_snapshot.md](./context_snapshot.md).
3. Use the milestone READMEs for pack-level order:
   - [M1 README](./tensorscope/README.md)
   - [M2 README](./tensorscope-m2/README.md)
4. Use this registry to pick one bounded prompt for the next agent run.

Status notes:

- `planned`: the prompt exists, but no completion state is asserted here
- `active`: reserved for future manual updates
- `done`: reserved for future manual updates when completion is explicitly documented
- `unknown`: use when completion cannot be inferred safely

## M1 Registry

Milestone: M1 - Linked Multiscale Explorer

| Prompt | Milestone | Title | Purpose | Likely dependencies | Likely affected subsystem(s) | Status |
|---|---|---|---|---|---|---|
| `00_context.md` | M1 | Stable Context | Provides the shared M1 architectural assumptions and workflow rules for future tasks. | architecture doc, context snapshot | docs, architecture guidance | planned |
| `01_types.md` | M1 | Types And Contracts | Defines stable frontend/domain contracts for navigation, tensors, and views. | `00_context.md` | frontend types, API DTO alignment, state contracts | planned |
| `02_selection_store.md` | M1 | Shared Selection Store | Introduces the canonical shared frontend navigation store for linked views. | `01_types.md` | frontend state, navigation model, view coordination | planned |
| `03_workspace_shell.md` | M1 | Workspace Shell | Stabilizes the shell structure around navigation, main workspace, and inspector roles. | `00_context.md`, `02_selection_store.md` | frontend layout shell, panel composition | planned |
| `04_timeseries_view.md` | M1 | Timeseries View Foundation | Hardens the reusable `uPlot`-based timeseries view for linked navigation. | `02_selection_store.md` | timeseries rendering, chart lifecycle, selection integration | planned |
| `05_gesture_toolbar.md` | M1 | Gesture Toolbar | Separates pan/zoom/reset tool control from raw timeseries rendering. | `04_timeseries_view.md` | view-local tool state, timeseries controls | planned |
| `06_overview_detail.md` | M1 | Overview And Detail | Formalizes shared window/cursor behavior between navigator and detail views. | `02_selection_store.md`, `04_timeseries_view.md` | navigator/detail coordination, shared navigation state | planned |
| `07_event_track.md` | M1 | Event Track | Adds the first event-aware navigation path tied to shared state. | `02_selection_store.md`, `06_overview_detail.md` | event navigation, overlays, shared state | planned |
| `08_registries.md` | M1 | Tensor And View Registries | Introduces minimal registry abstractions for tensor metadata and schema-to-view matching. | `01_types.md` | registries, backend/frontend capability mapping | planned |
| `09_inspector.md` | M1 | Inspector Panel | Defines or implements a clearer right-hand inspection/details area. | `03_workspace_shell.md`, `08_registries.md` | inspector UI, selection summary, details panel | planned |
| `10_docs.md` | M1 | Docs Sync | Synchronizes architecture and prompt docs with the implemented M1 shape. | all earlier M1 tasks as needed | docs, architecture docs, prompt docs | planned |
| `11_m1_integration.md` | M1 | M1 Integration | Integrates the M1 shell, state, views, and docs into one coherent linked workspace. | earlier M1 tasks, especially `02`-`10` | cross-cutting M1 integration, docs sync | planned |

## M2 Registry

Milestone: M2 - Data And Linked Scientific Views

| Prompt | Milestone | Title | Purpose | Likely dependencies | Likely affected subsystem(s) | Status |
|---|---|---|---|---|---|---|
| `00_context.md` | M2 | M2 Context | Provides the shared M2 assumptions for scalable data access and scientific views. | M1 completion assumptions, architecture doc, context snapshot | docs, milestone guidance | planned |
| `12_data_source.md` | M2 | DataSource Abstraction | Defines a generic async/chunked data access contract for large-view consumers. | M1 shared state boundaries, `00_context.md` | data access layer, slice loading, view data contracts | planned |
| `13_lod_pipeline.md` | M2 | LOD Pipeline | Specifies multiresolution decimation and window-based aggregation for time-series views. | `12_data_source.md` | data pipeline, decimation, overview/detail performance | planned |
| `14_worker_downsampling.md` | M2 | Worker Downsampling | Moves heavier aggregation work off the UI thread through a worker protocol. | `13_lod_pipeline.md` | worker pipeline, async aggregation, frontend performance | planned |
| `15_spectrogram_view.md` | M2 | Spectrogram View | Introduces a proper linked spectrogram view with FFT/frequency/color contracts. | `12_data_source.md`, M1 shared navigation model | spectrogram view, selection integration, scientific rendering | planned |
| `16_channel_grid_view.md` | M2 | Channel Grid View | Defines a spatial channel grid with AP/ML mapping and linked hover/selection behavior. | M1 shared navigation model, `00_context.md` | spatial views, coordinate mapping, hover/selection linking | planned |
| `17_linked_crosshair.md` | M2 | Linked Crosshair | Adds transient cross-view cursor linking and crosshair overlays. | `15_spectrogram_view.md`, `16_channel_grid_view.md` | cursor state, hover linking, overlay behavior | planned |
| `18_event_browser.md` | M2 | Event Browser | Creates a fuller event browsing workflow with filtering and click-to-navigate behavior. | `17_linked_crosshair.md`, M1 event foundations | event browser, selection updates, workspace details | planned |
| `19_perievent_views.md` | M2 | Peri-Event Views | Supports event-aligned window extraction and comparison views. | `18_event_browser.md`, `12_data_source.md` | peri-event extraction, aligned views, event exploration | planned |
| `20_spatial_propagation.md` | M2 | Spatial Propagation | Prepares CPU-first propagation visualization infrastructure with animation/frame updates. | `16_channel_grid_view.md`, `19_perievent_views.md` | propagation view scaffold, animation controller, spatial overlays | planned |
| `21_renderer_abstraction.md` | M2 | Renderer Abstraction | Separates scientific view logic from Canvas-first and future WebGL rendering backends. | `20_spatial_propagation.md`, M2 view contracts | rendering architecture, backend separation, view renderer contracts | planned |

## Dependency Notes

- Dependencies here are intentionally conservative and based on documented prompt order plus each prompt's stated prerequisites.
- Some prompts can likely be run out of strict order once earlier contracts are stable, but that should be decided from the milestone READMEs and current repo state.
- Update `Status` only when completion is explicitly documented in the milestone docs, context snapshot, or handoff notes.
