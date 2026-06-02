# Time transport — one owner for the cursor + window

**Status:** implemented (Phases A–D landed 2026-06-02, uncommitted on `refactor/contract-v2-phase1`)
**Created:** 2026-06-02
**Tracks:** survey [`docs/research/time-transport-survey.md`](../research/time-transport-survey.md)
**Scope:** frontend time-navigation state + the six widgets that drive it.
Backend untouched.

## Status

All four phases implemented and wired; 311 frontend tests pass, `tsc -b` clean.

| Phase | What landed | Tests |
|---|---|---|
| A | Deleted `viewportDuration`; duration derived = `windowDuration(timeWindow)`; recenter preserves current width (`centeredWindow`); `hasInitialized` flag replaces the `[0,2]` / `timeCursor!==0` sentinels; `setDuration`; ChartToolbar preset epsilon-compare | `selectionStore.test.ts`, `pairingStream.test.ts` |
| B | `TimeseriesNavStrip` + `TimeScaleBar` focus-aware sync (no draft clobber); single commit on Enter→blur | `TimeseriesNavStrip.test.tsx`, `ChartToolbar.timescale.test.tsx` |
| C | Optimistic cursor in `App.commitSelection` (local patch → mutate → reconcile w/ current window, no stomp); `AnimationController` one-frame step decoupled from speed, `timeRange` via ref, wall-clock loop, speed guard | `selectionStore.test.ts` (optimistic contract), `AnimationController.test.tsx` |
| D | `useDebouncedValue` (~100 ms) on the window feeding slice fetches (`safeWindow`); live window still drives the chart x-scale; `AbortSignal` on the v1 `getTensorSlice` (v2 already had it) | `useDebouncedValue.test.ts`, `client.signal.test.ts` |

Known follow-up (not in A–D scope): the timeseries/spectrogram query keys still
bake the live `selectionDraft` (cursor) in, so a pure cursor move re-keys
window-bound views even though their data depends only on the window. With
optimistic render this is invisible but wasteful — decouple later.

## Problem

Six widgets write time state — `NavigatorView`, `TimeseriesNavStrip`,
`TimeScaleBar`/`ChartToolbar`, `SelectionPanel`, `AnimationController`, and the
`TimeseriesSliceView` gestures — over a store
([`store/selectionStore.ts`](../../frontend/src/store/selectionStore.ts)) that
holds **three overlapping representations** of the same thing: `timeCursor`,
`timeWindow:[t0,t1]`, and `viewportDuration`. Three of the widgets also keep a
local `useState` **draft mirror** re-synced by an unconditional `useEffect`.

The audit (this branch) traced the consequences:

1. **Width drift.** `setTimeWindow` (`selectionStore.ts:84`) never updates
   `viewportDuration`; the next cursor recenter (`:73`, `:138`, `:165`) rebuilds
   the window from the stale duration → zoom to 10 s, click far away, window
   snaps back to 1 s.
2. **Blocking cursor.** A click → PUT `/api/v1/selection` → `initFromDTO` →
   refetch. The crosshair doesn't move until the PUT returns (`App.tsx:70–78`).
   At our payload sizes a pure cursor nudge re-fetches + worker-decodes ~2–4 MB
   and triggers a fresh cogpy windowed compute, even when the window is unchanged.
3. **Draft clobber.** An external cursor tick (animation, paired commit) wipes a
   half-typed value in NavStrip / TimeScaleBar.
4. **No debounce.** Pan publishes `setTimeWindow` per mousemove frame → a slice
   refetch per frame (masked by `keepPreviousData`, but the cogpy computes are
   real — this is the "scroll loads later data, just slow + silent" symptom).
5. **Float sentinels.** `initFromDTO` detects first-load via
   `timeWindow === [0,2]` (`:169`); `App.tsx:46` infers `initialized` from
   `timeCursor !== 0 || ap !== 0`; `TimeScaleBar` highlights a preset via
   `viewportDuration === ts.seconds`. All fail under FP drift.

Every mature multichannel viewer (ephyviewer, mne-qt-browser, phy, OpenEphys,
Neuroglancer, HiGlass) avoids all five by holding **one** `{cursor, window}`
owner with width as a single derived number, updating optimistically, and
rate-limiting the fetch. See the survey for citations.

## Scale context (why the data-facing parts are wins)

iEEG 256 ch @ 1250 Hz, NP 212 ch @ 2500 Hz; per-window-commit wire (v2):
timeseries 2 s ≈ **2.07 MB**, spectrogram_live 8 s ≈ **4.22 MB**, psd_live ≈
**1.29 MB**. cogpy is lazy (memmap + dask, windowed before compute). So each
window value fed to a query key is a multi-MB transfer **plus** a dask compute —
debounce and optimistic-cursor are justified by these numbers, not cosmetics.

## The model

One owner. Width is derived. Cursor is optimistic. Fetch is debounced.

```ts
// selectionStore — the time slice of state
type TimeTransport = {
  cursor: number;             // committed time (s)
  window: [number, number];   // visible range [t0, t1] (s)
  hasInitialized: boolean;    // replaces the [0,2] / timeCursor!==0 sentinels
};
// duration is DERIVED, never stored:
const duration = (w: [number, number]) => w[1] - w[0];
```

`viewportDuration` is **deleted** as stored state. Anything that needs a width
reads `duration(window)`. Anything that sets a width sets the window.

### Setters (collapse the three recenter sites into one helper)

```ts
// the ONE place that recenters a window around a time, preserving width
function centeredWindow(t: number, width: number, bounds: [number, number]): [number, number] {
  const half = width / 2;
  const lo = Math.max(bounds[0], t - half);
  return [lo, lo + width];           // keep width exact even at the t0 edge
}

setWindow:        (w) => set({ window: w }),                 // gestures, presets
setCursor:        (t) => set((s) => ({                       // local/optimistic
  cursor: t,
  window: within(t, s.window) ? s.window
        : centeredWindow(t, duration(s.window), bounds),     // width from window, not a 2nd field
})),
```

Presets (TimeScaleBar) set `window = centeredWindow(cursor, seconds, bounds)` —
no `viewportDuration`. Preset-active styling compares
`Math.abs(duration(window) - seconds) < 1e-6`, not `===`.

### Optimistic cursor

`commitSelection` moves the crosshair **now**, then reconciles with the server:

```ts
const commitSelection = (payload: SelectionDTO) => {
  setCursor(payload.time);            // instant crosshair, store-local
  selectionMutation.mutate(payload);  // persist in session; reconcile in onSuccess
};
// onSuccess: only correct cursor if the server value differs; do NOT re-center
// the window (that's what stomps an in-flight user pan — audit finding C).
```

The crosshair is a number; moving it never needs new data. Views that *depend*
on `cursor` (psd lock-to-event, spectrogram) still refetch — but via the
debounced edge below, and only those views, not the window-bound ones on a pure
cursor move.

### Debounced fetch edge

Keep `window` in the store updating live (the uPlot x-scale already pans
optimistically and locally — that stays instant). Trail the **query key** behind
it by ~100 ms (HiGlass's number):

```ts
const fetchWindow = useDebouncedValue(window, 100);   // feeds makeDefaultSliceRequest
```

Pair with the `AbortSignal` contract-v2 §7 already mandates so a superseded
in-flight fetch is cancelled rather than decoded-then-discarded. `keepPreviousData`
+ sticky refs (already shipped) keep the canvas painted through the 100 ms.

This is **temporal debounce**, distinct from the request-coalescing parked in
Phase 1.5 (`project_contract_v2_phase1`) — it does not reopen that decision.

## Migration (four reviewable phases, each green on its own)

**Phase A — state core (no UX change intended).**
- Add `hasInitialized`; replace the `[0,2]` sentinel (`selectionStore.ts:169`)
  and `App.tsx:46`'s `timeCursor!==0` heuristic with it.
- Delete `viewportDuration`; add `duration(window)` selector + `centeredWindow`.
- Rewrite `setTimeCursor` / `patchFromDTO` / `initFromDTO` recenter blocks to use
  `centeredWindow(t, duration(window), bounds)`.
- Replace `setViewportDuration(d)` callers with `setWindow(centeredWindow(...))`.
- Tests: width-preservation across cursor recenter; first-load via flag not
  float; existing 275 frontend tests stay green.

**Phase B — widgets become controlled (kill draft mirrors).**
- `TimeseriesNavStrip`, `TimeScaleBar`: drop the `useState` drafts. Inputs are
  controlled from the store; commit on Enter/blur. For the focus-vs-external-tick
  race, use ephyviewer's discipline (don't sync the field while it has focus)
  rather than an unconditional sync `useEffect`.
- Fix the double-commit paths (TimeScaleBar Enter+blur; NavStrip cursor edit
  firing both cursor and window callbacks).
- Preset-active compare via epsilon.

**Phase C — optimistic cursor.**
- `commitSelection` (`App.tsx:78`) sets the cursor locally before `mutate`.
- `onSuccess` reconciles cursor only on mismatch; stops re-centering the window.
- `AnimationController` already updates locally — point it at `setCursor` and
  switch its accumulator to wall-clock (ephyviewer `on_timer_play_interval`) so
  playback doesn't drift.

**Phase D — debounce + abort.**
- `useDebouncedValue(window, 100)` feeds the slice/v2 query requests.
- Thread `AbortSignal` (React Query `signal`) into `api.getTensorSlice` / v2
  fetches.
- Verify on the 733 MB iEEG session: drag pans instantly (local x-scale), the
  network settles ~100 ms after release, no per-frame cogpy computes in the
  server log.

## Non-goals / what stays

- **Navigator full-session compute (5+ s)** — separate backend fix (drop
  `"navigator"` from the `zscore_offset` branch in `state.py:1178`). Orthogonal;
  this refactor neither helps nor needs it.
- **Request coalescing (Phase 1.5)** — stays deferred.
- **No LOD pyramid, no Zarr, xarray-in-RAM** — unchanged; this lives entirely
  above the wire.
- **Backend, DTOs, Arrow contract** — untouched. `SelectionDTO` on the wire is
  unchanged; the store→DTO mapping (`toSelectionDTO`) absorbs the `viewportDuration`
  removal.

## Risks

- **Optimistic/server divergence.** Single-user, single session; reconcile-on-
  response covers it. Risk is a brief cursor flicker if the server clamps
  differently — mitigate by clamping client-side with the same bounds before
  `setCursor`.
- **Debounce vs. event-jump (j/k).** A keyboard event step should feel
  immediate; let cursor commits bypass the window debounce (they don't move the
  window) and only debounce window gestures.
- **Behavioral parity.** Phases A–B are pure refactors; lean on the existing
  suite plus the new width/clobber tests before C–D change felt latency.

## Cross-refs

- Survey: [`docs/research/time-transport-survey.md`](../research/time-transport-survey.md)
- Wire contract (unchanged): [`docs/design/contract-v2.md`](contract-v2.md)
- Current nav contract: `frontend/src/components/views/useOverviewDetail.ts`
- Reference impls in corpus: `resources/ephyviewer/ephyviewer/navigation.py`
  (`seek()` echo-suppression), `resources/mne-qt-browser`, `resources/phy`.
