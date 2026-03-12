# TensorScope Issue Log

---

## 2026-03-11 — Timeseries view goes blank after every interaction

**Symptom:** The timeseries view (including its x-axis labels) disappears entirely a few seconds after any user interaction, then reappears when new data arrives. Reproducible on every navigator drag-to-zoom and every timeseries click.

**Root cause — three compounding bugs:**

### Bug 1: `setScale` hook fires during chart initialization
**Files:** `NavigatorView.tsx`, `TimeseriesSliceView.tsx`

uPlot fires the `setScale` hook synchronously during `new uPlot(...)` as part of initial scale setup, and again when `setSize` is called in the post-mount `requestAnimationFrame`. Neither view guarded against this, so every chart creation (including recreation after new data arrived) called `onTimeWindowChange` with the data bounds — not just on user gestures.

For `NavigatorView` this was especially bad: the navigator always holds the full data range, so `setTimeWindow([0, fullRange])` was called on every recreation, overriding whatever panned window the user had set.

**Fix:** Added `let initialized = false` inside each chart-creation effect. The `setScale` hook checks `!initialized` and returns early. `initialized` is set to `true` at the end of the rAF callback (after the `setSize` size-correction call), so the resize-correction `setScale` is also suppressed. Each chart recreation gets its own `initialized` because it is a local closure variable.

---

### Bug 2: Navigator drag-to-zoom also fires a `commitSelection` round-trip
**File:** `NavigatorView.tsx` — `attachNavigatorGestures`

Browsers always fire a `click` event after `mouseup`, even at the end of a drag. The navigator's gesture handler registered only a `click` handler with no drag detection. After every drag-to-zoom the handler fired `onSelectTime(t_release)` → `commitSelection({time: t_release})`.

`commitSelection.onSuccess` calls `queryClient.invalidateQueries({queryKey: ["slice"]})`, which marks all active slice queries as stale and immediately triggers refetches. Simultaneously, `initFromDTO` changes all query keys (timecursor + timeWindow). If the new keys had no previous successful cache entry (common during rapid navigation), `placeholderData: keepPreviousData` had nothing to return → `data = undefined` → `WorkspaceMain` renders `null` for the `TimeseriesComponent` → **blank**.

**Fix:** Added `mousedown`/`mousemove` listeners in `attachNavigatorGestures` to track whether the pointer moved more than 5px. The `click` handler bails out if `wasDrag` is true.

---

### Bug 3: `initFromDTO` always resets `timeWindow` to a 2-second span
**File:** `selectionStore.ts` — `initFromDTO`

`initFromDTO` resets `timeWindow` to `[max(0, t-1), t+1]` whenever `dto.time !== s.timeCursor`, i.e. on every selection commit where the cursor moved at all. This meant clicking any point in the timeseries (even one already visible in the current zoomed view) would immediately discard the user's zoom and re-center on a 2-second window after the server round-trip.

Combined with Bug 2, navigator drags consistently produced:
1. `setTimeWindow([t1, t2])` from the drag window (correct)
2. `commitSelection` click-after-drag → `initFromDTO` → `timeWindow = [t_click-1, t_click+1]` (incorrect reset)
3. All queries invalidated → potential blank

**Fix:** Changed the re-centering condition from `dto.time !== s.timeCursor` to `dto.time < s.timeWindow[0] || dto.time > s.timeWindow[1]`. The window is now only re-centered when the cursor jumps **outside** the currently visible range (e.g. jumping to a far-away event). Clicking within the visible range preserves the current zoom level.

---

## 2026-03-11 — M2 Prompt 22: spectrogram/PSD interaction gaps

**Symptom:** Clicking the spectrogram canvas did nothing. Clicking a frequency in the PSD view did not update the freq cursor in the spectrogram or elsewhere. The spectrogram re-rendered the full `ImageData` on every React render (including cursor moves).

**Fixes applied (Prompt 22):**

| Gap | File | Fix |
|---|---|---|
| ImageData recreated on every render | `SpectrogramView.tsx` | Wrap decode in `useMemo([slice.payload])` |
| No freq cursor on spectrogram | `SpectrogramView.tsx` | Add horizontal CSS `div` overlay keyed to `selection.freq` |
| Spectrogram click does nothing | `SpectrogramView.tsx` | Canvas click handler (stable ref pattern) → `onSelectTime` + `onSelectFreq` |
| PSD click does not update store | `PSDSliceView.tsx` | `chart.over` click listener → `onSelectFreq` via stable ref |
| `onSelectFreq` not in props | `viewTypes.ts` | Add `onSelectFreq?: (freq: number) => void` |
| Freq callback not wired in orchestrator | `WorkspaceMain.tsx` | `handleSelectFreq = useCallback((freq) => setFreq({freq}), [setFreq])` passed to both views |
| Navigator not on uPlot sync bus | `NavigatorView.tsx` | Already had `cursor: { sync: { key: "tsscope-time" } }` — no change needed |

**Design note:** `onSelectFreq` is store-local (calls `setFreq`, not `onCommitSelection`). Freq changes do not trigger a server round-trip because the spectrogram and PSD views already render the full frequency range; only the cursor overlay position changes.
