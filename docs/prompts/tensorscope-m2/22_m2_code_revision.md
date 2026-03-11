# Prompt 22: M2 Code Revision

Read first:

- [00_context.md](./00_context.md)
- [15_spectrogram_view.md](./15_spectrogram_view.md)
- [17_linked_crosshair.md](./17_linked_crosshair.md)
- [21_renderer_abstraction.md](./21_renderer_abstraction.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

## Purpose

The M2 views were implemented before the reference studies (uPlot, nivo, Observable Plot,
Perspective) were analysed. This prompt fixes concrete correctness and linkage gaps exposed
by those studies. It is a targeted revision pass — not a rewrite.

## Current state (what was implemented)

| File | Lines | State |
|---|---|---|
| `frontend/src/components/views/SpectrogramView.tsx` | 100 | Canvas heatmap; time cursor div overlay; **no interaction; no memoization** |
| `frontend/src/components/views/PSDSliceView.tsx` | 69 | uPlot PSD curve; reads `selection.freq` → cursor position; **no click → store** |
| `frontend/src/components/views/TimeseriesSliceView.tsx` | 329 | uPlot timeseries; gesture layer; event markers; `cursor.sync: { key: "tsscope-time" }`; `setScale` hook wired |
| `frontend/src/components/views/viewTypes.ts` | 20 | `SliceViewProps`; **no `onSelectFreq` callback** |
| `frontend/src/components/views/WorkspaceMain.tsx` | 169 | Orchestrator; **passes no freq callback to spectrogram or PSD** |

## Gaps to fix (ordered by impact)

### Gap 1 — SpectrogramView: data decode runs every render (critical performance bug)

`decodeArrowSlice` and `extractSpectrogram` are called at the top of the component
without `useMemo`. Arrays are re-created on every React render, so `useEffect([times,
freqs, values])` fires and redraws the full `ImageData` even when only `selection.time`
changes (which only needs to move a CSS div).

**Fix:** wrap the decode in `useMemo` keyed to `slice.payload`, matching the pattern in
`PSDSliceView.tsx`:

```typescript
const { times, freqs, values } = useMemo(() => {
  const decoded = decodeArrowSlice(slice);
  return extractSpectrogram(decoded);
}, [slice.payload]);
```

This implements the Perspective `draw` / `update` split: heavy `ImageData` creation only
fires on data change; cursor overlays update as CSS div repositioning (already correct).

See [docs/reference-studies/perspective.md §2d](../../reference-studies/perspective.md)
and [docs/reference-studies/uPlot.md §4.3](../../reference-studies/uPlot.md) (under/over
layer model).

---

### Gap 2 — `SliceViewProps`: missing `onSelectFreq` callback

Add one optional callback to `viewTypes.ts`:

```typescript
/**
 * Called when the user clicks a frequency position in a view that has a freq axis.
 * Store-local update — no server round-trip needed.
 * Views that publish freq changes participate in the spectrogram ↔ PSD crosshair contract.
 */
onSelectFreq?: (freq: number) => void;
```

---

### Gap 3 — SpectrogramView: no click interaction

The spectrogram displays `selection.time` and `selection.freq` cursors but clicking the
canvas does nothing. Both axes need click-to-select.

**Add a click handler to the canvas** (attach via `useEffect` after mount, stable ref
pattern consistent with `TimeseriesSliceView`):

```typescript
const onSelectTimeRef = useRef(onSelectTime);
const onSelectFreqRef = useRef(onSelectFreq);
useEffect(() => { onSelectTimeRef.current = onSelectTime; });
useEffect(() => { onSelectFreqRef.current = onSelectFreq; });

// In mount useEffect (separate from ImageData effect):
const canvas = canvasRef.current;
const handleClick = (e: MouseEvent) => {
  const rect = canvas.getBoundingClientRect();
  const xFrac = (e.clientX - rect.left) / rect.width;
  const yFrac = (e.clientY - rect.top) / rect.height;
  // x → time (left=tMin, right=tMax)
  const t = tMin + xFrac * (tMax - tMin);
  // y → freq: canvas origin is top = fMax (freq increases downward in screen space)
  const f = fMax - yFrac * (fMax - fMin);
  if (Number.isFinite(t)) onSelectTimeRef.current?.(t);
  if (Number.isFinite(f)) onSelectFreqRef.current?.(f);
};
canvas.addEventListener("click", handleClick);
return () => canvas.removeEventListener("click", handleClick);
```

`tMin`, `tMax`, `fMin`, `fMax` must be stable refs (or the handler must read them from
a ref), so the listener does not need to be reattached on every cursor update.

---

### Gap 4 — SpectrogramView: no freq cursor overlay

The time cursor is already a CSS `div` positioned by `selection.time`. Add an analogous
horizontal line for `selection.freq`:

```tsx
{/* Freq cursor — horizontal line */}
{fMax > fMin && selection?.freq != null && (
  <div
    style={{
      position: "absolute",
      left: 0,
      right: 0,
      // freq=fMax → top=0; freq=fMin → top=100%
      top: `${((fMax - selection.freq) / (fMax - fMin)) * 100}%`,
      height: "1px",
      background: "rgba(115,210,222,0.7)",
      pointerEvents: "none",
    }}
  />
)}
```

Both cursor overlays are CSS `div` elements on top of the canvas — no canvas repaint on
cursor movement. This is the uPlot `u-cursor-x / u-cursor-y` pattern applied to the
custom canvas view.

See [docs/reference-studies/uPlot.md §4.3](../../reference-studies/uPlot.md).

---

### Gap 5 — PSDSliceView: click does not update store freq

`PSDSliceView` already reads `selection.freq` and positions the uPlot cursor. The reverse
direction — user clicks a frequency → store updates — is missing.

**Add a click hook on the uPlot chart:**

```typescript
const onSelectFreqRef = useRef(onSelectFreq);
useEffect(() => { onSelectFreqRef.current = onSelectFreq; });
```

Inside the chart-creation `useEffect`, register an `onclick` on `chart.over`:

```typescript
chart.over.addEventListener("click", (e: MouseEvent) => {
  const rect = chart.over.getBoundingClientRect();
  const freq = chart.posToVal(e.clientX - rect.left, "x");
  if (Number.isFinite(freq)) onSelectFreqRef.current?.(freq);
});
```

This completes the bidirectional freq link:
`store.freq → chart cursor position` (already done)
`chart click → store.freq` (new)

---

### Gap 6 — WorkspaceMain: wire `onSelectFreq` to both views

In `WorkspaceMain`, derive a stable `handleSelectFreq` callback and pass it to both
spectrogram and PSD:

```typescript
const { setFreq } = useSelectionStore();
const handleSelectFreq = useCallback((freq: number) => setFreq(freq), [setFreq]);
```

Pass to both views:

```tsx
<SpectrogramComponent
  slice={spectrogramSliceQuery.data}
  selection={selectionDraft}
  onSelectTime={(t) => onCommitSelection({ ...selectionDraft, time: t })}
  onSelectFreq={handleSelectFreq}
/>

<PSDComponent
  slice={psdSliceQuery.data}
  selection={selectionDraft}
  onSelectFreq={handleSelectFreq}
/>
```

`setFreq` is store-local — no server round-trip. The selection store already has a
`setFreq` action; it updates `SelectionState.freq.freq`. All views that read
`selection.freq` (spectrogram freq cursor, PSD cursor) update automatically.

---

### Gap 7 — NavigatorView: opt in to uPlot time sync bus

`TimeseriesSliceView` already registers `cursor.sync: { key: "tsscope-time" }`. If
`NavigatorView` also uses uPlot (check the implementation), it should join the same
bus so hover position is mirrored between the navigator and the main timeseries without
any extra wiring:

```typescript
cursor: { sync: { key: "tsscope-time" } }
```

Only add this if NavigatorView does not already have it. The sync bus is zero-cost for
panels that are not hovered — it only fires `pub()` from the active panel.

See [docs/reference-studies/uPlot.md §2.1](../../reference-studies/uPlot.md).

---

## Constraints

- Do not change the server API or any Pydantic models — all changes are frontend-only.
- `onSelectFreq` is store-local (call `setFreq`, not `onCommitSelection`); freq changes
  do not need a server round-trip because views already compute PSD and spectrogram over
  the full freq range and project the cursor client-side.
- Do not add `useMemo` or `useCallback` wrapping beyond what is listed above. The intent
  is targeted fixes, not a broad optimization pass.
- Keep all hooks before any conditional `return null` (Rules of Hooks).
- SpectrogramView canvas click handler must use stable callback refs (same pattern as
  `TimeseriesSliceView`'s gesture layer) — not inline functions that would re-attach on
  every render.

## Acceptance Criteria

- Clicking the spectrogram canvas calls `onSelectTime` and `onSelectFreq` with
  data-coordinate values derived from the click position.
- Clicking a frequency in the PSD view calls `onSelectFreq`.
- Both `selection.time` (vertical line) and `selection.freq` (horizontal line) are
  visible as CSS overlays on the spectrogram canvas.
- The PSD cursor moves to `selection.freq` as before.
- The spectrogram `ImageData` is not recreated when `selection.time` or `selection.freq`
  changes (only when `slice.payload` changes).
- Clicking in either spectrogram or PSD updates the freq cursor in the other view.
- All existing tests pass (`npm run test`).

## Deliverables

- Revised `frontend/src/components/views/viewTypes.ts` (add `onSelectFreq`)
- Revised `frontend/src/components/views/SpectrogramView.tsx` (memoize, cursors, click)
- Revised `frontend/src/components/views/PSDSliceView.tsx` (click → onSelectFreq)
- Revised `frontend/src/components/views/WorkspaceMain.tsx` (wire onSelectFreq, handleSelectFreq)
- Optionally revised `NavigatorView.tsx` (add sync bus key if not already present)

## Reference

uPlot `valToPos` / `posToVal` — bidirectional coordinate conversion used in both Gap 3
(spectrogram canvas) and Gap 5 (PSD click). These are the same functions used in
`TimeseriesSliceView` for cursor placement (`chart.valToPos(selection.time, "x")`).

See [docs/reference-studies/uPlot.md §2.7, §4.3](../../reference-studies/uPlot.md),
[docs/reference-studies/perspective.md §2d](../../reference-studies/perspective.md),
and [docs/reference-studies/observable-plot.md §2.4](../../reference-studies/observable-plot.md).
