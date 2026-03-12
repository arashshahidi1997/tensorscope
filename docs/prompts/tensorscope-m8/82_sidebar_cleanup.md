# P82 — Sidebar Cleanup

**Fixes:** F7 (drop layout panel, reorganize sidebar)

## Problem

The Explore tab sidebar contains a non-functional LayoutPanel (server-side presets that don't match client-side M7 presets), prominent selection widgets, and a small processing section. The user wants:
- Drop the Layout panel entirely
- Selection widgets less visible (bottom of sidebar, collapsed by default)
- Processing panel as a larger, vertically collapsible section

## Changes

### 1. Remove LayoutPanel from ExploreTabContent

Delete the `<LayoutPanel>` JSX and its import. The client-side `LayoutPresetPicker` in the topbar (from M7) replaces this functionality.

### 2. Reorder sidebar sections

New order in ExploreTabContent:
1. **Processing** (top, prominent) — collapsible section with header bar "Processing"
2. **Selection** (bottom, collapsed by default) — collapsible section with header "Selection"

### 3. Collapsible section component

Create a `CollapsibleSection` component:

```tsx
type CollapsibleSectionProps = {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
};

function CollapsibleSection({ title, defaultOpen = true, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="collapsible-section">
      <button className="collapsible-header" onClick={() => setOpen(!open)}>
        <span className="collapsible-chevron">{open ? "▾" : "▸"}</span>
        <span className="collapsible-title">{title}</span>
      </button>
      {open && <div className="collapsible-body">{children}</div>}
    </div>
  );
}
```

### 4. Updated ExploreTabContent

```tsx
export function ExploreTabContent({ onCommitSelection }: ExploreTabContentProps) {
  // ... existing hooks ...
  return (
    <>
      <CollapsibleSection title="Processing" defaultOpen={true}>
        {processingQuery.data && (
          <ProcessingPanel
            params={processingQuery.data}
            onApply={(p) => setProcessingMutation.mutate(p)}
            isPending={setProcessingMutation.isPending}
          />
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Selection" defaultOpen={false}>
        <SelectionPanel
          selection={selectionDraft}
          onSelectionChange={patchFromDTO}
          onCommit={() => onCommitSelection(selectionDraft)}
        />
      </CollapsibleSection>
    </>
  );
}
```

### 5. CSS for collapsible sections

```css
.collapsible-section {
  border-bottom: 1px solid var(--border);
}

.collapsible-header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px 12px;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  cursor: pointer;
}

.collapsible-header:hover {
  color: var(--text-primary);
  background: var(--hover-bg);
}

.collapsible-body {
  padding: 0 12px 12px;
}
```

## Files to modify

- `frontend/src/components/layout/ExploreTabContent.tsx` — remove LayoutPanel, reorder, wrap in CollapsibleSection
- `frontend/src/styles.css` — add collapsible section styles

## Files to create

- `frontend/src/components/layout/CollapsibleSection.tsx` — reusable collapsible wrapper

## Files NOT to modify

- `SelectionPanel.tsx`, `ProcessingPanel.tsx` — content unchanged, only wrapped differently
- `LayoutPanel.tsx` — keep the file (may be useful later), just remove the import from ExploreTabContent

## Acceptance criteria

- LayoutPanel is no longer visible in sidebar
- Processing is the first section, expanded by default
- Selection is below Processing, collapsed by default
- Clicking section headers toggles open/closed with chevron indicator
- Build passes, all tests pass
