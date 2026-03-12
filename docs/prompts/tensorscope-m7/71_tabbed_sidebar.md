# Prompt 71: Tabbed Sidebar Navigation

Read first:

- [00_context.md](./00_context.md)
- [70_resizable_shell.md](./70_resizable_shell.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: replace the monolithic NavRail with a tabbed sidebar where each tab surfaces a purpose-specific control surface.

## Current state

`NavRail` is a single scrollable column containing:

- `SelectionPanel` — time cursor, time window, spatial selection, frequency selection
- `LayoutPanel` — layout preset picker (pill row)
- `ProcessingPanel` — transform parameters, apply/reset buttons

All controls are always visible. As features grow (M4 tensors, M5 graph, M6 pipeline), the sidebar becomes overcrowded.

## Target state

The left sidebar splits into two regions:

```text
+--------+------------------+
| Tab    | Tab Content      |
| Bar    |                  |
|        | (scrollable,     |
| [icon] |  changes per     |
| [icon] |  active tab)     |
| [icon] |                  |
| [icon] |                  |
| [icon] |                  |
+--------+------------------+
```

The **tab bar** is a narrow vertical strip (36px wide) with icon buttons. It is always visible, even when the sidebar content is collapsed. Clicking a tab:

- expands the sidebar if collapsed
- switches to the corresponding tab content
- clicking the already-active tab toggles the sidebar collapsed/expanded

This follows the VS Code activity bar pattern.

## Tab definitions

Define five tabs. Only the first two need full implementations in M7; the others render placeholder content with a label explaining what will go there.

### Explore (default tab)

Icon: compass or grid icon.

Content: the current NavRail content — SelectionPanel, LayoutPanel, and view toggle pills (TensorOverview). This is the general-purpose exploration surface.

This tab absorbs the existing NavRail content with minimal changes.

### Graph

Icon: node/branch icon.

Content (placeholder in M7): "Transform DAG inspector — see M5". When M5's graph inspection UI is connected, this tab will show the lineage tree, focused node details, and upstream/downstream navigation.

### Tensors

Icon: cube or layers icon.

Content (placeholder in M7): "Tensor browser — see M4". When M4's tensor registry UI is connected, this tab will show available tensors, derived tensors, metadata summaries, and schema details.

### Events

Icon: flag or marker icon.

Content: the event table currently in InspectorPanel, plus the event stream selector. Moving event navigation into its own tab gives it room to grow (filtering, event type toggles, interval browsing) without competing for space in the inspector.

This means InspectorPanel becomes lighter — it retains tensor metadata and selection summary but not the event table.

### Pipeline

Icon: workflow or export icon.

Content (placeholder in M7): "Pipeline export — see M6". When M6's promotion and export UI is connected, this tab will show promoted nodes, pipeline status, and export actions.

## Implementation tasks

### 1. Tab bar component

Create a `SidebarTabBar` component:

```typescript
type SidebarTab = {
  id: string;
  icon: ReactNode;    // inline SVG or emoji for now
  label: string;      // tooltip text
};

type SidebarTabBarProps = {
  tabs: SidebarTab[];
  activeTab: string;
  onTabClick: (tabId: string) => void;
};
```

Render as a vertical strip of icon buttons. The active tab has an accent-colored left border or background highlight.

### 2. Tab content routing

Create a `SidebarContent` component that renders the active tab's content:

```typescript
function SidebarContent({ activeTab }: { activeTab: string }) {
  switch (activeTab) {
    case "explore": return <ExploreTabContent />;
    case "graph":   return <PlaceholderTab label="Transform DAG inspector" />;
    case "tensors": return <PlaceholderTab label="Tensor browser" />;
    case "events":  return <EventsTabContent />;
    case "pipeline":return <PlaceholderTab label="Pipeline export" />;
  }
}
```

Each tab content component is lazy — it renders only when its tab is active. However, tab state should persist when switching away and back (use CSS display toggling or keep components mounted with `hidden`).

### 3. ExploreTabContent

Extract the current NavRail internals into `ExploreTabContent`. This should be a minimal rename/restructure, not a rewrite. The selection controls, layout picker, and view toggles move here.

### 4. EventsTabContent

Move the event table from InspectorPanel into `EventsTabContent`. Add the event stream selector (dropdown for choosing which event stream to browse) if multiple streams exist. Keep the prev/next navigation buttons.

### 5. Update LayoutShell grid

The sidebar column in the grid becomes two sub-columns:

```css
.sidebar-col {
  display: grid;
  grid-template-columns: 36px 1fr;
}
```

When the sidebar is collapsed, the content column (1fr) goes to 0px but the tab bar (36px) remains visible.

### 6. Store integration

Add `activeSidebarTab: string` to the layout state (from prompt 70). Default value: `"explore"`.

The tab click handler:

- if clicking a different tab: set `activeSidebarTab` to the new tab, expand sidebar if collapsed
- if clicking the current tab: toggle `sidebarCollapsed`

## Constraints

- the Explore tab must contain all current NavRail functionality — no regression
- tab content should be lazy but state-preserving
- the tab bar must be visible even when the sidebar content is collapsed
- do not implement full M4/M5/M6 UI in the placeholder tabs — just label placeholders
- event table move from InspectorPanel to Events tab is the only cross-component content migration in this prompt
- icons can be simple Unicode/emoji for now; SVG icon set is a polish concern

## Acceptance criteria

- five tabs are visible in the sidebar tab bar
- clicking a tab switches the sidebar content
- the Explore tab shows all current NavRail controls (no regression)
- the Events tab shows the event table with prev/next navigation
- placeholder tabs show a descriptive label
- clicking the active tab toggles sidebar collapse
- the tab bar remains visible when the sidebar content is collapsed
- switching tabs preserves per-tab scroll position

## Deliverables

- `SidebarTabBar` component
- `SidebarContent` component with tab routing
- `ExploreTabContent` component (extracted from NavRail)
- `EventsTabContent` component (migrated from InspectorPanel)
- `PlaceholderTab` component for Graph, Tensors, Pipeline
- updated `LayoutShell` sidebar column structure
- updated `InspectorPanel` (event table removed)
- `activeSidebarTab` in layout state
