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

M1 complete. M2 in progress as of 2026-03-11 (Prompt 12 done).

Implemented:

- tensor registry and validated selection model in the Python core
- session-backed API state and tensor slice endpoints
- `useSelectionStore` — dedicated navigation store: `{ timeCursor, timeWindow, spatial, freq, event }`; app-shell state in `useAppStore`
- `toSelectionDTO` / `initFromDTO` — store ↔ wire-format bridge
- `useChartTools(chartRef)` + `ChartToolbar` — view-local tool state outside shared store
- `useOverviewDetail()` — navigator drag and timeseries zoom both call `setTimeWindow`
- `useEventNavigation()` — event identity in store, decoupled from timeCursor
- `NavRail` / `WorkspaceMain` / `InspectorPanel` — workspace shell extracted; App.tsx is ~100 lines
- `VIEW_DESCRIPTORS` + `getAvailableViews(schema)` — frontend view registry mirrors backend `_VIEW_REGISTRY`
- `InspectorPanel` — tensor summary + selection summary + event table in right rail
- 39 unit tests: selectionStore (31) + useChartTools (8)

## Current milestone

**M2 in progress.** M1 complete. M2 goal: scalable data access (chunked/LOD-aware),
worker-backed rendering, and core scientific views (spectrogram improvements, channel
grid, event browser, peri-event views, renderer contracts).

M2 completed so far:

- **Prompt 12** — `DataSource` contract formalized:
  - `DataSource` interface + `SliceOptions` + `createTensorDataSource` factory
    in [frontend/src/api/dataSource.ts](../../frontend/src/api/dataSource.ts)
  - `useSliceQuery` / `makeDefaultSliceRequest` cross-referenced to the interface
  - `SliceOptions.maxPoints` named as the pixel-budget anchor for Prompt 13 (LOD)

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

- [frontend/src/api/dataSource.ts](/storage2/arash/projects/tensorscope/frontend/src/api/dataSource.ts) — DataSource interface + SliceOptions + factory (M2 Prompt 12)
- [frontend/src/api/queries.ts](/storage2/arash/projects/tensorscope/frontend/src/api/queries.ts) — useSliceQuery, makeDefaultSliceRequest, clampWindow
- [frontend/src/App.tsx](/storage2/arash/projects/tensorscope/frontend/src/App.tsx) — bootstrap + selection mutation
- [frontend/src/store/appStore.ts](/storage2/arash/projects/tensorscope/frontend/src/store/appStore.ts) — shell state only
- [frontend/src/store/selectionStore.ts](/storage2/arash/projects/tensorscope/frontend/src/store/selectionStore.ts) — navigation state
- [frontend/src/types/index.ts](/storage2/arash/projects/tensorscope/frontend/src/types/index.ts) — canonical domain types barrel
- [frontend/src/components/layout/LayoutShell.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/layout/LayoutShell.tsx)
- [frontend/src/components/layout/NavRail.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/layout/NavRail.tsx)
- [frontend/src/components/layout/InspectorPanel.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/layout/InspectorPanel.tsx)
- [frontend/src/components/views/WorkspaceMain.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/views/WorkspaceMain.tsx)
- [frontend/src/registry/viewRegistry.ts](/storage2/arash/projects/tensorscope/frontend/src/registry/viewRegistry.ts) — VIEW_DESCRIPTORS + getAvailableViews
- [frontend/src/components/views/TimeseriesSliceView.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/views/TimeseriesSliceView.tsx)
- [frontend/src/components/views/NavigatorView.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/views/NavigatorView.tsx)
- [frontend/src/components/views/useChartTools.ts](/storage2/arash/projects/tensorscope/frontend/src/components/views/useChartTools.ts)
- [frontend/src/components/views/useOverviewDetail.ts](/storage2/arash/projects/tensorscope/frontend/src/components/views/useOverviewDetail.ts)
- [frontend/src/components/views/useEventNavigation.ts](/storage2/arash/projects/tensorscope/frontend/src/components/views/useEventNavigation.ts)

## Recent major changes (M1, 2026-03-11)

- Split `appStore` (shell) from `selectionStore` (navigation); canonical `SelectionState` type.
- Extracted `NavRail`, `WorkspaceMain`, `InspectorPanel` from App.tsx.
- Closed timeseries zoom feedback loop: `setScale` hook → `setTimeWindow`.
- Formalized `VIEW_DESCRIPTORS` and `getAvailableViews` in `viewRegistry.ts`.
- Event identity (`event.eventId`, `event.streamName`) added to `SelectionState`; `useEventNavigation()` hook.
- `useChartTools(chartRef)` + `ChartToolbar` for view-local pan/zoom tool state.
- 39 unit tests.

## Open questions (M2 scope)

- Multi-tensor workspace: how do views bind to a specific tensor when multiple are active?
- Should `getAvailableViews` on the frontend fully replace server `available_views`, or are both needed?
- Event segments: should epoch/segment selection enter `SelectionState` or stay separate?

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
