# Prompt 07: Event Track

Read first:

- [00_context.md](./00_context.md)
- [../context_snapshot.md](../context_snapshot.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)
- [02_selection_store.md](./02_selection_store.md)
- [06_overview_detail.md](./06_overview_detail.md)

Goal: add the first real event-aware navigation layer.

Inspect first:

- [frontend/src/components/views/EventTableView.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/views/EventTableView.tsx)
- [frontend/src/components/views/TimeseriesSliceView.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/views/TimeseriesSliceView.tsx)
- [src/tensorscope/core/events/registry.py](/storage2/arash/projects/tensorscope/src/tensorscope/core/events/registry.py)
- [src/tensorscope/server/routers/events.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/routers/events.py)

Scope:

- event track or event overlay behavior tied to shared state
- event selection updates shared navigation state
- event rendering remains lightweight and CPU-first

Guardrails:

- do not build a large event system here
- do not hardwire event logic into unrelated views

Acceptance:

- events become first-class navigation targets
- clicking or selecting an event updates shared state
- timeseries and overview can respond without direct coupling
