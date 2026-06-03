# ADR-0007: Unified Time-Transport (one cursor/window owner)

## Title

A single `{cursor, window}` source of truth for time navigation, with an
optimistic cursor and a debounced fetch edge.

## Status

Accepted (Phases A–D implemented 2026-06-03 on `refactor/ultracode-batch`;
344 frontend tests pass, `tsc -b` clean). Refines [ADR-0004](./0004-shared-selectionstate-coordination.md).

## Context

Time navigation had fragmented into three overlapping representations in the
selection store (`timeCursor`, `timeWindow`, and a separate `viewportDuration`)
plus draft mirrors inside six widgets (NavigatorView, TimeseriesNavStrip,
TimeScaleBar, SelectionPanel, AnimationController, TimeseriesSliceView gestures).
Consequences observed: `viewportDuration` and the real window width drifted; the
cursor was a blocking server round-trip while the window was store-local (two
latency paths); draft mirrors clobbered in-progress typing; a window gesture
fired a slice refetch per frame. A survey of mature multichannel viewers
(ephyviewer, mne-qt-browser, phy, OpenEphys, Neuroglancer, HiGlass) found they
all converge on one owner of `{cursor, window}`, width as a single derived
number, optimistic synchronous updates, and rate-limited fetches.

## Decision

Time navigation has ONE owner: `{ cursor, window:[t0,t1] }` in the selection
store. Duration is **derived** (`windowDuration(window) = t1 - t0`) — there is no
separate `viewportDuration`. The cursor updates **optimistically** (local first;
the server reconciles without stomping the user's window). The window→fetch edge
is **debounced (~100 ms)** while the live window still drives the chart x-scale
immediately (the HiGlass "optimistic transform + debounced fetch" split). Widgets
are thin controllers over the store; where a controlled input must avoid echo it
uses focus-aware sync (ephyviewer's disconnect/set/reconnect discipline), not an
unconditional effect.

## Consequences

- `viewportDuration` as stored state is gone; anything needing a width derives it.
- First-load is gated by an explicit `hasInitialized` flag, not float sentinels.
- Future agents should treat as regressions: re-introducing a second duration
  field, a blocking cursor commit, per-frame fetches, or widget-local draft mirrors.
- Open follow-up: the timeseries/spectrogram slice request still bakes the cursor
  into its key, so a pure cursor move re-keys window-bound views — decouple in the
  v2 cutover (refactor-plan N5).

## Related docs

- [docs/design/time-transport.md](../design/time-transport.md) — the model + 4-phase migration.
- [docs/research/time-transport-survey.md](../research/time-transport-survey.md) — how mature viewers do it.
- [ADR-0004: Shared SelectionState](./0004-shared-selectionstate-coordination.md) — the coordination layer this refines.
