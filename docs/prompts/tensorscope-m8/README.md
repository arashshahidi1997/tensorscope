# M8 — UI Polish, Stable Layout, and PSD Panel

Fixes critical UI bugs and adds the PSD analysis panel.

## Prompt inventory

| # | Title | Batch | Depends on | Files touched |
|---|-------|-------|------------|---------------|
| 80 | Stable slot-based view layout | 1 | — | viewGridLayout.ts, ViewGrid.tsx, WorkspaceMain.tsx, layoutStore.ts, styles.css |
| 81 | Timeseries interaction overhaul | 2 | 80 | TimeseriesSliceView.tsx, useChartTools.ts, ChartToolbar.tsx, selectionStore.ts, styles.css |
| 82 | Sidebar cleanup | 2 | 80 | ExploreTabContent.tsx, SelectionPanel.tsx, ProcessingPanel.tsx, styles.css |
| 83 | PSD server endpoint (cogpy multitaper) | 1 | — | server/state.py, server/models.py |
| 84 | PSD frontend panel (3 linked sub-views) | 3 | 80, 83 | WorkspaceMain.tsx, arrow.ts, new PSD components, styles.css |

## Execution plan

- **Batch 1** (parallel): P80 (frontend layout) + P83 (server PSD endpoint) — no file overlap
- **Batch 2** (parallel): P81 (timeseries) + P82 (sidebar) — no file overlap after P80
- **Batch 3**: P84 (PSD frontend) — needs both P80 layout slots and P83 server data

## Issues addressed

See [../../log/issues-ui.md](../../log/issues-ui.md) for the full issue list.

| Issue | Prompt |
|-------|--------|
| B1: Y-axis zoom resets | P81 |
| B2: View toggle instability | P80 |
| B3: Timeseries goes blank | P81 |
| B4: Propagation frame oversized | P80 |
| F1: Two Y-axis modes | P81 |
| F2: Time scale selector | P81 |
| F3: Relative time labels | P81 |
| F4: Persistent time cursor | P81 |
| F5: PSD panel | P83 + P84 |
| F6: Stable view positions | P80 |
| F7: Sidebar cleanup | P82 |
