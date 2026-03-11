# Prompt 17: Linked Crosshair

Read first:

- [00_context.md](./00_context.md)
- [15_spectrogram_view.md](./15_spectrogram_view.md)
- [16_channel_grid_view.md](./16_channel_grid_view.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: implement cross-view cursor linking.

Scope:

- shared cursor state
- hover events
- crosshair overlay

Implementation Tasks:

- define the minimal shared cursor contract
- separate transient hover/cursor state from committed navigation state where needed
- specify overlay behavior for views that can render a crosshair
- keep the design compatible with timeseries, spectrogram, and channel-grid views

Constraints:

- do not wire views together directly
- avoid React rerender loops for hover-frequency updates
- keep cursor linking distinct from event selection and time-window changes

Acceptance Criteria:

- hover in one view updates cursor in others
- the crosshair contract is shared and explicit
- cursor updates remain lightweight enough for interactive use

Deliverables:

- prompt-ready linked-crosshair design
- bounded implementation target for one future agent run

## Reference

HiGlass's linked crosshair design addresses exactly this problem across multiple track types. Three patterns are applicable:

**Pub/sub over React state for hot-path events** (`Track.js`, `AGENTS.md`): HiGlass routes `app.mouseMove` through a pub/sub bus rather than React state, because React `setState` cannot sustain 60fps cursor updates. For TensorScope, uPlot already handles its own canvas crosshair internally — cross-panel cursor sync should go through a ref-backed store update or lightweight pub/sub, not through Zustand subscribers that trigger re-renders.

**Data-coordinate crosshair, not pixel crosshair** (`utils/show-mouse-position.js`): the crosshair position is expressed in data coordinates (time, channel index), not pixels. This allows all linked panels to reproject the same cursor into their own coordinate space. TensorScope should adopt the same: `timeCursor` in the shared store is a data-domain value, each view converts to its local pixel space.

**`brushed` vs `brushedEnded` split**: live updates during drag (for cursor overlay and lightweight indicators) vs. committed updates on release (for expensive backend slice requests). This split is the correct UX contract for TensorScope's time cursor: update the crosshair overlay on every pointer event, commit `timeWindow` changes only on drag-end.

See [docs/reference-studies/higlass.md §2.7, §2.8, §2.9](../../reference-studies/higlass.md).

Observable Plot's pointer interaction (`src/interactions/pointer.js`) adds two complementary patterns:

**WeakMap state + `requestAnimationFrame` batching**: Plot stores per-plot crosshair state in a `WeakMap<SVGElement, PointerState>` rather than React state. `rAF` batches `pointermove` events so multiple panels receive the same move event within one frame, and only the panel with the smallest data-space distance wins the cursor. For TensorScope's linked cursor: write the cursor position to a `ref`-backed store (not Zustand) on every `pointermove`, flush to a shared `rAF` callback, pick the winning panel, then update only the cursor overlay — no React re-render.

**Axis-weighted proximity (`kx / ky`)**: the proximity metric for "which panel won" is data-type-specific. Plot uses `(1, 0.01)` weighting for horizontal-axis snapping (PSD curves: snap to nearest freq bin, ignore amplitude distance) and `(1, 1)` for 2D views. TensorScope should codify this: for the spectrogram, equal `(1, 1)` weighting in `(time, freq)` is correct; for the PSD view, `pointerX`-style weighting (snap to nearest frequency, ignore power distance) is the correct default.

See [docs/reference-studies/observable-plot.md §2.4, §2.6, §3.2](../../reference-studies/observable-plot.md).

uPlot's named sync bus (`src/sync.js`) is the most directly applicable production implementation since TensorScope already uses uPlot:

```javascript
// uPlot sync bus — keyed registry, zero coupling between panels
const bus = uPlot.sync("tensorscope");   // shared key
// each chart panel opts:
{ cursor: { sync: { key: "tensorscope", setSeries: true } } }
// bus.pub(type, self, x, y, w, h, i) broadcasts to all other subscribers
```

The sync bus emits normalized `(type, x, y, w, h, i)` cursor events. Each subscribing chart maps the incoming normalized X position back to its own scale via `posToVal` — so the multichannel timeseries, spectrogram, and event timeline all share one `timeCursor` without knowing about each other. Key patterns:

- **Named key = decoupling mechanism**: charts opt in by passing the same key; no direct references between panels.
- **`setSeries`**: when set, the bus also propagates which series is highlighted, enabling cross-panel channel focus.
- **Runtime detach**: call `bus.unsub(plot)` to detach a panel for independent inspection — exposes a "Detach from sync" toolbar toggle.
- **`cursor.lock`** (`cursor.lock = true` on click): freezes the crosshair in place while the user reads values in the legend; click again to unlock. Directly applicable to TensorScope's inspection mode where the user locks the time cursor and inspects channel values without accidental moves.

The `setScale` hook is the recommended trigger for backend re-fetch after a zoom gesture:

```
setScale → debounce(100ms) → update selectionStore.timeWindow → React Query re-fetch
```

This keeps the zoom-to-refetch loop entirely within uPlot's existing hook system with no extra event wiring.

See [docs/reference-studies/uPlot.md §2.1, §3.1, §3.3](../../reference-studies/uPlot.md).
