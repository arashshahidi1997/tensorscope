# P80 — Stable Slot-Based View Layout

**Fixes:** B2 (view toggle instability), B4 (propagation frame oversized), F6 (stable positions)

## Problem

The current `computeDefaultGrid` recalculates the entire grid layout whenever `activeViewIds` changes. Toggling one view causes all others to resize/reflow. Users want stable positions: each view stays in its assigned slot regardless of other views being toggled.

## Design

Replace the dynamic auto-layout with a **fixed slot system**. Each view type has a permanent "home slot" in a row-based layout. Toggling a view shows/hides it in its slot. Hidden slots collapse their height to zero but do NOT cause neighboring slots to resize.

### Slot layout structure

The workspace is organized into **rows**. Each row represents a transform/analysis layer:

```
Row 0: Signal row     — timeseries (left, ~65%) + spatial_map (right, ~35%)
Row 1: PSD row         — psd_heatmap (left) + psd_curve (center) + psd_spatial (right)
Row 2: Spectrogram row — spectrogram (left) + propagation_frame (right, spatial-map sized)
```

Future transform tensors get their own rows. Rows are vertically stacked and each row collapses to 0 height when all its views are hidden.

### Key changes

1. **`ViewSlotLayout` type** — replaces `ViewGridLayout`:

```typescript
type ViewSlot = {
  viewId: string;
  region: "left" | "right" | "center";
  widthFraction: number; // e.g. 0.65
};

type ViewRow = {
  id: string;          // "signal", "psd", "spectrogram"
  label: string;
  slots: ViewSlot[];
  minHeight: number;   // px, when row is visible
};

type ViewSlotLayout = {
  rows: ViewRow[];
};
```

2. **Default slot assignments** — defined in a constant `DEFAULT_SLOT_LAYOUT`:

```typescript
const DEFAULT_SLOT_LAYOUT: ViewSlotLayout = {
  rows: [
    {
      id: "signal",
      label: "Signal",
      slots: [
        { viewId: "timeseries", region: "left", widthFraction: 0.65 },
        { viewId: "spatial_map", region: "right", widthFraction: 0.35 },
      ],
      minHeight: 260,
    },
    {
      id: "psd",
      label: "PSD",
      slots: [
        { viewId: "psd_heatmap", region: "left", widthFraction: 0.4 },
        { viewId: "psd_curve", region: "center", widthFraction: 0.25 },
        { viewId: "psd_spatial", region: "right", widthFraction: 0.35 },
      ],
      minHeight: 220,
    },
    {
      id: "spectrogram",
      label: "Spectrogram",
      slots: [
        { viewId: "spectrogram", region: "left", widthFraction: 0.65 },
        { viewId: "propagation_frame", region: "right", widthFraction: 0.35 },
      ],
      minHeight: 220,
    },
  ],
};
```

3. **ViewGrid rewrite** — instead of CSS grid with dynamic `fr` units, render each row as a flex container. Within each row, slots use their `widthFraction` as flex-basis. If a slot's view is not in `activeViewIds`, the slot renders with `visibility: hidden; height: 0; overflow: hidden` (keeps React state alive, doesn't reflow siblings).

4. **Row collapse** — a row collapses (height: 0, overflow: hidden) when ALL its slots' views are inactive. Use CSS transitions (150ms ease) for smooth collapse/expand.

5. **Propagation frame sizing** — by placing it in the spectrogram row's right slot with `widthFraction: 0.35`, it matches spatial_map dimensions instead of going fullscreen.

6. **Maximize override** — when `maximizedView` is set, all rows/slots get `display: none` except the target view's row+slot, which expands to fill. The maximize toggle in ViewPanel still works.

## Files to modify

- `frontend/src/components/views/viewGridLayout.ts` — replace `computeDefaultGrid` with `DEFAULT_SLOT_LAYOUT` and row helpers
- `frontend/src/components/views/ViewGrid.tsx` — rewrite to row-based flex layout
- `frontend/src/store/layoutStore.ts` — replace `ViewGridLayout` type with `ViewSlotLayout`; keep `maximizedView`
- `frontend/src/components/views/WorkspaceMain.tsx` — update to pass view elements to new ViewGrid API
- `frontend/src/styles.css` — replace `.view-grid` rules with `.view-row` + `.view-slot` rules

## Files NOT to modify

- View components (TimeseriesSliceView, SpatialMapSliceView, etc.) — ViewPanel wraps them unchanged
- ViewPanel.tsx — header chrome stays the same
- Data fetching in WorkspaceMain — unchanged

## CSS structure

```css
.view-rows {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  gap: 4px;
}

.view-row {
  display: flex;
  gap: 4px;
  min-height: 0;
  transition: height 150ms ease, opacity 150ms ease;
}

.view-row--collapsed {
  height: 0 !important;
  overflow: hidden;
  opacity: 0;
}

.view-slot {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.view-slot--hidden {
  visibility: hidden;
  height: 0;
  overflow: hidden;
  flex: 0 0 0 !important;
}
```

## Acceptance criteria

- Toggling timeseries off does NOT resize spatial_map
- Toggling spatial_map off does NOT resize timeseries
- Toggling both off and back on restores the exact same positions
- Propagation frame is constrained to ~35% width (spatial-map sized)
- Rows with no active views collapse smoothly
- Maximize still works (fills the entire workspace)
- Build passes, all 39 tests pass
