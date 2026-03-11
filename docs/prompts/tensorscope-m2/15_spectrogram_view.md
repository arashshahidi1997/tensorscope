# Prompt 15: Spectrogram View

Read first:

- [00_context.md](./00_context.md)
- [12_data_source.md](./12_data_source.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: improve the existing `SpectrogramView` component.

Context:

`SpectrogramView` is already implemented at
`frontend/src/components/views/SpectrogramView.tsx`.
It uses Canvas 2D with an inferno-like colormap and renders a time-cursor overlay.
It is fully wired in `WorkspaceMain` via `spectrogramSliceQuery`.
The server already computes the spectrogram (multitaper) and returns it as a
pre-computed `(time, freq, AP, ML)` tensor — there is no FFT to implement on
the frontend.

Scope:

- axis labels (time axis, frequency axis)
- cursor/crosshair synced bidirectionally to `selection.time` via `onSelectTime`
- `onTimeWindowChange` feedback loop (clicking/dragging the spectrogram updates the shared time window)
- color-scale controls (min/max normalization, optional log scale toggle)

Implementation Tasks:

- read the current `SpectrogramView` implementation
- add labeled time and frequency axes below/beside the canvas
- wire a click handler so clicking a time position calls `onSelectTime`
- expose a simple color-scale control (linear/log toggle + manual clamp inputs)
- ensure the selected-time cursor updates from shared navigation state without
  triggering a full canvas redraw (use an overlay div, as already done)

Constraints:

- do not replace the existing Canvas 2D renderer
- do not push hot rendering updates through React rerender loops
- keep the component inside the existing `SliceViewProps` contract

Acceptance Criteria:

- time and frequency axes are visible and correctly labeled
- clicking the spectrogram updates `selection.time` in shared state
- color-scale controls work without full canvas recreations
- the component continues to fit the existing workspace-shell model

Deliverables:

- updated `SpectrogramView` with axis labels, cursor interaction, and color controls

## Reference

Observable Plot's `Raster` mark (`src/marks/raster.js`) provides three directly applicable patterns:

**`imageRendering: "pixelated"`**: Plot sets this CSS property on the canvas-inside-SVG embedding to suppress browser bilinear blurring when adjacent spectrogram bins share pixel edges. TensorScope's Canvas 2D spectrogram should apply the same: `canvas.style.imageRendering = "pixelated"` prevents frequency-bin smearing at low zoom levels where one bin covers multiple pixels.

**NaN gap encoding for missing epochs** (`src/defined.js`): gaps in the time axis (recording interruptions, artefact rejection windows) should be encoded as `NaN` in the sample buffer — not as removed rows. This preserves index alignment with the frequency axis and keeps the canvas-fill loop index-stable. The pattern: `defined(x) = x != null && !isNaN(x)`; skip the pixel fill when `!defined(value)` rather than reshaping the arrays.

**`apply` / `invert` scale objects for click-to-select** (`src/scales.js`, `exposeScale()`): clicking the spectrogram canvas must convert `(pixelX, pixelY)` to `(time, freq)`. Plot materialises explicit `{ apply, invert, domain, range }` scale objects separate from the renderer. TensorScope should derive `timeScale` and `freqScale` from the Arrow payload metadata during decode in `frontend/src/api/arrow.ts`, then pass them to `SpectrogramView` so the click handler calls `timeScale.invert(px)` / `freqScale.invert(py)` rather than computing pixel-to-data coordinates inline.

See [docs/reference-studies/observable-plot.md §2.3, §2.7, §2.10](../../reference-studies/observable-plot.md).

Perspective's `draw()` / `update()` two-phase render pattern (`packages/viewer-d3fc/src/ts/plugin/plugin.ts`, `rust/perspective-viewer/src/rust/renderer.rs`) is directly applicable to the spectrogram:

- **`draw()`** — full canvas setup: allocate the ImageData buffer, compute the colormap LUT from `colorMin`/`colorMax`, derive `timeScale` and `freqScale`, draw axis labels. Runs once on mount and whenever canvas dimensions or color range change.
- **`update()`** — incremental data: paint new time slice pixels using the existing LUT and scales. Runs on every React Query cache update. Avoids redundant scale and label recomputation on pan.

Perspective dispatches `draw()` with an exclusive lock and `update()` with a debounced lock — rapid successive update calls coalesce into one paint. Implement in TensorScope via a `useRef`-held debounce on the `update()` path.

**Staged render guard**: Perspective checks `offsetParent === null` before painting; if the element is hidden (inactive tab, collapsed panel), it stores a `staged` flag and defers until the next `resize()` or visibility change. TensorScope should add the same guard via `IntersectionObserver` before the canvas-fill loop.

See [docs/reference-studies/perspective.md §2d, §3a, §4c](../../reference-studies/perspective.md).
