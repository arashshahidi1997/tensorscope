# Prompt 73: Layout Persistence, Presets, And Keyboard Shortcuts

Read first:

- [00_context.md](./00_context.md)
- [70_resizable_shell.md](./70_resizable_shell.md)
- [71_tabbed_sidebar.md](./71_tabbed_sidebar.md)
- [72_view_grid.md](./72_view_grid.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: persist layout state across page reloads, define task-oriented layout presets, and add keyboard shortcuts for workspace navigation.

## 1. Layout state persistence

### Full layout state model

Collect all layout state introduced in prompts 70-72 into a single serializable type:

```typescript
type PersistedLayoutState = {
  version: 1;                         // schema version for future migration
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  activeSidebarTab: string;
  inspectorWidth: number;
  inspectorCollapsed: boolean;
  bottomPanelHeight: number;
  bottomPanelCollapsed: boolean;
  viewGridLayout: ViewGridLayout;
  maximizedView: string | null;
  activePreset: string | null;        // null = custom user arrangement
};
```

### Persistence contract

- serialize to `localStorage` under key `tensorscope:layout`
- debounce writes: persist at most once per 500ms during resize interactions
- restore on app mount, before first render, to avoid layout flash
- if stored state is missing or corrupt (version mismatch, invalid JSON), fall back to defaults silently
- do NOT send layout state to the server — it is client-only

### Implementation

Use Zustand's `persist` middleware or a manual `useEffect` that subscribes to layout state changes and writes to localStorage.

If using Zustand persist:

```typescript
const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      // ... state and actions
    }),
    {
      name: "tensorscope:layout",
      version: 1,
      partialize: (state) => ({ /* only persisted fields */ }),
    },
  ),
);
```

## 2. Task-oriented layout presets

Define presets as named configurations that set the layout to a known-good arrangement for common analysis tasks. Presets are read-only templates; applying a preset copies its values into the active layout state.

### Preset model

```typescript
type LayoutPreset = {
  id: string;
  label: string;
  description: string;
  layout: Omit<PersistedLayoutState, "version" | "activePreset">;
};
```

### Initial presets

Define at least three presets:

#### Signal Inspection

Purpose: detailed time-domain analysis with maximum trace visibility.

```
sidebar: expanded, Explore tab
inspector: collapsed
bottom panel: expanded (navigator)
grid: 1x1, timeseries full-width
```

Use when: inspecting raw signals, identifying artifacts, reviewing waveforms.

#### Spatial Exploration

Purpose: spatial and temporal views side-by-side with electrode map prominent.

```
sidebar: expanded, Explore tab
inspector: expanded
bottom panel: expanded (navigator)
grid: 1x2, timeseries (left) + spatial_map (right)
```

Use when: investigating spatial patterns, selecting electrodes, reviewing propagation.

#### Spectral Analysis

Purpose: frequency-domain analysis with spectrogram and PSD visible.

```
sidebar: expanded, Explore tab
inspector: collapsed
bottom panel: expanded (navigator)
grid: 2x1, spectrogram (top) + psd_average (bottom)
```

Use when: reviewing spectral content, identifying frequency bands, comparing power spectra.

#### Overview (default)

Purpose: balanced view of all available data types.

```
sidebar: expanded, Explore tab
inspector: expanded
bottom panel: expanded (navigator)
grid: 2x2, timeseries + spatial_map + spectrogram + psd_average
```

Use when: initial exploration, getting an overview of the dataset.

### Preset application

- when a preset is applied, copy its layout values into the active layout state
- set `activePreset` to the preset id
- any subsequent user modification (resize, collapse, view change) sets `activePreset` to `null` — the user is now in a custom layout
- the preset selector (in the Explore tab or top bar) shows the active preset name or "Custom"

### Preset registration

Store presets in a `LAYOUT_PRESETS` constant array. The preset system is not dynamic in M7 — presets are hardcoded. User-defined presets can be added post-M7.

## 3. Keyboard shortcuts

### Shortcut definitions

| Shortcut | Action | Notes |
|----------|--------|-------|
| `Ctrl+B` | Toggle sidebar | VS Code convention; toggles `sidebarCollapsed` |
| `Ctrl+Shift+B` | Toggle inspector | Mirrors sidebar toggle |
| `Ctrl+J` | Toggle bottom panel | VS Code terminal panel convention |
| `Ctrl+Shift+M` | Toggle maximize on focused view | Focus = last-clicked view panel |
| `Escape` | Exit maximize | Only when a view is maximized |
| `Ctrl+1` through `Ctrl+4` | Focus grid slot 1-4 | Sets keyboard focus to the view in that slot |

### Implementation

Use a single `useEffect` in the shell component that registers a `keydown` listener on `document`:

```typescript
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    // Ignore if focus is in an input/textarea
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    if (e.ctrlKey && e.key === "b" && !e.shiftKey) {
      e.preventDefault();
      toggleSidebar();
    }
    // ... etc
  };
  document.addEventListener("keydown", handler);
  return () => document.removeEventListener("keydown", handler);
}, [/* actions */]);
```

### Conflict avoidance

- check that shortcuts don't conflict with uPlot's key handlers (uPlot uses mouse events, not keyboard)
- check that `Ctrl+B` doesn't conflict with the browser's bookmark shortcut — it does in most browsers, so use `preventDefault()` to capture it. This is acceptable because TensorScope is a full-screen application
- do not override `Ctrl+C`, `Ctrl+V`, `Ctrl+Z`, `Ctrl+A`, `Ctrl+F`, or other text editing shortcuts
- shortcuts are disabled when focus is in an input or textarea element

### Discoverability

Add a keyboard shortcut tooltip to the sidebar toggle button (e.g., `title="Toggle sidebar (Ctrl+B)"`). A full shortcut reference panel is a post-M7 concern.

## 4. Responsive behavior

Update the existing `@media (max-width: 900px)` breakpoint:

- force sidebar collapsed (tab bar only)
- force inspector collapsed
- force bottom panel collapsed
- grid layout falls back to 1x1 (single column stack)
- maximize button hidden (already effectively maximized)

This ensures the app remains usable on smaller screens without the layout system producing an unusable arrangement.

## Constraints

- persistence is client-only (localStorage) — no server round-trips for layout state
- preset application is a copy, not a reference — subsequent edits don't modify the preset
- keyboard shortcuts must not interfere with chart interactions or text input
- layout restore must happen before first paint to avoid flash of default layout
- the `version` field enables future migration if the schema changes
- do not implement user-defined preset creation in M7 — that is a future extension

## Acceptance criteria

- layout state (column widths, collapse state, grid arrangement, active tab) persists across page reloads
- applying a preset configures the workspace to the preset's arrangement
- modifying the layout after applying a preset shows "Custom" in the preset selector
- `Ctrl+B` toggles the sidebar
- `Ctrl+J` toggles the bottom panel
- `Ctrl+Shift+M` maximizes/restores the focused view
- `Escape` exits maximize mode
- responsive breakpoint collapses all panels on narrow screens
- corrupt localStorage data is handled gracefully (fallback to defaults)

## Deliverables

- `PersistedLayoutState` type with version field
- localStorage persistence integration (debounced writes, restore on mount)
- `LAYOUT_PRESETS` constant with at least 3 presets
- preset selector UI (in Explore tab or top bar)
- keyboard shortcut handler in shell component
- tooltip hints for shortcut discoverability
- updated responsive breakpoint rules
