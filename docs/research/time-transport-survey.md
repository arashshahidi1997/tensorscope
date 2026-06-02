# Time-transport survey — how mature multichannel viewers manage the time cursor + window

**Status:** survey complete; informs a future `docs/design/time-transport.md`
**Author:** agent (drafted 2026-06-02)
**Scope:** TensorScope's *time-navigation control* architecture — the cursor, the
visible window, and the widgets that drive them. (Distinct from
[`transport-survey.md`](transport-survey.md), which covered the *wire format*.)
**Corpus:** `resources/` — added the four domain ephys viewers that were missing
from the earlier survey: `ephyviewer`, `mne-qt-browser`, `phy`, `open-ephys-gui`,
plus the existing `neuroglancer` and `higlass`.

## TL;DR

Every mature multichannel timeseries viewer converges on the **same four rules**,
and TensorScope currently breaks all four:

1. **One owner of `{cursor, window}`.** A single object holds current-time and
   window-width; every view is a stateless observer that reads from it. No view
   keeps its own copy.
2. **Window width is ONE number** (`xsize` / `duration` / `interval` / `timebase`),
   never a separate "duration" *and* a `[t0,t1]` tuple that can disagree.
3. **Mutation is optimistic and synchronous.** A seek/pan/zoom updates the source
   and redraws immediately; nothing waits on the network.
4. **Rapid gestures are rate-limited** (timer-cadence render, adaptive
   downsample, or an explicit debounce) — never one network/compute job per
   pixel.

TensorScope instead has **three** representations of window state in the store
(`timeCursor`, `timeWindow`, `viewportDuration`) plus **three** draft mirrors in
the widgets, routes the cursor through a **blocking server round-trip**, and has
**no debounce** between a drag and the slice refetch. See
[§ What TensorScope does differently](#what-tensorscope-does-differently).

## The convergent model (with source citations)

### ephyviewer — the canonical reference (`resources/ephyviewer`)

The cleanest expression of the model, in ~300 lines:
[`ephyviewer/navigation.py`](../../resources/ephyviewer/ephyviewer/navigation.py).

- **One owner.** `NavigationToolBar` holds `self.t` (current time, s — line 186)
  and the window width in a single `spinbox_xsize` (default 3 s — line 163).
  Bounds are `t_start`/`t_stop` (line 215–216).
- **Two signals, broadcast to all views.** `time_changed = pyqtSignal(float)` and
  `xsize_changed = pyqtSignal(float)` (lines 21–22). Sub-views connect and
  implement `seek(t)` / `set_xsize()` — they hold no time state of their own.
- **One mutator, with echo-suppression.** `seek(t, ...)` (line 260) is the *only*
  way time changes: it clamps to `[t_start, t_stop]`, then refreshes the
  scrollbar and spinbox **after disconnecting their `valueChanged` signal and
  reconnecting it** (lines 271–279) so the refresh can't re-fire `seek`, then
  emits `time_changed` once (line 287). This disconnect/reconnect discipline is
  exactly what prevents the "widget clobbers widget" feedback loops — and it is
  precisely what TensorScope's draft-mirror widgets lack.
- **Width is one number.** `xsize` is a single scalar; the window is derived as
  `[t, t+xsize]` by each view. There is no second "window tuple" to drift.
- **Play is wall-clock based.** `on_timer_play_interval` advances by the *real*
  elapsed time `(actual_time - last_time) * speed` (line 208), not a fixed step —
  so playback doesn't accumulate drift. (Contrast TensorScope's
  `AnimationController`, which drops the sub-interval remainder.)

### mne-qt-browser (`resources/mne-qt-browser`)

`src/mne_qt_browser/_pg_figure.py`:
- **Single source:** `self.mne.t_start` + `self.mne.duration` (one start, one
  width) on the central `self.mne` namespace.
- **Sync via one signal:** pyqtgraph's `sigXRangeChanged` → `_xrange_changed`
  writes `t_start`/`duration` and calls `_redraw()`. The `TimeScrollBar` reads
  `t_start`/`duration` and calls `plt.setXRange(value, value+duration)` — no
  local copy.
- **Optimistic:** `setXRange` emits synchronously; redraw is immediate.
- **Rate-limiting:** no explicit debounce, but `_apply_downsampling()` adapts data
  resolution to the visible range, so the redraw cost is bounded regardless of
  zoom.

### phy (`resources/phy`)

`phy/cluster/views/trace.py` + `phy/plot/panzoom.py`:
- **Single source:** `TraceView._interval = (start, end)` in seconds is the truth
  for the visible range; `time` is the derived center `sum(interval)*0.5` and
  `half_duration` the derived half-width. Width is **derived**, never stored
  twice.
- **Sync via emit/connect:** `set_interval()` mutates `_interval` and emits
  `time_range_selected`; `PanZoom` setters emit `pan`/`zoom`. All synchronous.
- **Seek:** `go_to(time)` → `set_interval((time-half, time+half))` → redraw.
  Immediate; no pending state.

### OpenEphys GUI (`resources/open-ephys-gui`, C++)

`Plugins/LfpViewer/LfpDisplayCanvas.{h,cpp}`:
- **Single source:** `timebase` (seconds-per-screen, one float) + per-channel
  `screenBufferIndex` playhead. `setTimebase(float)` is the one setter.
- **Rate-limiting by construction:** rendering is driven by a JUCE `Timer`
  (`timerCallback` → `refresh()`), so no matter how fast the UI fires, only the
  latest state is drawn at the timer cadence. This is the "throttle the render,
  not the input" pattern.

### Neuroglancer & HiGlass (already in `resources/`)

- **Neuroglancer:** time is just another coordinate in a single `Position`
  ([`navigation_state.ts:169`](../../resources/neuroglancer/src/navigation_state.ts))
  built on `TrackableValue<T>` with a `changed` signal
  ([`trackable_value.ts`](../../resources/neuroglancer/src/trackable_value.ts)).
  One observable, many watchers, serializable to the URL. `LinkedPosition` links
  views without copying. Pan renders what's in GPU memory **immediately**, then
  the worker fetches the rest — never blocks on the network.
- **HiGlass:** location is one D3 scale; pan is an **optimistic GPU transform**
  applied synchronously, with a **~100 ms debounced** background fetch and "old
  tiles stay visible." (Per [`transport-survey.md`](transport-survey.md).)

### Side-by-side

| Aspect | ephyviewer | mne-qt-browser | phy | OpenEphys | Neuroglancer | **TensorScope** |
|---|---|---|---|---|---|---|
| Cursor + window owner | `NavigationToolBar` | `self.mne` | `TraceView._interval` | `timebase`+playhead | `Position` | **store (3 fields) + 3 widget drafts** |
| Window width | 1 (`xsize`) | 1 (`duration`) | derived | 1 (`timebase`) | derived | **2 (`viewportDuration` ≠ `timeWindow` width)** |
| Views hold own copy? | no | no | no | no | no | **yes (draft mirrors)** |
| Cursor update | optimistic | optimistic | optimistic | optimistic | optimistic | **blocking server PUT** |
| Echo-suppression on refresh | yes (disconnect) | n/a (single signal) | n/a | n/a | n/a | **no — drafts clobber edits** |
| Rapid-gesture limiter | adaptive | adaptive downsample | waveform-skip flag | timer-cadence render | worker queue | **none — refetch per frame** |

## What TensorScope does differently

Cross-referenced with the code audit (this branch). The frontend has **six**
widgets that all write time — `NavigatorView`, `TimeseriesNavStrip`,
`TimeScaleBar`/`ChartToolbar`, `SelectionPanel`, `AnimationController`, and the
`TimeseriesSliceView` gestures — over a store with three overlapping fields.

1. **Two sources of truth for window width.** `setTimeWindow`
   (`store/selectionStore.ts:84`) never updates `viewportDuration`, so after any
   navigator/timeseries zoom the two diverge; the next cursor recenter rebuilds
   the window from the *stale* `viewportDuration`. (ephyviewer/phy/mne all keep
   one number.)
2. **Cursor is a blocking round-trip.** A click → PUT `/api/v1/selection` →
   `initFromDTO` → N view refetches. The crosshair doesn't move until the PUT
   returns. (All six reference viewers update the cursor synchronously and
   reconcile async, if at all.)
3. **Draft mirrors clobber in-progress edits.** `TimeseriesNavStrip`,
   `TimeScaleBar`, and the NavStrip drag each keep a `useState` copy re-synced by
   an unconditional `useEffect`; an external cursor tick wipes a half-typed value.
   ephyviewer's `seek()` shows the fix: disconnect the widget signal, set the
   value, reconnect.
4. **No debounce → refetch storm.** Pan publishes `setTimeWindow` per mousemove
   frame → new slice fetch per frame. (HiGlass debounces 100 ms; OpenEphys
   renders at timer cadence; mne/phy bound cost via adaptive downsampling.)
5. **Float-equality sentinels.** `initFromDTO` detects "first load" via
   `timeWindow === [0,2]` (`selectionStore.ts:169`); `TimeScaleBar` highlights a
   preset via `viewportDuration === ts.seconds`. Both fail under FP drift. No
   reference viewer keys logic on float equality.

## Recommendation (one refactor dissolves most findings)

Adopt the convergent model:

- **Collapse to one `{ cursor, window:[t0,t1] }` source of truth.** Delete the
  separate `viewportDuration` field; derive `duration = t1 - t0`. (ephyviewer
  `xsize`, mne `duration`, phy derived.)
- **Widgets become thin controllers:** one setter in, render from the store out,
  zero local mirrors. Where a controlled input needs to avoid echo, copy
  ephyviewer's disconnect/set/reconnect rather than a sync `useEffect`.
- **Update the cursor optimistically;** reconcile the server response
  asynchronously (it already returns the same value). Never block the crosshair
  on the PUT.
- **Debounce the window→fetch edge (~100 ms, HiGlass's number)** and keep the
  existing render-from-cache so the canvas never blanks during the debounce.
- **Replace float sentinels** with an explicit `hasInitialized` flag.

This removes findings 1–5 above at once. Sizing: the store + widget rewrite is
the bulk; the optimistic-cursor change touches the `commitSelection` path in
`App.tsx`.

## Corpus additions (this session)

Cloned `--depth 1` into `resources/` (git-ignored, embedded repos, same
convention as the existing reference clones), and registered the three missing
viewers in the lab `codio` registry (Open Ephys `plugin_gui` was already there):

- [`resources/ephyviewer`](../../resources/ephyviewer) — NeuralEnsemble/ephyviewer
- [`resources/mne-qt-browser`](../../resources/mne-qt-browser) — mne-tools/mne-qt-browser
- [`resources/phy`](../../resources/phy) — cortex-lab/phy
- [`resources/open-ephys-gui`](../../resources/open-ephys-gui) — open-ephys/plugin-GUI

## Cross-refs

- Wire-format survey (sibling): [`transport-survey.md`](transport-survey.md)
- Existing nav contract doc: `frontend/src/components/views/useOverviewDetail.ts`
- Design doc to write next: `docs/design/time-transport.md`
