# Prompt 72: Flexible View Grid And Panel Chrome

Read first:

- [00_context.md](./00_context.md)
- [70_resizable_shell.md](./70_resizable_shell.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: replace the fixed vertical view stack in WorkspaceMain with a configurable grid of view slots, and wrap each view in panel chrome with maximize/close affordances.

## Current state

WorkspaceMain renders views in a hardcoded vertical order:

```
TensorChooser
TensorOverview (view toggle pills)
NavigatorView
main-panels (timeseries [flex:1] + spatial [220px fixed])
PropagationView
SpectrogramView
PSDView
SpatialEventView
```

The layout is a single-column stack with one special case (timeseries + spatial side-by-side in `.main-panels`). Users cannot rearrange views. Adding more views makes the workspace increasingly tall and requires scrolling.

## Target state

The center workspace becomes a CSS grid with configurable rows and columns:

```text
┌─────────────────────┬─────────────────────┐
│ View Slot (0,0)     │ View Slot (0,1)     │
│ ┌─────────────────┐ │ ┌─────────────────┐ │
│ │ header: name [⤢]│ │ │ header: name [⤢]│ │
│ │ view content    │ │ │ view content    │ │
│ └─────────────────┘ │ └─────────────────┘ │
├─────────────────────┴─────────────────────┤
│ View Slot (1,0)  (spans 2 cols)           │
│ ┌─────────────────────────────────────────┐│
│ │ header: name [⤢] [×]                   ││
│ │ view content                            ││
│ └─────────────────────────────────────────┘│
└───────────────────────────────────────────┘
  Overflow area (scrollable, for extra views)
```

## Implementation tasks

### 1. Grid layout model

Define a `ViewGrid` type that describes the grid arrangement:

```typescript
type GridCell = {
  viewId: string;           // matches ViewDescriptor.id
  row: number;              // 0-based
  col: number;              // 0-based
  rowSpan?: number;         // default 1
  colSpan?: number;         // default 1
};

type ViewGridLayout = {
  columns: number;          // 1 or 2
  rows: number;             // 1 or 2 (auto-grows for overflow)
  cells: GridCell[];
};
```

The grid is deliberately simple — 1 or 2 columns, 1 or 2 rows. This covers:

- **1x1**: single view maximized (timeseries full-width)
- **1x2**: two views side-by-side (timeseries + spatial — the current `.main-panels`)
- **2x1**: two views stacked (timeseries over spectrogram)
- **2x2**: four-panel layout (timeseries + spatial over spectrogram + PSD)

Views not assigned to a grid cell appear in an overflow area below the grid, rendered as the current vertical stack.

### 2. Default grid assignment

When the user has not customized the grid, derive a default from the active views:

- if 1 active view → 1x1
- if 2 active views and one is spatial → 1x2 (timeseries left, spatial right) — matches current behavior
- if 2 active views, both temporal → 2x1
- if 3-4 active views → 2x2, assign by priority (timeseries → spatial → spectrogram → PSD)
- if >4 active views → 2x2 top grid + overflow below

The default assignment uses `ViewDescriptor` metadata. Add an optional `priority: number` to `ViewDescriptor` for grid placement ordering.

### 3. ViewPanel chrome

Create a `ViewPanel` wrapper component that provides the chrome around each view:

```typescript
type ViewPanelProps = {
  viewId: string;
  label: string;
  isMaximized: boolean;
  onToggleMaximize: () => void;
  onClose: () => void;
  children: ReactNode;
};
```

The panel chrome is a thin header bar (24px) with:

- view label (left-aligned, 11px uppercase, `--muted` color)
- maximize toggle button (⤢ icon; when maximized, the view fills the entire center workspace and other grid cells are hidden)
- close button (× icon; removes the view from `activeViews` in appStore)

The header should be visually minimal — it must not compete with the view content. Use the existing `.panel-title` style as a starting point.

### 4. Maximize behavior

When a view is maximized:

- it fills the entire center workspace grid area
- other grid cells and overflow views are hidden (CSS `display: none`, not unmounted)
- the maximize button icon changes to a "restore" icon
- clicking restore or pressing `Escape` returns to the previous grid layout
- store `maximizedView: string | null` in layout state

### 5. Bottom panel content

Move the navigator view from WorkspaceMain's content stack into the bottom panel region created in prompt 70.

The navigator is a natural fit for the bottom panel because:

- it provides temporal context for all other views
- it should always be visible during exploration (not scrolled away)
- its wide, short aspect ratio matches a bottom strip

The bottom panel should auto-expand when the navigator view is active and the bottom panel is collapsed.

### 6. Overflow area

Views that don't fit in the grid cells render below the grid in a scrollable area. This preserves backward compatibility — if the user hasn't configured a grid, all views render in the familiar vertical stack (with panel chrome added).

### 7. Grid resize between cells

Add a horizontal resize handle between columns and a vertical resize handle between rows within the grid. This lets users adjust the relative size of grid cells (e.g., make timeseries wider than spatial map).

Store column and row proportions in the layout state:

```typescript
type ViewGridLayout = {
  columns: number;
  rows: number;
  cells: GridCell[];
  colWidths: number[];   // fractional, e.g. [0.6, 0.4]
  rowHeights: number[];  // fractional, e.g. [0.5, 0.5]
};
```

## Constraints

- view components must not need modification — ViewPanel wraps them transparently
- the grid model is simple (max 2x2) — do not build a full docking system
- maximize must not unmount non-maximized views (preserve their internal state, query cache)
- the navigator move to the bottom panel is optional — if the bottom panel feature from prompt 70 is not yet implemented, keep the navigator in the content stack
- grid cells should have a minimum size (200px width, 150px height) to prevent unusable views
- the default grid assignment should match the current hardcoded layout as closely as possible so existing users see no regression

## Acceptance criteria

- the center workspace renders active views in a CSS grid (not just a vertical stack)
- a 1x2 layout with timeseries + spatial reproduces the current side-by-side arrangement
- each view has a panel header with label, maximize, and close buttons
- maximizing a view fills the center workspace; restore returns to the grid
- closing a view removes it from activeViews
- views beyond the grid capacity appear in an overflow area
- the navigator renders in the bottom panel when available
- grid columns and rows can be resized by dragging dividers between cells

## Deliverables

- `ViewPanel` wrapper component
- `ViewGrid` component that renders a CSS grid of ViewPanel-wrapped views
- `ViewGridLayout` type and default assignment logic
- updated `WorkspaceMain` to use ViewGrid instead of hardcoded stack
- navigator migration to bottom panel (or conditional: bottom panel if available, else inline)
- grid resize handles within the center workspace
- `maximizedView` and `viewGridLayout` in layout state
- updated `ViewDescriptor` with optional `priority` field
