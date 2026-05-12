# Detector comparison overlay — multi-stream event panel

**Status:** spec (v0)
**Created:** 2026-05-12
**Tracks:** [task-g5-detector-overlay](../log/issue/task-g5-detector-overlay-20260512-012738-202424.md)
(issue context: [issue-arash-20260511-182119-502518](../log/issue/issue-arash-20260511-182119-502518.md) G5)

## Problem

The event panel shows ONE stream at a time. When a spindle detector and a
ripple detector both fire within ~100 ms on the same channel, that's
almost always broad-band noise / artifact — but the reviewer has no way
to overlay the two streams and spot the crosstalk fast.

## Approach

Pure frontend. The `/api/v1/events/{name}/window` endpoint already accepts
one stream at a time; parallel React Query calls dedupe via the
`["events-window", name, selection, halfWindow]` key, so multi-stream
fetching needs no server changes.

The reviewer can pin 2+ streams; coincidences within a configurable
window light up on the timeseries (ringed glyph) and in the event table
(left-rim accent + ⊕ marker on the active stream's row).

## State (`frontend/src/store/eventStreamsStore.ts`)

Persisted Zustand slice:

- `pinnedStreams: string[]` — pin order; the first entry is auto-active.
- `activeStreamName: string | null` — which pinned stream the table shows.
- `coincidenceWindow: number` (seconds, default 0.1).

Actions: `pinStream`, `unpinStream` (auto-falls back active to next), `setActiveStream`,
`setCoincidenceWindow`, `ensureActive(defaultStream)` (bootstrap on first
load so existing single-stream behavior is preserved).

## Coincidence detection (`frontend/src/api/coincidence.ts`)

Pure client-side, sorted two-pointer walk. `pairwiseMatches(a, b, windowS)`
is `O(n + m)`; `coincidenceIndicesByStream(byStream, windowS)` runs it
for every pair of pinned streams and returns the set of *original-index*
positions involved in any cross-stream match. `countActiveStreamCoincidences`
collapses that to "how many active-stream events have a match in ANY
other pinned stream" — the number the panel surfaces.

v0 is pairwise only — chained 3+ stream coincidence detection (e.g.
"fires in all 3 within 100 ms") is out of scope.

## Color (`frontend/src/components/views/eventStreamColors.ts`)

Per-stream color is the palette index of the stream in `pinnedStreams`.
Six saturated hues distinct from the timeseries channel pastels so the
event ticks stand out against trace ink. Coincidence glyph color is
fixed (`#ff3b30`).

## Data flow

- `App.tsx` calls `useEventWindowQueries(pinnedStreams, …)` for the table.
- `WorkspaceMain.tsx` calls the same hook for the timeseries markers;
  React Query dedupes the fetches.
- Both compute `coincidentTimes` (union of times involved in any
  cross-stream match) from the shared cache so the timeseries view can
  ring them.

## UI

- Event panel header: `Streams: [● spindle][● ripple][+ add ▼]   ± [0.10] s`
- Active chip has a stronger border; clicking a chip switches the active
  stream. The × on each chip unpins it (disabled when only one chip).
- Below the filter, when `pinnedStreams.length >= 2`:
  `Coincidences (±0.10s): N of M active-stream events`.
- Active-stream table rows that fall inside the coincidence set carry a
  `.coincident` class (left-rim accent + ⊕ glyph).
- Timeseries: each pinned stream draws colored dashed verticals
  (dedicated tick color); a solid red ring sits at the top of any event
  involved in a cross-stream match.

## Out of scope (v0)

- Server-side coincidence detection (defer until a 100k-event session
  shows the client path is slow).
- Cross-channel coincidence (stream A on ch5 vs stream B on ch7 as a
  match). v0 matches by time only.
- 3+ stream chained coincidence ("fires in all 3 within X ms").

## Acceptance

1. With two streams pinned, both render colored ticks on the timeseries.
2. Switching streams in the table does NOT clear the timeseries overlay.
3. Coincidence count is exact and asserted in unit tests.
4. Per-stream color comes from the central `eventStreamColors` palette,
   never hardcoded at the view.

## Files touched

- `frontend/src/store/eventStreamsStore.ts` (new)
- `frontend/src/store/eventStreamsStore.test.ts` (new)
- `frontend/src/api/coincidence.ts` (new)
- `frontend/src/api/coincidence.test.ts` (new)
- `frontend/src/api/queries.ts` (added `useEventWindowQueries`)
- `frontend/src/components/views/eventStreamColors.ts` (new)
- `frontend/src/components/views/EventTableView.tsx` (multi-stream
  rewrite — chips strip, coincidence summary, coincidence-tagged rows)
- `frontend/src/components/views/TimeseriesSliceView.tsx` (per-stream
  colored markers + coincidence ring glyph)
- `frontend/src/components/layout/EventsTabContent.tsx` (pass-through)
- `frontend/src/App.tsx` and
  `frontend/src/components/views/WorkspaceMain.tsx` (wire-up)
- `frontend/src/styles.css` (chip + summary CSS)
