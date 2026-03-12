# TensorScope M7 Prompt Pack

Milestone: M7 - Dynamic Workspace Layout

Read first:

- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)
- [../../architecture/invariants.md](../../architecture/invariants.md)
- [../context_snapshot.md](../context_snapshot.md)
- [../README.md](../README.md)
- [../tensorscope-m6/README.md](../tensorscope-m6/README.md)

## Milestone purpose

M7 upgrades TensorScope's fixed shell into a flexible, user-configurable workspace layout.

Primary focus:

- resizable three-column shell with collapsible sidebar and inspector
- tabbed left sidebar reflecting the now-populated feature surfaces (Explore, Graph, Tensors, Events, Pipeline)
- flexible view arrangement in the center workspace (grid cells, not just a vertical stack)
- optional bottom panel for persistent overview/event surfaces
- view panel headers with maximize/close affordances
- layout state persistence and task-oriented presets
- keyboard shortcuts for panel toggling and view focus

## Architectural role

M7 is a UI-structure milestone. It does not change data flow, tensor slicing, or transform execution. It restructures how existing views and controls are arranged in the shell so the workspace scales to more views and more complex analysis workflows.

The layout system must remain orthogonal to:

- shared navigation state (Invariant 1)
- view-to-view coordination through shared state (Invariant 2)
- the distinction between navigation, view-local, and processing state (Invariant 3)

## Relationship to earlier milestones

- M1 established the fixed three-column shell (LayoutShell, NavRail, InspectorPanel, WorkspaceMain).
- M2 added the data pipeline and linked scientific views.
- M3 added spatial dynamics and propagation.
- M4 introduced transforms and derived tensors — content for a "Tensors" sidebar tab.
- M5 introduced the workspace DAG — content for a "Graph" sidebar tab.
- M6 introduced pipeline export — content for a "Pipeline" sidebar tab.
- M7 restructures the shell to expose all of these as navigable workspace surfaces.

## Key subsystems introduced

- resizable panel dividers between shell columns
- collapsible sidebar and inspector regions
- tabbed sidebar navigation with per-tab content contracts
- flexible center workspace grid (rows and columns of view cells)
- view panel chrome (header bar, maximize, close)
- optional bottom panel region
- layout state model (column widths, collapsed state, view grid arrangement, active sidebar tab)
- layout persistence (serialize to JSON, restore on reload)
- task-oriented layout presets
- keyboard shortcuts for workspace navigation

## Design notes and suggestions

Several ideas here go beyond the original `ui-layout-concepts.md` design note:

### View panel headers

The current views render directly into the content stack without any chrome. Each view should be wrapped in a thin panel frame with:

- a compact header showing the view name (from `ViewDescriptor.label`)
- a maximize toggle (expands the view to fill the center workspace, click again to restore)
- a close/hide button (removes the view from the active set without destroying state)

This gives users direct manipulation affordances per view without needing the sidebar's pill toggles as the only way to show/hide views.

### Bottom panel for navigator and events

The design doc mentions a bottom panel for "timeline navigation, event lists, computation logs". In the current implementation, the navigator view sits inside the vertical content stack in WorkspaceMain, which means it scrolls away as the user adds views. Moving the navigator into a fixed bottom strip (like VS Code's terminal panel) keeps the temporal overview always visible during exploration. This is a meaningful improvement because multiscale time navigation is foundational to every workflow.

### Flexible view grid instead of full docking

Full docking (Golden Layout, Mosaic) adds significant complexity. A simpler model: the center workspace is a CSS grid where the user can configure a 1x1, 1x2, 2x1, or 2x2 arrangement of view slots. Each slot holds one active view. This covers the dominant use cases (timeseries + spatial side-by-side, spectrogram below timeseries, four-panel comparison) without the maintenance cost of a docking library.

If the number of active views exceeds the grid slots, overflow views stack in a scrollable area below the grid — preserving current behavior as a graceful fallback.

### Keyboard shortcuts

Scientific exploration tools benefit from keyboard-driven panel management:

- `Ctrl+B` — toggle left sidebar (VS Code convention)
- `Ctrl+Shift+B` — toggle right inspector
- `Ctrl+J` — toggle bottom panel
- `Ctrl+\` — cycle sidebar tab forward
- `Ctrl+Shift+M` — toggle maximize on the focused view
- Number keys `1-4` with a modifier — focus grid slot 1-4

These should be configurable later but start with sensible defaults.

### Tab content contracts

Each sidebar tab should define a `TabContent` interface:

- `Explore`: selection controls (current NavRail content), layout preset picker, view toggles
- `Graph`: DAG inspector from M5, focused node details, lineage breadcrumb
- `Tensors`: tensor browser, metadata summaries, derived tensor list from M4
- `Events`: event table (currently in InspectorPanel), event stream selector, event-centric navigation
- `Pipeline`: promoted nodes from M6, pipeline status, export actions

This distributes the growing set of controls across purpose-specific surfaces instead of cramming everything into one sidebar.

## Prompt order

1. [00_context.md](./00_context.md)
2. [70_resizable_shell.md](./70_resizable_shell.md) — resizable column dividers, collapsible sidebar/inspector, bottom panel region
3. [71_tabbed_sidebar.md](./71_tabbed_sidebar.md) — sidebar tab model, tab content contracts, per-tab rendering
4. [72_view_grid.md](./72_view_grid.md) — flexible center workspace grid, view panel chrome, maximize/close, overflow
5. [73_layout_persistence.md](./73_layout_persistence.md) — layout state model, JSON serialization, task-oriented presets, keyboard shortcuts

## Recommended workflow for agents

1. Read the architecture doc, invariants, context snapshot, M6 README, and this README.
2. Confirm the shell components (LayoutShell, NavRail, InspectorPanel, WorkspaceMain) are stable before restructuring.
3. Start from [00_context.md](./00_context.md) and then [70_resizable_shell.md](./70_resizable_shell.md).
4. Keep one bounded layout concern per run.
5. The resizable shell (70) must be working before the tabbed sidebar (71), view grid (72), or persistence (73) can build on it.

## M7 guardrails

- layout changes must not alter data flow, query patterns, or shared navigation state
- view components must not need modification to work within the new layout — the shell wraps them
- no heavyweight docking libraries — use CSS grid and lightweight resize handles
- collapsing a panel must preserve its internal state (React keeps the subtree mounted but CSS-hidden)
- keyboard shortcuts must not conflict with browser defaults or uPlot's interaction handlers
- layout persistence is session-local (localStorage); it is not sent to the server
- task presets are read-only defaults; user modifications overlay them, not replace them
- the bottom panel is optional — if no bottom-panel views are active, the region collapses to zero height

## Exit criteria

Treat M7 as done when:

- shell columns are resizable via drag handles between sidebar, main, and inspector
- sidebar and inspector can be collapsed/expanded (toggle button + keyboard shortcut)
- left sidebar has a tab strip with at least Explore and one additional tab (Graph or Tensors)
- center workspace supports at least a 2-column view arrangement (not just vertical stack)
- each view has a panel header with maximize and close affordances
- a bottom panel region exists and the navigator can optionally render there
- layout state (column widths, collapsed panels, grid arrangement, active tab) persists across page reloads via localStorage
- at least two task-oriented presets are defined (e.g. "Signal Inspection", "Spatial Exploration")
- keyboard shortcuts for sidebar toggle and view maximize are functional
