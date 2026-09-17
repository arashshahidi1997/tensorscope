# Neuropixels viewer — depth rendering, event tooling & coupling views

**Status:** Phase 1 SHIPPED (`feat/npix-event-tooling-p1`, 2026-09-17); Phases 2–3 gated on [DECISION]s · **Branch:** `feat/npix-viewer` · 2026-09-17

**Phase-1 landings:** G1 ✅ (guard test `spatialOrientation.test.ts` + AP-major-vs-ADR-0012 note; merge [DECISION] still open) · G2 ✅ (label "Depth (µm)" + real extents; **verify result: deepest renders at the TOP** — the served coord is electrodes `y` = µm from tip, so the plan's "deepest at bottom" premise was wrong for this launcher; true DV depth lands with G3) · E1 ✅ (`run_detector` publishes `events_added`; no-reload verified live) · E2 ✅ (`cogpy_slowwave` was ALREADY registered on this branch — detectors.py:418; dropdown grouped local/adaptive vs threshold) · D2-colormap ✅ (RdBu_r + symmetric ±max + "CSD (µA/mm³)" colorbar; diverging default taken per recommendation).
**Follows:** the simultaneous ECoG⇄NPX viewer (PR #1) + `load_aligned` (pixecog).
Owner decisions flagged **[DECISION]**; cross-project (pixecog) work flagged **[pixecog]**.

## Context & guardrails
Next batch of viewer + event-analysis features requested after live use on the aligned
dual-probe session. Every item below is grounded against the current `feat/npix-viewer`
code with file:line anchors and a "what exists vs missing" split — build **on** the
existing infra (E1–E5 filtering, filtered-band overlay, `depth_map`/`csd` views, raster
mode, multi-stream overlay), don't reinvent.

Guardrails: CPU-first; hot paths out of the React render loop; windowed access;
channel-native geometry (ADR-0010). Small, independently-committed, test-gated changes;
`/verify-ui` every render change (jsdom can't draw canvas).

---

## Track G — Geometry correctness & depth axis

### G1 — ECoG AP/ML transposition: VERIFIED; add a guard + reconcile the convention
**Exists:** transposition-safe end-to-end. `extractSpatialCellsV2` reads AP/ML **by name**
(`frontend/src/api/v2-arrow.ts:683–708`), `spatialGrid.ts:43` → flat `ap*nML+ml`,
`ChannelGridRenderer.ts:129–156` lays ImageData width=nML/height=nAP → **a fixed display
column = a fixed ML** holds. No transposition.
**Risk:** this branch encodes `(time, AP, ML)` / AP-major; **ADR-0012** (`docs/adr/0012-…`,
currently only on `feat/longfile-neuroscope`) standardizes **ML-major** `(time, ML, AP)` /
`ml*n_ap+ap`. The served ECoG tensor is already `(time, ML, AP)` and the server transposes
by name — safe today, but the branches carry different canonical conventions → silent
double-transpose risk at merge.
**Do:** (a) regression test pinning "fixed column = fixed ML" through decode→render (a
synthetic grid with an ML gradient must render as vertical stripes). (b) **[DECISION]** at
merge with longfile: adopt ML-major here, or document AP-major-until-merge.
**Acceptance:** stripe test green; convention divergence recorded. **Effort:** S.

### G2 — Depth axis: µm label + orientation verify
**Exists:** rows ordered by the µm `depth` coord (`io/assemble.py:73`), **deepest already at
bottom** (dorsal→ventral; `api/arrow.ts:579`, `depthProfile.test.ts`). Rows spaced **by
rank**, not physical µm; axis label reads "Depth" (`RasterView.tsx:103`).
**Do:** label the axis **"Depth (µm)"** with the µm min→max; verify the depth sign so
"downward = deeper" on the live session. **[DECISION]** proportional-µm spacing (vs rank) —
low value for uniform NPX; skip unless a non-uniform probe appears.
**Acceptance:** `/verify-ui` shows "Depth (µm)", correct range, deepest at bottom. **Effort:** S.

### G3 — [pixecog] loader attaches `region` + µm `depth`
**Exists:** TensorScope's `prepare_linear_probe` can stamp a `region` coord
(`io/assemble.py:80–86`), but the launcher loads NPX via pixecog `load_lfp`, which attaches
`contact_id/DV/connected` — **no anatomical `region`**. Tracks D and V depend on it.
**Do [pixecog]:** in `utils.io`, have `load_lfp(npix)` / `load_aligned` attach a per-channel
`region` coord and a µm `depth` coord (from `DV`) out of the bidsified `electrodes.tsv`
(the sidecar `utils.io.electrodes` validates; `DV` is already read by `npix_index_map`).
Additive, default-on. **[DECISION]** region source column in electrodes.tsv (confirm name).
**Acceptance:** `load_aligned("01","04")["npix"]` carries `region` + µm `depth`; pixecog unit
test; `loading-lfp.md` updated. **Effort:** M (cross-project).

---

## Track D — Depth-map rendering: per-region color + CSD

### D1 — Per-region (cortex/hippocampus) independent color scaling
**Exists:** single **global** 2–98th-pct range across all channels (`colorRange.ts`
`unmaskedRasterRange`, `RasterView.tsx:40–43`). Near-DG hippocampal power (10×+ cortical)
saturates it → cortex washed out.
**Do:** split the range by region (from G3's `region` coord): group channels by region →
per-region independent 2–98th-pct range (extend `colorRange.ts`) → render each region's
contiguous depth block with its own scale (`RasterView`) → a region gutter (labeled bands
on the depth axis) + per-region colorbar. **[DECISION]** split source = `region` labels;
fallback = a user depth threshold.
**Acceptance:** cortical detail visible **at the same time** as strong HPC ripples
(before/after screenshot); region bands label cortex vs hippocampus. **Effort:** M.

### D2 — CSD: proper iCSD + diverging zero-centered colormap
**Exists:** a `csd` view_type + LFP/CSD toggle (`DepthMapSliceView.tsx:12–39`,
`appStore.depthCsd`), computed as the bare `−d²V/dz²` **second difference**
(`server/state.py:1621–1651`, via `cogpy.depth_probe.csd.compute_csd`) and rendered through
the raster image with the **`viridis` (sequential)** colormap (`RasterView.tsx:111`).
Viridis is wrong for a signed sink/source quantity.
**Do:**
- **Colormap (quick win):** render CSD with a **zero-centered diverging** map and a
  **symmetric ±max** range. pixecog's canonical CSD map is **`RdBu_r`** (red = source,
  blue = sink, white = 0) — `pixecog/derivatives/sharpwaveripple/.../csd_swr_reuse_plot.py:25`
  (`cmap="RdBu_r", vmin=-v, vmax=v`). Add it to `frontend/src/components/views/colormaps.ts`;
  when `view_type==="csd"` use it + symmetric range + a "CSD (µA/mm³)" colorbar centered at 0.
- **Method ([pixecog]-backed):** upgrade server CSD from the second-difference to pixecog's
  **Pettersen delta-iCSD** — `utils.csd.continuous_csd(x, fs, depth_um, band=(0.5,20),
  grid_um=20, gauss_sigma_mm=0.08, method="delta")` → `(depth, time)` µA/mm³, backed by
  `timefrequency.depth.csd_inverse.compute_icsd` (σ=0.3 S/m, 20 µm bins). **[DECISION]** call
  pixecog/cogpy iCSD server-side, or port `compute_icsd` into cogpy `depth_probe.csd`. Needs
  DC-intact LF + true µm spacing (depends on G3).
**[DECISION]** you described "blue-green-red"; pixecog uses the diverging **blue-white-red**
`RdBu_r` (perceptually correct for signed CSD). Confirm diverging (recommended) vs jet-style.
**Acceptance:** CSD renders as a red/blue sink-source dipole (zero=white, symmetric); on a
sharp-wave-ripple the pyramidale sink / radiatum source dipole is visible (matches pixecog's
`csd_swr_reuse.png`). **Effort:** colormap S; iCSD M.

---

## Track E — Event pipeline UX

### E1 — Detected streams appear immediately (1-line server bug)
**Bug:** `run_detector` (`server/routers/events.py:101`) registers the stream but never calls
`state.publish("events_added", …)` — which `post_event_stream` does (`:47`). The frontend
invalidates `["state"]` only on `events_added` (`api/pairingStream.ts:62`), so a
freshly-detected stream never shows in the Events tab without a manual reload.
**Do:** after `state.events.register(stream)` in `run_detector`, call
`state.publish("events_added", event_stream_meta(stream).model_dump())`. Backend test.
**Acceptance:** run a detector → stream appears in the Events tab with no reload. **Effort:** XS.

### E2 — Local/blob detection discoverability (+ register slowwave)
**Exists:** `cogpy_burst` (h-maxima, `h_quantile`) already detects **without a global
threshold** (`core/events/detectors.py:330–351`). `cogpy_slowwave` (adaptive percentile
gates) is defined (`285–327`) but **not registered** on this branch (VERIFY — it is on
longfile).
**Do:** register `cogpy_slowwave`; in the detector UI (`PipelineTabContent.tsx:476–485`)
group/label detectors "local/adaptive (no global threshold)" vs "threshold".
**Acceptance:** dropdown groups burst/slowwave as local; running them yields events that
appear (via E1). **Effort:** S.

---

## Track T — Event table power

**Exists:** click-header **sorting is DONE** (`eventTableSort.ts`, tested three-click cycle).
**Range filtering with per-property histograms is DONE** (E1/E2: `store/eventFilterStore.ts`,
`EventFilterPanel.tsx`, `eventFilterLogic.ts`). Columns hard-capped to first 6
(`EventTableView.tsx:368`). No percentile UI.
**Do:**
- **T1 — toggleable columns:** a column-picker popover over the stream's advertised
  `columns`, persisted per stream (sorting already applies to whatever's shown).
- **T2 — percentile/quantile filtering:** extend `EventFilterPanel` — per property, add
  percentile ticks (50/75/90/95th) on the existing histogram, a **"top X%"** quick-set, and a
  **"[p_lo, p_hi] percentile band"** (e.g. 80–90th). Compute percentiles from loaded records,
  map to the existing `[min,max]` predicate so it reuses `applyEventFilters` untouched.
  **[DECISION]** which properties (default all numeric; highlight power/peak_z/frequency/duration).
**Acceptance:** toggle feature columns; sort by clicking a feature header; "top 10% by power"
and "80–90th percentile" update table + overlays. **Effort:** M.

---

## Track L — Event localization & multi-type

### L1 — Mark the selected event's channel + frequency on the views
**Exists:** event records carry `channel/ap/ml/depth` and `frequency/freq_peak` (normalized
in `eventFilterLogic` aliases) — but the timeseries only draws a **full-height time tick**
(`TimeseriesSliceView.tsx:941`); channel/ap/ml are blocklisted from filters as "structural"
(exactly what we need to localize). No channel highlight, no freq marker.
**Do:** on select/inspect, read the record's channel + freq and (a) **highlight its
channel/depth** — a row/band on timeseries + raster + depth_map, and an electrode highlight on
spatial_map/depth_map at its (ap,ml)/depth; (b) draw a **horizontal frequency line/band** at
`freq_peak` on the spectrogram. Thread the selected record's channel+freq through the
selection/eventStreams stores.
**Acceptance:** jump to a ripple → its NPX depth/channel highlights on the depth map + peak
frequency marked on the spectrogram; jump to an ECoG spindle → its grid site highlights.
**Effort:** M.

### L2 — Multi-type overlay legend
**Exists:** multi-stream overlay already works (pinnedStreams, per-stream colors, coincidence
rings — `TimeseriesSliceView.tsx:904–993`) — but **no legend** on the timeseries; palette caps
at 6 (`eventStreamColors.ts`).
**Do:** a compact stream legend (color→stream name) on the overlay; handle >6 streams.
**Acceptance:** pin SO/spindle/ripple → legend maps colors to types. **Effort:** S.

---

## Track C — Coupling & distributions

### C1 — Joint filter-bank stack (SO / spindle / ripple, IMF-like)
**Exists:** single-band overlay shipped (bandpass param + Band picker Off/Spindle/Ripple/
SlowOsc/Custom; `TimeseriesSliceView.tsx:494`) — raw + one filtered band at the same y-offset.
**Do:** a multi-band **stacked** mode — pick N bands, fetch them (N parallel filtered slices
or one endpoint via the existing bandpass path), render as vertically-separated stacked traces
per channel (EMD/IMF style), shared time axis + legend. **[DECISION]** default bands (SO 0.5–4
/ spindle 11–16 / ripple 100–250 Hz — matches oscillation-coupling-plan).
**Acceptance:** one channel shows raw + SO + spindle + ripple as separate stacked lanes.
**Effort:** L.

### C2 — Event-train (coarse-time raster)
**Exists:** a raster mode exists but it's a channel×time **amplitude** heatmap
(`TimeseriesSliceView.tsx:378–429`), not an event-train.
**Do:** a display mode — X=time, Y=stream (pinned streams), a tick/dot at each event's t
colored by stream; user bin (10 ms / 100 ms / 1 s) for coarse-time density; shares the time
axis. Reuse eventsByStream + eventStreamColors.
**Acceptance:** an event-train lane shows SO/spindle/ripple detections; binning coarsens to
density. **Effort:** M.

### C3 — Event distributions (1-D + joint)
**Exists:** `EventFilterPanel` computes per-property histograms internally (not a standalone
view); `EventAverageView` is an event-locked average, not a distribution.
**Do:** a distributions view — (a) 1-D histograms of any property per stream (reuse the filter
binning); (b) a 2-feature joint **scatter** (user picks X/Y, e.g. frequency×peak_z,
duration×frequency). Respect the active table filters. **[DECISION]** default features + pairs.
**Acceptance:** pick a stream → peak_z/frequency/duration histograms; frequency×peak_z scatter
of the filtered events. **Effort:** M.

---

## Track V — Unified ECoG + NPX view

**Exists:** **"Probe lanes" already shows ECoG + NPX side-by-side** on a shared,
`load_aligned`-aligned time axis with one cursor (PR #1: `viewGridLayout` PROBE_LANES_LAYOUT,
panelTensorOverrides). That's the *stacked-lanes* answer to "show them together."

**Open design question — deeper integration.** Beyond side-by-side, "show them together" can
mean spatial co-registration: which ECoG cortical site sits **above** the NPX probe, linked to
the NPX depth column. pixecog already has the colocation logic:
- `utils.clock_align.pair_ecog_npix(sub, ses, k_sup=12)` → `{proxy_ids: ECoG 3×3 grid
  contact_ids above the probe, sup_idxs: top-K superficial NPX channels, offset_s}`.
- `utils.npix_colocation.pick_superficial_npix / npix_index_map / select_npix_channel` —
  per-session channel/index resolution.

**Proposed designs (pick one to start — [DECISION]):**
1. **Linked-selection (low effort, high value):** clicking an ECoG grid cell highlights the
   co-located NPX depth span (and vice-versa), using `pair_ecog_npix`'s proxy_ids↔sup_idxs
   map stamped onto the tensors at launch. Builds directly on L1's highlight machinery.
2. **Co-registered composite panel:** one panel with the ECoG grid (2-D) + the NPX depth
   column (1-D) in anatomical register (probe ML/AP marked on the grid; depth column extending
   "into" the site above it).
3. **Proxy-over-depth montage:** the ECoG proxy trace (3×3-grid mean above the probe) stacked
   directly above the NPX depth-map/CSD, so cortical LFP → laminar CSD reads as one vertical
   anatomical column (the coupling story: cortical SO ↔ HPC ripple/CSD on one column).

**Recommend:** start with **(1) linked selection** (reuses L1, small), then **(3)
proxy-over-depth montage** for the coupling story.
**[pixecog]** stamp the `pair_ecog_npix` colocation onto the served tensors at launch (or a
`/colocation` endpoint) so the frontend has the ECoG-site↔NPX-depth map.
**Acceptance:** clicking an ECoG site highlights the co-located NPX depth band (design 1); the
proxy-over-depth montage shows cortical LFP above laminar CSD on a shared depth column
(design 3). **Effort:** design 1 = M; design 3 = L.

---

## Phasing (value / correctness first)
- **Phase 1 — correctness + quick wins:** G1 (guard+note), G2 (label/verify), E1 (publish
  fix), E2 (register/label), **D2-colormap** (CSD diverging map). All S/XS, high value.
- **Phase 2 — loader + rendering + table:** G3 [pixecog region/µm] → D1 (per-region color) +
  D2-iCSD; T1 (columns) + T2 (percentile).
- **Phase 3 — localization + coupling + unified:** L1 (channel/freq markers) + L2 (legend);
  V design 1 (linked selection); C1 (filter-bank) + C2 (event-train) + C3 (distributions);
  V design 3 (montage).

## Decisions (owner)
- **[G1]** Reconcile ADR-0012 ML-major vs this branch's AP-major at merge (or adopt now)?
- **[G3/D1]** cortex/hippocampus split source: electrodes.tsv `region` (recommended) vs depth
  threshold; confirm the sidecar column name.
- **[D2]** CSD colormap `RdBu_r` (blue=sink/red=source, recommended) vs jet-style blue-green-red;
  iCSD: reuse pixecog import vs port `compute_icsd` into cogpy.
- **[T2]** which properties get percentile filtering (default all numeric).
- **[C1]** filter-bank default bands (SO 0.5–4 / spindle 11–16 / ripple 100–250 Hz?).
- **[C3]** default distribution features + joint pairs.
- **[V]** which unified-view design first (recommend linked-selection → proxy-over-depth montage).

## Cross-project (pixecog) summary
- **G3:** `load_lfp`/`load_aligned` attach `region` + µm `depth` from electrodes.tsv.
- **D2:** expose `utils.csd.continuous_csd` (Pettersen delta-iCSD, `RdBu_r`) to the serving
  path, or port `compute_icsd` into cogpy.
- **V:** stamp `pair_ecog_npix` colocation onto the served tensors (or a `/colocation` endpoint).
