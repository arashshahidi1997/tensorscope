# Event display + property filtering — plan & conceptual design

**Status:** ready to execute (specs decided; Tier-3 flags the property-set decision)
**Created:** 2026-06-04
**Baseline commit:** `ea5b536` on `refactor/ultracode-batch`
**Source survey:** code-grounded event/navigator surface maps (2026-06-04, this session).
**Companion:** [`oscillation-coupling-plan.md`](oscillation-coupling-plan.md) — filtering the SO/spindle/ripple detections is what makes the coupling view legible.

## Current state (answers to "does it already do X?")

- **Multiple event types in distinct colors — YES, already works.** Pin
  `spindle_ieeg_cortex` + `ripple_npx_hpc` + `slowwave_*` and each stream gets a
  color from a 6-hue palette ([eventStreamColors.ts:11](../../frontend/src/components/views/eventStreamColors.ts#L11), by pin order),
  drawn as colored vertical ticks on the timeseries
  ([TimeseriesSliceView.tsx:700-769](../../frontend/src/components/views/TimeseriesSliceView.tsx#L700)),
  with a coincidence-ring overlay and matching color chips in the EventTable. **Gaps:**
  (i) markers are point ticks at `t` only — the event's `t0→t1` extent isn't shaded;
  (ii) no cogpy **slow-wave detector** is registered (cogpy ships `SlowWaveDetector`,
  TensorScope never wraps it) — though SO streams from the NWB manifest load fine;
  (iii) palette caps at 6 streams.
- **Property thresholding/filtering — NO, does not exist.** The only filters today:
  detection-time params (re-run the detector), spatial `ap/ml/channel` on the window
  endpoint ([events.py:119-146](../../src/tensorscope/server/routers/events.py#L119)), and a
  client-side **review-status** filter (accepted/rejected/maybe) in the table. **Zero
  post-hoc filtering by frequency / duration / amplitude / power / peak_z.**
- **Brainstate in the navigator — YES, two surfaces.** (A) an in-navigator colored
  hypnogram **overlay** painted behind the trace ([NavigatorView.tsx:171](../../frontend/src/components/views/NavigatorView.tsx#L171),
  `brainstateOverlay` default **on**), and (B) a separate **hypnogram track lane** under
  the navigator (TrackStack → HypnogramView, visible by default). So this one's done.

**The property-heterogeneity catch (decisive for the design):** event properties are
**detector-defined and inconsistent**. Universal: `t`, `event_id`. Shared by interval
detectors: `value` (z-score peak), `duration` (or `t1−t0`). cogpy ripple/spindle:
`t0,t,t1,value,duration` (+ optional `frequency/rel_power/symmetry`, **off by default**).
The **NWB-manifest** streams are richer (`amplitude, peak_z, freq_peak, brainstate,
speed, motor_state`) because the upstream pipeline wrote them. `power`/`prominence` are
not emitted by in-repo detectors. → **the filter UI must be data-driven**: read the
active stream's actual columns + value ranges, normalize common aliases, and offer a
control only for properties that exist.

---

## Conceptual design

**Model.** An *event* is a typed, time-stamped record carrying per-event **properties**.
A *stream* is all events of one detector/type. The user has **two orthogonal axes of
control**:

1. **Which types to show** — pin/unpin streams; each type renders in its own color on
   the shared time axis. *(works today)*
2. **Which events within a type to show** — **property thresholds** (keep spindles with
   `peak_z > x` and `12 < freq < 15`; ripples with `duration > 30 ms`; SO with
   `amplitude > y`). *(the missing half)*

**Why thresholding is exploratory, not a fixed form.** You don't know the cutoff a
priori — you discover it from the data. So the core UX is, per property, a **range
slider backed by a histogram of that property's distribution** over the loaded events.
You see the population (e.g. a bimodal peak_z) and threshold to isolate the real one.
This turns event review from "scroll through every detection" into "isolate the
population of interest and see it in context."

**Per-stream filters, unified display.** Filters are **per-stream** (a spindle's
properties ≠ a ripple's), keyed by stream name; but the *display* is unified — all
surviving events from all pinned streams overlay in their colors on the one time axis,
and the EventTable shows the active stream's survivors. One predicate, applied **once**
at the data seam, so overlay + table + counts + coincidence stay consistent.

**The coupling payoff.** Filtering + the existing **coincidence** overlay = a coupling
tool: "show only high-power spindles AND only fast ripples, then highlight where they
co-occur." This is the event-side complement to the multi-probe TF view — the reason
this plan is a companion to the oscillation-coupling plan.

**Principles.**
- *Data-driven, not hardcoded* — introspect `streamMeta.columns` + computed value
  ranges; normalize aliases (`duration ?? t1−t0`, `peak_z ≈ value`, `amplitude` where
  present); show only existing properties.
- *Client-side + live* — filter the already-loaded, window-bounded `eventsByStream`
  records; thresholds are instant, no refetch. (Server `/window` params reserved for
  streams too large to ship.)
- *Filter once, render everywhere* — a single predicate between the query and its two
  consumers (overlay + table), at [WorkspaceMain.tsx:248](../../frontend/src/components/views/WorkspaceMain.tsx#L248).
- *Non-destructive* — filtering hides, never deletes; clearing restores. Orthogonal to
  the accept/reject review status (which persists a curation decision).

---

## Operating constraints + verification gates

Same as [`oscillation-coupling-plan.md`](oscillation-coupling-plan.md): branch
`refactor/ultracode-batch` (no merge/push); pixi for JS tooling; no worktree isolation
for frontend; commit per item, explicit paths; don't touch the WIP file list. Gates:
`pixi run frontend-test` (393 baseline) + `npx tsc -b` (via pixi) + `pixi run test` (331,
only if backend changed). Render/interaction items are **HUMAN-VALIDATE** (jsdom can't
draw canvas) — flag a `/verify-ui` pass (colored ticks + interval shading + the filter
histogram paint; filtered count matches the overlay).

---

## Work items

### E1 · Property-filter store + predicate + the single apply-seam
- **Goal:** per-stream numeric property filters that hide non-matching events everywhere.
- **Scope:** new `frontend/src/store/eventFilterStore.ts` (mirror `eventStreamsStore.ts`):
  `filters: Record<streamName, Record<property, [min,max]>>` + set/clear actions,
  persisted. A pure `applyEventFilters(eventsByStream, filters)` helper
  (`frontend/src/components/views/eventFilterLogic.ts`) that filters each stream's records
  by its property ranges, with **alias normalization** (`duration ?? t1−t0`,
  `peak_z ?? value`, numeric coercion + `Number.isFinite` guard). Apply it once at
  [WorkspaceMain.tsx:248](../../frontend/src/components/views/WorkspaceMain.tsx#L248) (and the
  table's re-derivation at App.tsx) so overlay + table + coincidence + counts all read
  filtered events.
- **Acceptance:** vitest on `applyEventFilters` — range filtering, alias normalization,
  empty-filter passthrough, missing-property handled. Full suite + tsc green.
- **Tag:** AUTOMATE. Foundational.

### E2 · Data-driven filter UI (per-property range + distribution histogram)
- **Goal:** for the active stream, a panel of range sliders — one per numeric property
  that exists — each over the property's value range, with a small histogram of the
  loaded events behind it; a live "N of M shown" count; a clear-all.
- **Scope:** new `EventFilterPanel` in `frontend/src/components/views/EventTableView.tsx`
  (beside the status `<select>` at [EventTableView.tsx:360](../../frontend/src/components/views/EventTableView.tsx#L360))
  or `EventsTabContent.tsx`. Enumerate filterable properties from `streamMeta.columns`
  (state.py:793 → `EventStreamMetaDTO`) ∪ the normalized aliases, keeping only numeric
  columns; compute each range + histogram from the loaded records (pure helper, tested).
  Sliders write `eventFilterStore`.
- **Acceptance:** vitest on the property-enumeration + histogram-binning helpers (golden
  values); the panel lists only existing numeric props. Full suite + tsc green.
- **Tag:** AUTOMATE-CODE + HUMAN-VALIDATE (sliders/histogram paint; count tracks overlay).
  Depends on E1.

### E3 · Interval-span shading + a legend (multi-type display polish)
- **Goal:** draw each event as a faint shaded span `t0→t1` in its stream color (not just
  a tick at `t`), and a small legend mapping color→stream; keep the peak tick + the
  coincidence ring.
- **Scope:** extend the timeseries draw hook
  ([TimeseriesSliceView.tsx:700-769](../../frontend/src/components/views/TimeseriesSliceView.tsx#L700))
  to shade `[t0,t1]` (normalize `t0 ?? event_start`, `t1 ?? event_end`) when present, at
  low alpha, under the peak tick. Add a compact legend (the EventTable chips already carry
  the colors — reuse `buildStreamColorMap`).
- **Acceptance:** pure-logic test for the span/alias resolution (`t0/t1` vs
  `event_start/end` vs tick-only). Full suite + tsc green.
- **Tag:** AUTOMATE-CODE + HUMAN-VALIDATE (spans paint in the right colors). Depends on E1.

### E4 · Register the slow-wave detector + richer spindle/ripple props
- **Goal:** give "SO" a one-click in-repo source and emit more filterable properties.
- **Scope (`src/tensorscope/core/events/detectors.py`):** wrap cogpy `SlowWaveDetector`
  as `cogpy_slowwave` (mirror `CogpySpindleDetector` at L243; cogpy emits
  `peak_time,duration,duration_neg,amplitude,val_trough,val_peak,frequency,state`) with a
  style color; register at L360. For ripple/spindle, pass cogpy's enrichment flags so
  `frequency`/`rel_power`/`symmetry` are emitted (currently off) — more properties to
  filter on. Keep `_catalog_to_stream` (L191) unchanged.
- **Acceptance:** backend test — `cogpy_slowwave` registers + emits `amplitude`+`duration`;
  enriched spindle emits `frequency`. `pixi run test` green.
- **Tag:** AUTOMATE-CODE + HUMAN-VALIDATE (run it on real data). Independent of E1-E3.

### E5 · (OPTIONAL) Server-side window filter params — only for huge streams
- The window is already time-bounded so the client holds a small slice; client-side
  filtering (E1) avoids a refetch per threshold tweak. Only if a stream is too large to
  ship whole, extend `/events/{name}/window` (events.py:124-146) with optional numeric
  range params applied as DataFrame masks after `get_events_in_window`, exactly like the
  existing `ap/ml/channel` masks. Flag: changes the query key → refetch per tweak.
- **Tag:** DEFER unless a real large-stream case appears.

---

## Tier 3 — decide before running

- **D-PROPS · the canonical filterable property set + aliases.** Recommendation: expose
  `peak_z`(≡`value`), `freq`/`frequency`/`freq_peak`, `duration`(≡`t1−t0`),
  `amplitude`, and any other numeric column present; normalize the listed aliases. Confirm
  the alias map (esp. whether `value` should surface as "peak z-score").
- **D-HISTO · histogram vs plain slider.** Recommendation: histogram-backed range slider
  (the exploratory value is the distribution). A plain min/max slider is the cheaper
  fallback if E2 runs long.
- **D-FILTER-SCOPE · per-stream (recommended) vs one global filter.** Per-stream matches
  the heterogeneous properties; confirm.

## Phasing

```
E1 → E2 (UI needs the store/predicate)     ;  E3 ∥ E1     ;  E4 independent
```
Recommended: **E1 → E3 → E4 → E2** (predicate + span shading + the SO source give
immediate value; the histogram UI last). One ultra-batch (~$12-18, +900000).

## Kickoff prompt
```
/effort ultracode
Read docs/design/event-filtering-plan.md IN FULL (source of truth) + the
Agent/automation gotchas in CLAUDE.md. Branch refactor/ultracode-batch at ea5b536 —
stay on it, no branch/merge/push. Execute E1 → E3 → E4 → E2 (E5 DEFERRED). Use the
D-PROPS/D-HISTO/D-FILTER-SCOPE decisions from Tier-3 (confirmed). pixi for all JS
tooling; no worktree isolation (frontend); commit per item EXPLICIT paths only (never
git add -A); verify each green (frontend-test + tsc; +pixi run test for E4) before the
next. HUMAN-VALIDATE items get code + pure tests + a /verify-ui flag (colored
ticks+spans, the filter histogram, filtered count == overlay). Final per-item report.
```
