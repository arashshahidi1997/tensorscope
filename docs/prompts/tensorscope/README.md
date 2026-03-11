# TensorScope M1 Prompt Pack

Milestone: M1 - Linked Multiscale Explorer

Read first:

- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)
- [../context_snapshot.md](../context_snapshot.md)
- [../README.md](../README.md)

## Milestone purpose

M1 establishes the architectural spine of TensorScope:

- shared navigation state
- workspace-shell structure
- linked overview/detail interaction
- timeseries foundation
- first-pass registries and inspector boundaries

## What must already exist

- current TensorScope architecture doc
- current context snapshot
- frontend and backend prototype already present in the repo

## What this milestone should produce

- a coherent linked multiscale workspace
- cleaner state boundaries
- a stable shell for future view growth
- documented guardrails for follow-on milestones

## Prompt order

1. [00_context.md](./00_context.md)
2. [01_types.md](./01_types.md)
3. [02_selection_store.md](./02_selection_store.md)
4. [03_workspace_shell.md](./03_workspace_shell.md)
5. [04_timeseries_view.md](./04_timeseries_view.md)
6. [05_gesture_toolbar.md](./05_gesture_toolbar.md)
7. [06_overview_detail.md](./06_overview_detail.md)
8. [07_event_track.md](./07_event_track.md)
9. [08_registries.md](./08_registries.md)
10. [09_inspector.md](./09_inspector.md)
11. [10_docs.md](./10_docs.md)
12. [11_m1_integration.md](./11_m1_integration.md)

## Recommended workflow for agents

1. Read the architecture doc, context snapshot, and this README.
2. Start from [00_context.md](./00_context.md).
3. Run one prompt at a time.
4. Inspect referenced code before editing.
5. Update architecture/context docs when a task materially changes milestone state.

## M1 guardrails

- keep shared navigation state as the coordination mechanism
- do not make views call each other directly
- keep hot rendering paths outside React rerender loops
- separate navigation state, processing state, and view-local state
- do not start scalable-data or advanced scientific-view work here; that belongs to M2

## Exit criteria

Treat M1 as done when:

- linked overview/detail navigation is coherent
- the workspace shell is stable enough for extension
- the selection/state model is clear enough for future scientific views
- architecture and context docs reflect the integrated M1 result
