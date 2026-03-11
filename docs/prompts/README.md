# TensorScope Prompt Docs

Use these docs together, not interchangeably.

## File roles

- [roadmap.md](./roadmap.md): human planning, milestone ordering, future direction
- [../architecture/tensorscope.md](../architecture/tensorscope.md): current architecture, near-term target, guardrails, open design questions
- [context_snapshot.md](./context_snapshot.md): current repo status and handoff context for a new agent session
- [`tensorscope/`](./tensorscope/00_context.md): small scoped prompts for one implementation step at a time

## How to use these docs with agents

Recommended flow for a coding session:

1. Read [../architecture/tensorscope.md](/storage2/arash/projects/tensorscope/docs/architecture/tensorscope.md).
2. Read [context_snapshot.md](/storage2/arash/projects/tensorscope/docs/prompts/context_snapshot.md).
3. Choose one scoped task in [`tensorscope/`](./tensorscope/00_context.md).
4. Inspect the referenced code before editing.
5. Make one bounded change set.
6. If the architecture or milestone state changed materially, update the architecture doc and context snapshot in the same session.

## Safe task execution expectations

- plan before editing
- inspect the relevant modules first
- keep prompts single-run sized
- document current reality, not intended future state
- prefer linking to existing docs instead of restating them

## Recommended prompt order

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
