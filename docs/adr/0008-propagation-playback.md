# ADR-0008: Propagation Playback (preloaded movie, cursor-synced, perceptual colormap)

## Title

Preloaded `propagation_movie` is the default spatial-playback engine; playback
drives the global cursor every frame; the colormap is a perceptual default
(viridis) chosen from a selector.

## Status

Accepted (implemented 2026-06-03 on `refactor/ultracode-batch`). Builds on
[ADR-0007](./0007-unified-time-transport.md).

## Context

The animation panel ([`PropagationController`](../../frontend/src/components/views/PropagationController.tsx))
had two playback engines with opposed trade-offs. The default — `player` —
fetched one `propagation_frame` per cursor tick over the network and drove the
*global* cursor across the whole recording, so each tick that left the visible
window recentered it and re-keyed every window-bound view (timeseries,
spectrogram, psd: multi-MB + cogpy compute each). The smooth engine — `movie`
(preload N frames once, RAF over cached cells) — avoided all of that but was
isolated: it moved the shared cursor only on scrub release, so the timeseries /
spectrogram playheads didn't follow playback. Separately, every propagation
surface hardcoded `jet` (perceptually non-uniform, misleading for gradients)
and `player` mode re-autoscaled color per frame (hiding the very amplitude
changes it exists to show). See [docs/design/propagation-playback.md](../design/propagation-playback.md).

## Decision

1. **`movie` is the default playback engine.** Preload the window once, decode
   per-frame cells once, RAF tick = O(cells) canvas draw — no network/decode
   during playback. `player` stays for free-scrubbing the exact server-nearest
   frame at an arbitrary cursor position.
2. **Playback drives the global cursor every frame** (movie/event), throttled to
   ~15 Hz and toggleable ("⌖ sync", default on), so all views' playheads glide
   together. The movie window defaults to the **currently-visible** window so
   the cursor walks within it and never forces a window recenter.
3. **Window-bound slice keys are decoupled from the cursor** for the views that
   don't need it: `makeDefaultSliceRequest` (`timeseries`/`spectrogram`) and
   `makeSpectrogramLiveRequest` pin `selection.time` to `time_range[0]`. The
   server ignores `selection.time` for these (verified), so this is
   behavior-preserving and makes the per-frame playhead glide free for them.
   This is the v1 slice of ADR-0007's open follow-up / refactor-plan N5.
4. **Colormap is a selector, default viridis**, threaded to every propagation
   surface. `jet` remains available (prior user preference) but is no longer the
   default or hardcoded.
5. **`player` locks its color scale** (accumulated global [min,max], default on)
   so amplitude is comparable frame-to-frame.

## Consequences

- Default UX is now smooth, cursor-synced playback that scales to large sessions.
- Treat as regressions: hardcoding a colormap on a spatial view; per-frame color
  autoscale during playback; a playback engine that round-trips per frame; or
  re-baking the live cursor into the timeseries/spectrogram slice key.
- Remaining follow-ups (not blocking): fold the v2 spectrogram path into the
  cursor decoupling; batch strip/tiled onto one `propagation_movie` fetch.

## Related docs

- [docs/design/propagation-playback.md](../design/propagation-playback.md) — full design + survey findings.
- [docs/design/time-transport.md](../design/time-transport.md) / [ADR-0007](./0007-unified-time-transport.md) — the cursor/window owner and the decoupling follow-up this enacts in part.
- [ADR-0005](./0005-cpu-first-rendering.md) — CPU-first canvas rendering (the movie path stays on `ChannelGridRenderer`).
