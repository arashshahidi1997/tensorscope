# Prompt 06: Overview And Detail

Read first:

- [00_context.md](./00_context.md)
- [../context_snapshot.md](../context_snapshot.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)
- [02_selection_store.md](./02_selection_store.md)
- [04_timeseries_view.md](./04_timeseries_view.md)

Goal: formalize multiscale navigation between overview and detail views.

Inspect first:

- [frontend/src/components/views/NavigatorView.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/views/NavigatorView.tsx)
- [frontend/src/components/views/TimeseriesSliceView.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/views/TimeseriesSliceView.tsx)

Scope:

- navigator/detail shared visible range contract
- selection cursor synchronization
- explicit distinction between current cursor and current window

Guardrails:

- do not couple overview and detail components directly
- use shared state as the coordination layer

Acceptance:

- overview changes update detail range predictably
- detail interactions can update shared cursor/window state
- the pattern is reusable for future linked views
