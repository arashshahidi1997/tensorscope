# Prompt 11: M1 Integration

Read first:

- [00_context.md](./00_context.md)
- [../context_snapshot.md](../context_snapshot.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)
- [10_docs.md](./10_docs.md)

Goal: integrate the M1 linked multiscale explorer once the earlier milestones are stable.

Inspect first:

- [frontend/src/App.tsx](/storage2/arash/projects/tensorscope/frontend/src/App.tsx)
- [frontend/src/store/appStore.ts](/storage2/arash/projects/tensorscope/frontend/src/store/appStore.ts)
- [frontend/src/components/views/TimeseriesSliceView.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/views/TimeseriesSliceView.tsx)
- [frontend/src/components/views/NavigatorView.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/views/NavigatorView.tsx)
- [frontend/src/registry/viewRegistry.ts](/storage2/arash/projects/tensorscope/frontend/src/registry/viewRegistry.ts)

Scope:

- verify the shell, shared state, timeseries, overview/detail, event track, and inspector fit together
- remove only minimal architectural friction discovered during integration
- finish docs updates needed for hand-off

Guardrails:

- do not start M2 features here
- prefer small cleanup over broad redesign
- preserve the CPU-first path

Acceptance:

- M1 behaves like one coherent linked workspace
- future agents can extend it without major architectural drift
- docs reflect what was actually integrated
