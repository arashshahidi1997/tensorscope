# Channel viewport — scroll through > 32 channels in the timeseries view

**Status:** spec (v0)
**Created:** 2026-05-11
**Tracks:** [issue-arash-20260511-182119-502518](../log/issue/issue-arash-20260511-182119-502518.md) G2

## Problem

The timeseries view hard-caps at 32 traces (audit F4). On a 16×16
ECoG grid (256 channels), the bottom 224 channels are invisible. A
real spindle lights up 5–30 contiguous channels — without scroll, the
reviewer can't answer "which channels participated?" and can't see
events that fall outside the leading 32.

## Approach

Pure frontend, no server changes. The server already returns every
channel in the slice; the chart picks which ones to display. Add a
viewport (`firstChannel`, `nVisible`) over the channel set, with
keyboard shortcuts to scroll.

## v0 contract

- New state on `useAppStore`: `tsFirstChannel: number` (default 0).
  Step size is `Math.floor(nVisible / 4)` — pages by quarter-screen,
  Neuroscope2 convention.
- Keyboard shortcuts on the page body (NOT in inputs):
  - `[` / `]` — scroll channels up / down by step
  - `Shift+[` / `Shift+]` — scroll by full screen (= nVisible)
- Inline indicator next to the band picker: `Ch: 0–31 of 256` (or
  whatever range is visible).
- `nVisible` stays 32 in v0. Increasing the on-screen channel count
  past 32 requires uPlot perf tuning (lots of series tanks render time)
  — defer to v0.1.

## Data flow

`TimeseriesSliceView` already slices `raw.series.slice(0, 32)`. Replace
with `raw.series.slice(firstChannel, firstChannel + nVisible)`. When
`firstChannel + nVisible > totalChannels`, clamp `firstChannel`.

## UI

Bandpass picker bar already lives between the chart toolbar and the
chart. Add the channel viewport indicator + arrows on the same row:

```
Band: [Off ▼]   Ch: [▲][▼] 0–31 of 256
```

The `[▲][▼]` buttons step by `step`. Shift-click for full-page.

## Out of scope (v0)

- Live-resize `nVisible` (slider for "show me 64 channels").
- Channel re-ordering / per-channel mute (channel masking already
  exists as a separate feature).
- Saving the viewport in URL state (deferred to v0.1; for now it's
  session-local).

## Acceptance

1. With > 32 channels, `]` advances the visible window; `[` reverses.
2. Indicator shows the current range, e.g. `Ch: 32–63 of 256`.
3. Reviewer scrolling fast does not lose the chart's selection cursor.
4. Tests: channel viewport store mutations + clamp behavior.

## Files touched

- `frontend/src/store/appStore.ts` (tsFirstChannel + setters)
- `frontend/src/components/views/TimeseriesSliceView.tsx`
  (consume firstChannel, inline arrows + indicator, keyboard shortcuts)
- `frontend/src/components/views/useEventReviewShortcuts.ts` (no — `[`/`]`
  go on a separate hook OR are added to the existing hook with care).
- `frontend/src/components/views/useChannelViewportShortcuts.ts` (new)
- `frontend/src/components/views/useChannelViewportShortcuts.test.ts` (new)
