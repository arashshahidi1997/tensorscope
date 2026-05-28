# Filtered-band overlay on timeseries

**Status:** shipped (commit `3ef6531`)
**Created:** 2026-05-11
**Tracks:** [issue-arash-20260511-182119-502518](../log/issue/issue-arash-20260511-182119-502518.md) G1

## Problem

Validating a candidate spindle on ECoG requires seeing the 11–16 Hz
bandpass envelope on top of (or paired with) raw signal. TensorScope's
processing pipeline (`notch`, `cmr`, `zscore`) is global and stateless to
the view — it transforms the whole tensor, not "show this band overlaid
on raw for this candidate." Neuroscope2 had this as a literal toggle.

Without it, validators are squinting at envelopes they can't see and
either accept everything the detector flags or write off the whole event
stream.

## Approach

- **Server**: add optional `bandpass: [lo_hz, hi_hz]` to
  `TensorSliceRequestDTO`. Applied via `scipy.signal.sosfiltfilt`
  (4th-order Butterworth) inside `apply_slice_request`, on the windowed
  slice **after z-score/offset but before time downsampling**. Order
  matters: `sosfiltfilt` derives `fs` from the time spacing, so it must
  run before downsampling (which makes the spacing irregular and the
  inferred `fs` wrong); it runs after `zscore_offset` so the band trace
  shares the same per-channel scale as the raw display (the highpass arm
  removes the stacking DC, leaving a zero-centred trace the frontend
  re-stacks by re-adding each channel's mean). Mirrors the existing
  `bandpass` DAG transform (`core/transforms/builtins.py`).
- **Wire**: works on both v1 and v2 (one shared DTO). v2 (raw Arrow
  bytes) is preferred since timeseries is one of the views already wired
  to v2.
- **Frontend**: per-view band picker with display-mode toggle (Off /
  Both). When *Both* is selected, the view fires a parallel filtered
  fetch and renders the filtered series as a colored overlay on top of
  raw at the same y-offset per channel.

## Edge-effect handling (server)

`sosfiltfilt` pads the signal internally with reflected copies of the
input edges (default `padlen=3*(2*n_sections+1)`), so transients
during the first/last ~10 ms of a 2 s window at 1250 Hz are negligible
for the practical band ranges (0.5–250 Hz). The slice path clamps
`padlen` to `n_samples-1` so a short window degrades gracefully instead
of raising scipy's "input vector must be greater than padlen" error.

For very short windows (<200 ms at 11–16 Hz, i.e. <2 cycles of the low
end), filter ringing dominates. The slice path will refuse and surface
a clear error rather than render misleading output:

```
HTTP 400: "bandpass window too narrow: need ≥3 cycles of lo_hz"
```

## DTO change

As shipped, `bandpass` is a structured `BandpassParamsDTO` (not a bare
tuple), so future per-band options (order, presets) have somewhere to land:

```python
class BandpassParamsDTO(BaseModel):
    lo_hz: float
    hi_hz: float
    order: int = 4

class TensorSliceRequestDTO(BaseModel):
    ...existing...
    bandpass: BandpassParamsDTO | None = None
```

Validators reject `lo >= hi`, negative values, and `hi > nyquist`. Nyquist
is inferred from the time coord at slice time.

## Frontend UI

A new control in the timeseries chart toolbar (`ChartToolbar` already
holds zoom/gain toggles):

```
Band: [Off ▼]  [11.0]–[16.0] Hz
```

Presets:
- **Off** — show raw only.
- **Spindle** — 11–16 Hz, common sleep spindle band.
- **Ripple** — 100–250 Hz, hippocampal ripple band.
- **Slow Osc** — 0.5–4 Hz, K-complex / SO range.
- **Custom** — exposes the lo/hi number inputs.

When a band is selected, the filtered query fires alongside the existing
raw timeseries query (same v2 wire format, same worker pool). The chart
renders both series — raw in the existing grey/per-channel color, filtered
as a 1.5× width line in a contrasting saturated color (red for spindle,
violet for ripple, teal for SO) at the same y-offset.

Display mode is `Both` only in v0. A future "Filtered only" mode can
hide the raw series, but for a review workflow you almost always want
both visible — the raw confirms the filtered isn't filter ringing.

## Per-view local state

Band selection lives in `useChartTools(chartRef)`-equivalent local state
on the timeseries view, NOT in the global selection store. Reasoning:
the band is a view-rendering concern, not a navigation concern. Different
views (timeseries vs. spectrogram) can pick different bands without
interfering.

Persisted across reloads via the existing `useLayoutStore` persist
slot (small ergonomic detail — defer if it complicates the diff).

## Acceptance

1. Picking a band preset fires a second fetch and the filtered series
   appears on the chart within <500 ms (warm cache, 2 s window).
2. Switching presets re-fetches without flicker on the raw trace
   (React Query's `keepPreviousData` keeps the previous filtered
   visible during the fetch).
3. Custom mode lets the reviewer type arbitrary lo/hi (e.g. 12–14 Hz).
4. Server rejects bands narrower than 3 cycles of `lo_hz` with a 400.
5. Tests:
   - Backend: `tests/test_bandpass_slice.py` verifies sliced output
     band power matches expectation and edge-effect tolerance.
   - Frontend: parity test on a synthetic chirp signal.

## Files touched

- `src/tensorscope/server/models.py` (`bandpass` field on
  TensorSliceRequestDTO)
- `src/tensorscope/server/state.py` (`_prepare_slice` applies bandpass)
- `tests/test_bandpass_slice.py` (new)
- `frontend/src/api/types.ts` (DTO type)
- `frontend/src/api/queries.ts` (`makeBandpassRequest` + reuse v2 hook)
- `frontend/src/components/views/ChartToolbar.tsx` (band picker)
- `frontend/src/components/views/TimeseriesSliceView.tsx` (overlay render)
- `frontend/src/components/views/colormaps.ts` (band → color mapping)

## Sequencing

1. Server DTO + slice path + tests.
2. Frontend types + query helper.
3. Frontend toolbar.
4. Frontend overlay render.
5. Commit.

Estimated effort: 3–4 hours.

## Out of scope (v0)

- Hilbert envelope overlay (the filtered series alone is what NS2 had;
  envelope-on-filtered is an extra step the reviewer can read off the
  oscillation amplitude).
- Per-band threshold lines (where the detector said "this exceeds N×SD").
  Would need server-side state from the detector, not just the band.
- Auto-band-from-detector (look up which band the active detector used
  and prefill). Nice ergonomic touch, defer to v0.1.
