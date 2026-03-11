# TensorScope Stable Context

Use this file as the default context preamble for future TensorScope coding tasks.

Related docs:

- [Prompt usage guide](../README.md)
- [Architecture](../../architecture/tensorscope.md)
- [Context snapshot](../context_snapshot.md)
- [Roadmap](../roadmap.md)

## Product identity

TensorScope is a tensor-centric neurophysiology exploration workspace with linked views. It is not a generic plotting app.

## Stable architectural assumptions

- shared state coordinates views
- views do not call each other directly
- keep navigation state distinct from view-local state
- keep processing state distinct from navigation state
- hot rendering and pointer interaction paths should stay outside React rerender loops
- CPU-first rendering is the baseline
- `uPlot` is the preferred renderer for dense timeseries and overview timelines
- GPU acceleration is optional future work, not a prerequisite for current milestones

## Near-term target architecture

- shared `SelectionState` store
- `TensorRegistry`
- `ViewRegistry`
- workspace-shell UI architecture
- overview/detail multiscale navigation
- event-aware linked views

## Current repo reality

- backend core and server already exist in `src/tensorscope/`
- frontend prototype already exists in `frontend/`
- `uPlot` is already used in the navigator and timeseries views
- frontend architecture is not yet fully aligned with the target shared-state model
- the current frontend store is [frontend/src/store/appStore.ts](/storage2/arash/projects/tensorscope/frontend/src/store/appStore.ts), not yet a dedicated shared navigation store

## Default guardrails for future tasks

- do not implement broad architecture changes and product features in the same step
- prefer one milestone file, one acceptance target, one bounded patch
- document gaps explicitly instead of pretending the architecture already exists
- preserve `docs/prompts/roadmap.md` as the human-oriented master roadmap

## Recommended workflow

1. Read [../../architecture/tensorscope.md](/storage2/arash/projects/tensorscope/docs/architecture/tensorscope.md).
2. Read [../context_snapshot.md](/storage2/arash/projects/tensorscope/docs/prompts/context_snapshot.md).
3. Read [../README.md](/storage2/arash/projects/tensorscope/docs/prompts/README.md) for prompt usage rules.
4. Execute exactly one scoped prompt from this directory.
5. After major work, update the architecture doc and context snapshot if assumptions changed.
