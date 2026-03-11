# Prompt 04: Timeseries View Foundation

Read first:

- [00_context.md](./00_context.md)
- [../context_snapshot.md](../context_snapshot.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)
- [02_selection_store.md](./02_selection_store.md)

Goal: stabilize the reusable dense timeseries view around `uPlot`.

Inspect first:

- [frontend/src/components/views/TimeseriesSliceView.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/views/TimeseriesSliceView.tsx)
- [frontend/src/components/views/NavigatorView.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/views/NavigatorView.tsx)
- [frontend/src/api/arrow.ts](/storage2/arash/projects/tensorscope/frontend/src/api/arrow.ts)

Scope:

- keep one clear chart lifecycle
- keep hot updates outside React rerender loops
- use shared navigation state for cursor and visible range interactions
- preserve event overlay support

Guardrails:

- do not reimplement a charting library wrapper abstraction that is too generic
- do not move drag and scale updates into React state loops

Acceptance:

- `uPlot` ownership is explicit
- timeseries interaction is easier to extend without rewriting the component
- chart scale/cursor updates stay imperative
