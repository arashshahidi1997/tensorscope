# Propagation playback — spatial dynamics over time

**Status:** implemented (2026-06-03) — see ADR-0008
**Created:** 2026-06-03
**Tracks:** survey of the animation panel (this branch)
**Builds on:** [`time-transport.md`](time-transport.md) (the cursor/window owner), ADR-0007
**Original specs:** `docs/prompts/tensorscope-m3/34_propagation_view.md`,
`35_animation_controller.md` (M3-era; this doc supersedes their playback model).

The "animation panel" is [`PropagationController`](../../frontend/src/components/views/PropagationController.tsx) —
the chrome around the `propagation_frame` spatial view that plays an AP×ML
spatial grid forward in time. This doc captures what it does, the problems the
2026-06-03 survey found, and the design we converged on.

## Modes

| Mode | Engine | Drives global cursor? |
|---|---|---|
| **movie** 🎬 *(default)* | [`PropagationMoviePlayer`](../../frontend/src/components/views/PropagationMoviePlayer.tsx) — preload N frames once via `propagation_movie`, RAF over cached cells | **Yes, every frame** (throttled, toggleable) |
| **player** ▶ | [`AnimationController`](../../frontend/src/components/controls/AnimationController.tsx) RAF → `setTimeCursor` → one `propagation_frame` fetch per tick | Yes (it *is* the cursor) |
| **event** ⚡ | Movie player, window auto-centered on the cursor ±Δs | Yes, every frame |
| **strip** ⊟ / **tiled** ⊞ | N `propagation_frame` fetches, static thumbnail grid | No |

Backend (`server/state.py`): `propagation_frame` selects the nearest time
(`frame_time`) → one (AP, ML) slice. `propagation_movie` keeps the time axis,
returns N evenly-spaced frames as one (time, AP, ML) cube. Neither reads
`selection.time` for the movie/timeseries/spectrogram data path — only
`time_range` / `frame_time` (see "cursor decoupling" below).

## What the survey found (and what we changed)

### 1. The default was the slow path, and it cascaded — FIXED

`player` mode fetched a full `propagation_frame` per cursor tick (network-bound,
stutters at playback rates), and because `AnimationController` drives the
*global* cursor across the whole recording, each tick that left the visible
window recentered it (`selectionStore.setTimeCursor` → `centeredWindow`),
re-keying every window-bound view (timeseries/spectrogram/psd — multi-MB +
cogpy compute per the numbers in `time-transport.md`). On the 733 MB iEEG / NP
sessions that path is effectively unusable, yet it was the default.

**Fix:** `movie` is the default. It fetches the whole window *once*, decodes the
per-frame cell arrays *once* ([`PropagationMoviePlayer`](../../frontend/src/components/views/PropagationMoviePlayer.tsx)),
and the RAF tick only does an O(cells) canvas draw — zero network, zero decode
during playback. `player` remains available for free-scrubbing the exact
server-nearest frame at any cursor position.

### 2. Smooth playback was isolated from the rest of the app — FIXED

Movie playback used to move the timeseries/spectrogram crosshair only on
scrub *release*. The crosshair is a client-side overlay, so moving it costs no
server round-trip for the cursor itself. We now drive `setTimeCursor` **every
frame** during movie/event playback so all views' playheads glide along
(toggle: "⌖ sync", default on). Two design points make this cheap:

- **Movie window defaults to the currently-visible window.** Because the cursor
  walks *within* that window, it never leaves it → `setTimeCursor` never
  recenters → no window change → window-bound views don't re-key on that axis.
  A "↺ window" button resnaps the movie window to the live visible window;
  `t0`/`t1` inputs override manually.
- **Window-bound query keys are decoupled from the cursor** (see §5). After
  this, `timeseries` / `spectrogram` / `spectrogram_live` do *not* refetch on a
  pure cursor move — the playhead glide is genuinely free for them.

Cursor commits are **throttled to ~15 Hz** regardless of playback fps, so the
genuinely cursor-windowed views that *should* track the cursor (spatial_map,
depth_map, psd_spatial — small ±0.25 s requests) update smoothly without a
frame-rate refetch storm. `keepPreviousData` keeps them painted between ticks.

### 3. `jet` colormap, hardcoded — FIXED

`jet` is perceptually non-uniform: it manufactures false edges/bands, which is
actively misleading when reading propagation wavefronts/gradients. The other
views already use perceptual maps (raster=viridis, PSD=inferno). The renderer
([`ChannelGridRenderer`](../../frontend/src/components/views/ChannelGridRenderer.ts))
+ [`colormaps.ts`](../../frontend/src/components/views/colormaps.ts) already
support `viridis | inferno | cividis | jet`.

**Fix:** a colormap **selector** in the panel toolbar, threaded to every
propagation surface (movie, player, strip, tiled) and the ColorBar. **Default
viridis.** `jet` stays one click away (a prior explicit user preference noted
in `colormaps.ts`; not forced, not removed).

### 4. `player` mode re-autoscaled color every frame — FIXED

`PropagationView` computes min/max from each frame's cells, and player mode
passed no global override → the color scale jumped every frame, so amplitude
*propagation* (the whole point) was invisible. Movie mode already locks to the
cube's global min/max.

**Fix:** player mode accumulates a global [min, max] across frames seen and
passes it as the locked scale ("lock scale", default on), so the ramp only
widens and never jumps. Resets on tensor/selection/mode change. (A one-shot
`propagation_movie` min/max probe would be more precise; deferred — accumulation
removes the egregious flicker at zero extra fetches.)

### 5. Window-bound query keys baked in the live cursor — FIXED (scoped)

`useSliceQuery`'s key is `["slice", name, request]` and `request.selection`
carried the live `time`, so a pure cursor move re-keyed *every* slice query even
though timeseries/spectrogram data depend only on the window. `time-transport.md`
flagged this as a known follow-up ("decouple later"). Driving the cursor every
frame (§2) makes it acute, so we did the scoped version now:

`makeDefaultSliceRequest` (`timeseries`, `spectrogram`) and
`makeSpectrogramLiveRequest` pin `selection.time` to `time_range[0]` in the
emitted request. The server ignores `selection.time` for these views (verified:
`state.py` reads it only for `spatial_map`/`depth_map`, and `propagation_frame`
uses `frame_time`), so this is behavior-preserving for data and for the
crosshair (a separate prop). The key now changes only when the *window*
changes. This also speeds up event-jumps app-wide, not just animation.

**Out of scope (documented follow-ups):**
- The v2 spectrogram path (`useV2SpectrogramQuery`) and any other v2 builders
  still bake the cursor — fold them in when the broader time-transport
  decoupling lands. Until then the ~15 Hz throttle + "⌖ sync" toggle bound the
  cost (turning sync off still gives smooth propagation playback; the scrubber
  commits the cursor on release).
- **strip/tiled** still issue N parallel `propagation_frame` fetches instead of
  one `propagation_movie` batch. They're one-time (not a per-frame hot path) and
  bounded (N ≤ 64), so this is the lowest-value item; folding them onto the
  movie cube means a render-path change (decode cube → per-frame cells →
  lightweight grid renderer) and is left as a follow-up.

### 6. Smoothing inconsistency in `PropagationView` — FIXED

The ResizeObserver render path used `smoothing: true` while the data-change path
used `smoothing: false`, so a frame looked different after a resize than after a
tick. Unified to `false` (matplotlib `imshow`'s crisp-tile default, matching the
renderer's documented default and the sibling spatial views).

### 7. Movie's first frame was blank until play — FIXED (found by verify-ui)

`PropagationMoviePlayer`'s ResizeObserver re-sized the canvas but never
repainted, so when the panel got its real size *after* frame 0 was first drawn
(at the initial tiny size), frame 0 stayed blank until `frameIdx` changed — i.e.
only once you pressed play. Browser-verified: `paintedPixels: 0` on load, 1683
after play. Pre-existing, but making movie the default surfaced it. Fixed with a
`sizeTick` state bumped in the resize handler and added to the frame-render
effect's deps (mirrors `PropagationView`'s resize-repaint).

## Verification (2026-06-03, headless browser on :5173)

Confirmed against the live demo app via the verify-ui skill:
- Movie is the default mode; canvas paints on load (1683 px) and during play.
- Colormap selector + ColorBar default to **viridis**; options viridis/inferno/cividis/jet.
- Play advances frames (`0.000s (1/8)` → `0.428s (4/8)`); with "⌖ sync" on, the
  timeseries uPlot cursor goes from `u-off` to active and tracks playback.
- No new console/network errors (one pre-existing `/probe_layout` 404, unrelated).

## Invariants / conventions this preserves

- One cursor/window owner (`selectionStore`); playback writes the cursor, never
  a second time representation (ADR-0004, ADR-0007).
- Playback hot paths bypass React: the RAF loop reads/writes via `getState()`
  and draws to canvas imperatively; only labels re-render (M3 prompt 35
  constraint, `time-transport.md`).
- CPU-first rendering (ADR-0005): `ChannelGridRenderer` 2D canvas, no GPU dep.
- Movie window = snapshot semantics: it does **not** auto-follow live window
  pans (that would refetch the cube per pan); "↺ window" resyncs on demand.

## Cross-refs

- [`time-transport.md`](time-transport.md) — cursor/window model + the query-key
  decoupling follow-up this doc partially enacts.
- ADR-0008 — the durable decision (movie-default, cursor-synced, perceptual map).
- Reference: ephyviewer `on_timer_play_interval` (wall-clock advance), deck.gl
  `transitions` (M3 prompt 35; not adopted — CPU-first).
