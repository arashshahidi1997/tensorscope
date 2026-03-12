# TensorScope M7 Context

Use this file as the shared context preamble for M7 tasks.

Read first:

- [../README.md](../README.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)
- [../../architecture/invariants.md](../../architecture/invariants.md)
- [../context_snapshot.md](../context_snapshot.md)
- [../tensorscope-m6/README.md](../tensorscope-m6/README.md)

## Conceptual architecture

M7 restructures TensorScope's fixed three-column shell into a flexible, resizable workspace layout. The current shell is:

```text
+------------------------------------------------------------+
| TopBar (36px, fixed)                                       |
+----------+---------------------------------+---------------+
| NavRail  | WorkspaceMain                   | InspectorPanel|
| 220px    | flex                            | 260px         |
| fixed    | vertical view stack             | fixed         |
+----------+---------------------------------+---------------+
```

The M7 target is:

```text
+------------------------------------------------------------+
| TopBar (36px, fixed)                                       |
+---+------+---------------------------------+---------------+
|Tab| Tab  | Center Workspace                | Inspector     |
|Bar|Content| ┌──────────┬──────────┐        | (collapsible, |
|   |      | │ View A   │ View B   │        |  resizable)   |
|   |(coll-| │          │          │        |               |
|   | apsi-| ├──────────┴──────────┤        |               |
|   | ble, | │ View C              │        |               |
|   | resi-| └─────────────────────┘        |               |
|   | zable|                                 |               |
+---+------+---------------------------------+---------------+
| Bottom Panel (collapsible): Navigator / Events / Logs      |
+------------------------------------------------------------+
```

Key structural changes:

- **Resizable dividers** between the three columns (drag to resize)
- **Collapsible sidebar and inspector** (toggle to zero width, state preserved)
- **Tabbed sidebar** with Explore / Graph / Tensors / Events / Pipeline tabs
- **Flexible center grid** with configurable rows and columns of view slots
- **View panel chrome** (header, maximize, close) wrapping each view
- **Bottom panel** for persistent overview surfaces (navigator, events, logs)
- **Layout persistence** via localStorage JSON

## What this milestone enables

- users can resize panels to match their workflow
- sidebar tabs organize the growing set of controls by purpose
- the center workspace supports side-by-side and grid view arrangements
- views can be maximized for detailed inspection and restored afterward
- the navigator stays visible at the bottom during exploration
- layout state survives page reloads
- task-oriented presets configure the workspace for common analysis patterns

## Guardrails

- layout changes must not alter data flow, query patterns, or shared navigation state
- view components must not need modification — the shell wraps them
- no heavyweight docking libraries (Golden Layout, Mosaic) — use CSS grid and lightweight resize logic
- collapsing a panel must preserve its internal React state
- keyboard shortcuts must not conflict with browser defaults or chart interaction handlers
- layout state is client-only (localStorage), not sent to the server
- the bottom panel collapses to zero height when no bottom-panel views are active

## Expected integration points

- `LayoutShell` (`frontend/src/components/layout/LayoutShell.tsx`) — the top-level grid component
- `NavRail` (`frontend/src/components/layout/NavRail.tsx`) — becomes one tab's content (Explore tab)
- `InspectorPanel` (`frontend/src/components/layout/InspectorPanel.tsx`) — wrapped in collapsible container
- `WorkspaceMain` (`frontend/src/components/views/WorkspaceMain.tsx`) — view composition moves into grid slots
- `appStore` (`frontend/src/store/appStore.ts`) — gains layout state fields
- `styles.css` (`frontend/src/styles.css`) — grid layout rules updated
- `viewRegistry` (`frontend/src/registry/viewRegistry.ts`) — view descriptors gain optional `defaultRegion` hint

## Current shell components

### LayoutShell

Three-slot grid: `nav | children | inspector`. TopBar above. Fixed column widths via CSS grid (`220px 1fr 260px`).

### NavRail

Monolithic left panel containing: SelectionPanel (time/spatial/freq controls), LayoutPanel (preset picker), ProcessingPanel (transform params). All controls affect all views globally.

### InspectorPanel

Right panel containing: tensor metadata summary, current selection display, event table with prev/next navigation. Content changes based on active selection, not focused view.

### WorkspaceMain

Central content area. Views stack vertically: TensorChooser → TensorOverview → NavigatorView → main-panels (timeseries + spatial side-by-side) → propagation → spectrogram → PSD → SpatialEventView. Fixed layout order; no user rearrangement.

## Reference patterns

VS Code's workbench layout is the closest model:

- activity bar (icon strip) → tab bar in TensorScope's sidebar
- sidebar panel → tab content area
- editor group grid → center workspace view grid
- terminal panel → bottom panel
- `Ctrl+B` to toggle sidebar

JupyterLab's dock panel model is useful for understanding view arrangement, but TensorScope should use a simpler grid model rather than full drag-and-drop docking.
