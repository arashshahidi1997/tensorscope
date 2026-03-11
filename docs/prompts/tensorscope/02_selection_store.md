# Prompt 02: Shared Selection Store

Read first:

- [00_context.md](./00_context.md)
- [../context_snapshot.md](../context_snapshot.md)
- [01_types.md](./01_types.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: implement the canonical shared frontend selection/navigation store for linked views.

Inspect first:

- [frontend/src/store/appStore.ts](/storage2/arash/projects/tensorscope/frontend/src/store/appStore.ts)
- [frontend/src/App.tsx](/storage2/arash/projects/tensorscope/frontend/src/App.tsx)
- [frontend/src/components/views/NavigatorView.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/views/NavigatorView.tsx)
- [frontend/src/components/views/TimeseriesSliceView.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/views/TimeseriesSliceView.tsx)

Scope:

- introduce a focused Zustand store for navigation state
- keep view-local tool state out of the shared store
- keep processing state separate
- migrate only the minimum current callers needed to prove the model

Guardrails:

- do not fold all app UI state into this store
- do not make views coordinate by direct calls
- preserve current behavior where practical

Acceptance:

- timeseries, navigator, and spatial map can coordinate through shared state
- the state model clearly separates navigation state from processing state
- tests cover basic linked update semantics
