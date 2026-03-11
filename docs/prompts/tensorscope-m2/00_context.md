# TensorScope M2 Context

Use this file as the shared context preamble for M2 tasks.

Read first:

- [../README.md](../README.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)
- [../context_snapshot.md](../context_snapshot.md)
- [../tensorscope/11_m1_integration.md](../tensorscope/11_m1_integration.md)

## Architecture summary

TensorScope is organized around four layers:

- Domain
- Server/API
- Workspace shell
- Views

Shared navigation state remains the coordination mechanism across views.

Views must not call each other directly.

## M1 outcome

M1 establishes the architectural spine:

- backend tensor/session API
- workspace shell
- initial linked views
- navigator/detail pattern
- `uPlot` timeseries foundation
- prompt/docs structure for bounded agent work

M1 does not finish scalable data access or the full scientific view set.

## Purpose of M2

M2 extends TensorScope from an architectural prototype into a scalable scientific workspace.

Primary goals:

- interactive handling of larger recordings
- chunked and asynchronous data access
- LOD-aware rendering for overview and detail views
- real scientific views such as spectrogram, channel grid, peri-event views, and event browser
- cross-view cursor linking
- early renderer abstraction that stays CPU-first

## Guardrails

- shared navigation state remains the cross-view contract
- keep navigation state, view-local state, and processing state separate
- rendering hot paths must avoid React rerender loops
- CPU-first rendering is required
- GPU acceleration is optional future work, not a baseline requirement
- data access layers should avoid forcing full tensor loads into views
- keep each M2 task scoped to one implementation step

## M2 success condition

Large recordings remain interactive while TensorScope gains real linked scientific views without breaking the M1 architectural boundaries.
