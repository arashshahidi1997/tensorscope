# Prompt 70: Resizable Shell With Collapsible Panels

Read first:

- [00_context.md](./00_context.md)
- [../../architecture/invariants.md](../../architecture/invariants.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: upgrade the fixed three-column LayoutShell into a resizable layout with collapsible sidebar, inspector, and a new bottom panel region.

## Current state

`LayoutShell` renders a CSS grid with fixed columns:

```css
.workspace {
  display: grid;
  grid-template-columns: 220px 1fr 260px;
}
```

There is no resize interaction, no collapse/expand, and no bottom panel.

## Target state

The shell should become:

```text
+------------------------------------------------------------+
| TopBar                                                     |
+----------+---------------------------------+---------------+
| Sidebar  |◂ Center Workspace              ▸| Inspector     |
| (220px   |  (flex)                          | (260px default|
|  default,|                                  |  resizable)   |
|  resizab.|                                  |               |
|  collapsi|                                  |               |
+----------+---------------------------------+---------------+
|           Bottom Panel (collapsible, 200px default)        |
+------------------------------------------------------------+
```

The `◂` and `▸` represent drag handles between columns.

## Implementation tasks

### 1. Resizable column dividers

Replace the fixed `grid-template-columns: 220px 1fr 260px` with a layout that responds to user-dragged dividers.

Approach: use `onPointerDown` / `onPointerMove` / `onPointerUp` on thin divider elements between columns. Store column widths in component state (or a layout store). Apply widths via inline `grid-template-columns` style.

Do NOT use a library for this. The implementation is straightforward:

```tsx
// Pseudocode for a vertical resize handle
function ResizeHandle({ onResize }: { onResize: (dx: number) => void }) {
  const handlePointerDown = (e: PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const move = (ev: PointerEvent) => onResize(ev.clientX - startX);
    const up = () => { /* remove listeners, release capture */ };
    // attach move/up to the handle element
  };
  return <div className="resize-handle" onPointerDown={handlePointerDown} />;
}
```

Constraints:

- minimum sidebar width: 180px; maximum: 400px
- minimum inspector width: 200px; maximum: 500px
- minimum bottom panel height: 100px; maximum: 50% of viewport
- center workspace has no minimum (it absorbs remaining space)

### 2. Collapsible sidebar and inspector

Add a collapse toggle button to the sidebar header and inspector header. When collapsed:

- the column width goes to 0 (or a narrow 36px icon strip, if implementing a tab bar in prompt 71)
- the content is hidden via `display: none` or `visibility: hidden` — NOT unmounted
- React state inside the collapsed panel is preserved

A collapsed sidebar should show a thin vertical strip with an expand button. The expand button restores the previous width.

Implementation:

- store `sidebarCollapsed: boolean` and `inspectorCollapsed: boolean` in layout state
- when collapsed, set the grid column to `0px` (or `36px` for the tab bar strip)
- animate the transition with a CSS `transition: grid-template-columns 150ms ease`

### 3. Bottom panel region

Add a fourth region below the center workspace for persistent overview surfaces.

The bottom panel:

- spans the full width below the three-column area (sidebar + center + inspector)
- has a horizontal resize handle on its top edge
- is collapsible (toggle button + keyboard shortcut)
- defaults to collapsed (0 height) until the user activates it or a view requests it
- when active, default height is 200px

The navigator view is the primary candidate for the bottom panel. Moving it out of WorkspaceMain's vertical stack keeps the temporal overview pinned during scrolling.

Grid structure becomes:

```css
.app-shell {
  display: grid;
  grid-template-rows: 36px 1fr auto;
  /* row 1: topbar, row 2: workspace columns, row 3: bottom panel */
}
```

### 4. Layout state

Create a `LayoutState` type that captures the shell's structural state:

```typescript
type LayoutState = {
  sidebarWidth: number;       // px, default 220
  sidebarCollapsed: boolean;
  inspectorWidth: number;     // px, default 260
  inspectorCollapsed: boolean;
  bottomPanelHeight: number;  // px, default 200
  bottomPanelCollapsed: boolean;
};
```

Store this in `appStore` or a dedicated `useLayoutStore`. This state drives the CSS grid template and is persisted to localStorage in prompt 73.

## Constraints

- do not change data flow or query patterns
- view components must not need modification
- the resize interaction must feel responsive (no layout thrash)
- pointer capture ensures smooth dragging even when the cursor leaves the handle
- collapsing must not unmount child components (preserve React state)
- the bottom panel is structural scaffolding in this prompt — actual content (navigator) moves there in prompt 72

## Acceptance criteria

- sidebar can be resized by dragging the right edge divider
- inspector can be resized by dragging the left edge divider
- sidebar can be collapsed and expanded via a toggle button
- inspector can be collapsed and expanded via a toggle button
- bottom panel region exists and can be shown/hidden
- bottom panel can be resized vertically
- all panels respect minimum and maximum size constraints
- collapsing a panel does not destroy internal state (verify with a control that has local state)
- the center workspace absorbs remaining space as panels resize

## Deliverables

- updated `LayoutShell` component with resize handles and collapse toggles
- `ResizeHandle` utility component
- `LayoutState` type and store integration
- updated CSS grid rules in `styles.css`
- resize handle styling (4px wide, cursor: col-resize, subtle highlight on hover)
