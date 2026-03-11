# TensorScope Context Snapshot

Role: concise agent handoff file.

Use this file at the start of an agent session to understand:

- what the repo currently contains
- what to inspect first
- what milestone the project is actually in
- what questions are still open

Related docs:

- [Prompt usage guide](./README.md)
- [Architecture](../architecture/tensorscope.md)
- [Stable prompt context](./tensorscope/00_context.md)
- [Human roadmap](./roadmap.md)

## Current repo context

TensorScope currently has two main implementation surfaces:

- Python core and FastAPI server in `src/tensorscope/`
- React/Vite/TypeScript frontend in `frontend/`

The repo also contains design studies, hand-off notes, and reference-study material in `docs/` and `resources/`.

## Current TensorScope status

Current state is a prototype with a real backend contract and an early linked-view frontend.

Implemented now:

- tensor registry and validated selection model in the Python core
- session-backed API state and tensor slice endpoints
- frontend workspace shell
- navigator view
- timeseries view using `uPlot`
- spatial map view
- basic event table / event-window flow
- frontend view registry lookup

Not yet stabilized:

- canonical frontend `SelectionState` store for shared navigation
- first-class `TensorRegistry` and `ViewRegistry` abstractions across frontend/backend
- clear separation of navigation state vs view-local state vs processing state in the frontend
- formalized inspector architecture

## Current milestone

Between the first frontend vertical slice and the intended M1 linked multiscale explorer.

Practical reading:

- the backend contract exists and is usable
- the frontend already shows linked prototype behavior
- the next work should tighten state, shell, and view boundaries rather than start new product features

## Inspect these files first

### Project docs

- [README.md](/storage2/arash/projects/tensorscope/README.md)
- [docs/hand-off-2026-03-11.md](/storage2/arash/projects/tensorscope/docs/hand-off-2026-03-11.md)
- [docs/frontend-phase3.md](/storage2/arash/projects/tensorscope/docs/frontend-phase3.md)
- [docs/prompts/roadmap.md](/storage2/arash/projects/tensorscope/docs/prompts/roadmap.md)

### Core and server

- [src/tensorscope/core/state.py](/storage2/arash/projects/tensorscope/src/tensorscope/core/state.py)
- [src/tensorscope/core/schema.py](/storage2/arash/projects/tensorscope/src/tensorscope/core/schema.py)
- [src/tensorscope/server/state.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/state.py)
- [src/tensorscope/server/models.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/models.py)

### Frontend architecture anchors

- [frontend/src/App.tsx](/storage2/arash/projects/tensorscope/frontend/src/App.tsx)
- [frontend/src/store/appStore.ts](/storage2/arash/projects/tensorscope/frontend/src/store/appStore.ts)
- [frontend/src/components/layout/LayoutShell.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/layout/LayoutShell.tsx)
- [frontend/src/registry/viewRegistry.ts](/storage2/arash/projects/tensorscope/frontend/src/registry/viewRegistry.ts)
- [frontend/src/components/views/TimeseriesSliceView.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/views/TimeseriesSliceView.tsx)
- [frontend/src/components/views/NavigatorView.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/views/NavigatorView.tsx)

## Recent major changes

- FastAPI server and session-backed API were added.
- The frontend scaffold grew into a real prototype with navigator, timeseries, spatial map, and event flow.
- `uPlot` is now already present in the timeseries and navigator views.
- The new architecture and prompt docs were added, and now need to stay aligned with the real codebase.

## Recent architectural direction

The current direction is clear even though implementation is incomplete:

- TensorScope should be a linked tensor workspace, not a collection of unrelated charts.
- Shared selection/navigation state is the coordination mechanism.
- Timeseries rendering should stay CPU-first and use `uPlot`.
- Hot interaction paths should stay outside React rerender loops.
- View interoperability should happen through shared state and registries, not direct view-to-view coupling.
- GPU acceleration is a later option, not the baseline architecture.

## Open questions

- What is the exact stable TypeScript shape of the shared frontend `SelectionState`?
- Should visible time window live inside the shared selection store or as adjacent navigation state?
- How much of `TensorRegistry` should be frontend-only versus server-authored metadata?
- Should `ViewRegistry` stay as a frontend concern, or become a shared capability contract?
- How should event selection and event-centric navigation enter the shared state model?

## Update instructions for future agents

Update this file after major architectural work, not after every small patch.

Always refresh these sections when the answer materially changes:

- current TensorScope status
- important files/modules
- recent architectural direction
- open questions

Rules:

- document current reality first
- distinguish implemented from planned
- add concrete file references when new architecture anchors appear
- keep this file concise enough to paste into a future coding session
- if a task changes milestone status, update the `Current milestone` section explicitly

If you change the stable assumptions, also update:

- [docs/architecture/tensorscope.md](/storage2/arash/projects/tensorscope/docs/architecture/tensorscope.md)
- [docs/prompts/tensorscope/00_context.md](/storage2/arash/projects/tensorscope/docs/prompts/tensorscope/00_context.md)
