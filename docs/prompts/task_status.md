# TensorScope Task Status

Use this file as the lightweight manual tracker for prompt execution status.

Purpose:

- track which prompt tasks are still planned
- mark tasks that are in progress, completed, blocked, or need revision
- keep milestone execution visible without turning the docs into project-management overhead

How to maintain it:

- update status when a prompt run materially changes its outcome
- keep notes short and concrete
- use `planned` when status is uncertain
- update `last-updated` manually when you touch a row

Related docs:

- [Prompt docs guide](./README.md)
- [Prompt registry](./prompt_registry.md)
- [Context snapshot](./context_snapshot.md)

Status values:

- `planned`
- `in progress`
- `completed`
- `blocked`
- `needs revision`

## M1 Status

Milestone: M1 - Linked Multiscale Explorer

| Prompt | Title | Status | Notes | Last-updated |
|---|---|---|---|---|
| `00_context.md` | Stable Context | planned | Shared context file exists; completion of the prompt itself is not tracked separately here. | `YYYY-MM-DD` |
| `01_types.md` | Types And Contracts | planned | Architecture docs say M1 is complete, but prompt-level completion was not recorded per file. | `YYYY-MM-DD` |
| `02_selection_store.md` | Shared Selection Store | planned | Current repo state suggests this work happened, but keep status conservative until prompt-level completion is explicitly recorded. | `YYYY-MM-DD` |
| `03_workspace_shell.md` | Workspace Shell | planned | Current repo state suggests this work happened, but prompt-level completion is not explicitly tracked. | `YYYY-MM-DD` |
| `04_timeseries_view.md` | Timeseries View Foundation | planned | Timeseries foundation exists in the repo; task status remains conservative without prompt-level record. | `YYYY-MM-DD` |
| `05_gesture_toolbar.md` | Gesture Toolbar | planned | View-local tool state exists; prompt-level completion is not explicitly documented. | `YYYY-MM-DD` |
| `06_overview_detail.md` | Overview And Detail | planned | Overview/detail behavior exists; prompt-level completion is still ambiguous. | `YYYY-MM-DD` |
| `07_event_track.md` | Event Track | planned | Event-aware navigation exists in current docs, but prompt-level completion is not explicitly logged. | `YYYY-MM-DD` |
| `08_registries.md` | Tensor And View Registries | planned | Registry work exists in current docs, but status should stay conservative. | `YYYY-MM-DD` |
| `09_inspector.md` | Inspector Panel | planned | InspectorPanel exists; prompt-level completion is not explicitly tracked. | `YYYY-MM-DD` |
| `10_docs.md` | Docs Sync | planned | Docs have evolved across multiple sessions; do not infer completion automatically. | `YYYY-MM-DD` |
| `11_m1_integration.md` | M1 Integration | planned | Context snapshot says M1 is complete, but this tracker avoids asserting per-prompt completion without explicit log entries. | `YYYY-MM-DD` |

## M2 Status

Milestone: M2 - Data And Linked Scientific Views

| Prompt | Title | Status | Notes | Last-updated |
|---|---|---|---|---|
| `00_context.md` | M2 Context | planned | Pack scaffold exists and is ready for future use. | `YYYY-MM-DD` |
| `12_data_source.md` | DataSource Abstraction | planned | Future M2 task. | `YYYY-MM-DD` |
| `13_lod_pipeline.md` | LOD Pipeline | planned | Future M2 task. | `YYYY-MM-DD` |
| `14_worker_downsampling.md` | Worker Downsampling | planned | Future M2 task. | `YYYY-MM-DD` |
| `15_spectrogram_view.md` | Spectrogram View | planned | Future M2 task. | `YYYY-MM-DD` |
| `16_channel_grid_view.md` | Channel Grid View | planned | Future M2 task. | `YYYY-MM-DD` |
| `17_linked_crosshair.md` | Linked Crosshair | planned | Future M2 task. | `YYYY-MM-DD` |
| `18_event_browser.md` | Event Browser | planned | Future M2 task. | `YYYY-MM-DD` |
| `19_perievent_views.md` | Peri-Event Views | planned | Future M2 task. | `YYYY-MM-DD` |
| `20_spatial_propagation.md` | Spatial Propagation | planned | Future M2 task. | `YYYY-MM-DD` |
| `21_renderer_abstraction.md` | Renderer Abstraction | planned | Future M2 task. | `YYYY-MM-DD` |

## Future Scaffold Packs

These are placeholders, not executable prompt packs yet.

| Pack | Status | Notes | Last-updated |
|---|---|---|---|
| `tensorscope-m3/` | planned | Placeholder pack for M3 - Spatial Dynamics. Detailed task prompts not authored yet. | `YYYY-MM-DD` |
| `tensorscope-m4/` | planned | Placeholder pack for M4 - Analysis And Derived Tensors. Detailed task prompts not authored yet. | `YYYY-MM-DD` |
| `tensorscope-m5/` | planned | Placeholder pack for M5 - Agentic Exploration. Detailed task prompts not authored yet. | `YYYY-MM-DD` |

## Notes On Ambiguity

- The current repo docs say M1 is complete at the milestone level.
- This tracker does not automatically mark all M1 prompts `completed`, because prompt-by-prompt execution status was not explicitly logged.
- If a future session documents that a specific prompt was executed and accepted, update that row directly.
