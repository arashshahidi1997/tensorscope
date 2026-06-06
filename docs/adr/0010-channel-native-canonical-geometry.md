# ADR-0010: Channel-Native Canonical Geometry (positions, not a forced AP×ML grid)

**Status:** Accepted (Phase 1 implemented; Phases 2–3 planned)
**Date:** 2026-06-06
**Supersedes (in part):** the "Grid data: (time, AP, ML)" canonical convention in
`core/schema.py` and `CLAUDE.md`.
**Evidence:** [`bench/RESULTS.md`](../../bench/RESULTS.md) (efficiency proof + live validation),
prototype branch `prototype/channel-native-geometry`.

## Context

TensorScope's spatial tensors were canonically `(time, AP, ML)` — a **dense** rectangular
lattice. Real probes are frequently not rectangular: 4-shank Neuropixels, sparse / L-shaped
ECoG, SEEG, linear depth probes. Forcing them onto a dense AP×ML grid:

- **wastes space and compute** in direct proportion to the empty cells — a measured ~4–8× slower
  and ~4× larger payload at 25% lattice fill, because every NaN-padding cell is FFT'd, decimated,
  serialized, and allocated client-side (`bench/RESULTS.md`); on dense data it's a tie.
- **breaks outright** for layouts that don't tile a lattice (`validate_and_normalize_grid` raised).
- buries geometry in the array *shape* instead of as data, so non-grid analysis (per-shank CMR,
  position-aware spatial smoothing, CSD) had nowhere to read positions from.

Meanwhile the compute paths (PSD, spectrogram, CMR, raster) already `reshape(-1)` the grid to a
flat channel axis and forget it — the grid was structural overhead, not a compute requirement.

## Decision

**The canonical spatial representation is channel-native: `(time, channel)` with geometry carried
as per-channel coordinates** (`x`, `y`, optional `z`, `shank`, `region`, or `depth` for linear
probes). **The dense `(time, AP, ML)` grid is demoted to a detected fast path** for genuine dense
lattices (regular ECoG), not the storage requirement.

Consequences of the model:

- Geometry is **data, not shape**. `core.schema.geometry_kind(da)` classifies `grid | planar |
  linear | flat`; `channel_positions` / `core.geometry.resolve_positions` read per-channel `(x, y)`.
- A regular ECoG grid is the special case where positions lie on a lattice → it keeps the
  `(AP, ML)` dims and the `imshow` / propagation fast paths. Nothing about dense-grid behaviour
  regresses.
- Spatial *operations* that need neighbours run over a **positions-derived k-NN graph**
  (`core.geometry.build_knn_adjacency` + `spatial_median_graph`), which subsumes the grid
  neighbourhood (on a lattice, k=9 recovers the 3×3 footprint). CMR is already geometry-agnostic.
- Spatial *views* are routed by geometry: planar → position-driven `ScatterMapView`; grid →
  `ChannelGridRenderer` imshow.
- `validate_and_normalize_grid` no longer *forces* densification — non-lattice flat data is
  accepted channel-native; only a complete lattice is reshaped (back-compat).

## Status of the migration

**Phase 1 — Loadable, analyzable, viewable + canonical contract (DONE):**
- `geometry_kind`, `channel_positions`, relaxed `validate_and_normalize_grid`,
  `prepare_planar_probe`, planar `electrode_layout` + `GET /tensors/{name}/electrodes`.
- positions → k-NN adjacency + `spatial_median_graph`; `apply_processing` routes non-grid
  probes through the graph op.
- `ScatterMapView` + geometry-routed spatial slot; `spatial_map` available for planar probes.
- Live-validated on a 4-shank probe (`bench/serve_planar_probe.py`): loads, scatter renders,
  spatial-median visibly cleans it. Backend 685 / frontend 450 / tsc clean.

**Phase 2 — Parity (DONE):** channel-native `psd_spatial` renders as a freq-selected position
scatter (`PSDSpatialView` self-branches; `extractPSDSpatialChannelFrame` over the `(freq, channel)`
cube → `ScatterMapView`). Scatter interactions: mask greying, hover tooltip + cross-view highlight
(`setHoveredElectrode`), region rings (probe-layout sidecar; inert without one), and
click-to-select (`onPick` → scroll the timeseries to the electrode). Shared `scatterPaint` (opts
API + `computeScatterLayout`).

**Phase 3 — Propagation (DONE for planar):** `propagation_frame`/`propagation_movie` are
advertised for planar probes (the same `(channel,)` frame / `(time, channel)` cube the grid uses).
The frontend plays them as an **animated position scatter**: a shared `paintScatter` helper (also
used by ScatterMapView), `extractChannelFramesV2` (movie cube → per-frame channel values), a
`ScatterMoviePlayer` (preload + RAF + cursor-sync + hover, mirroring the grid movie player), and
`PropagationController` routing planar → a focused movie-only scatter controller. The grid
imshow player is untouched. **Interpolated surface DONE:** a `• dots / ▦ fill` toggle on the
scatter views renders a nearest-electrode (Voronoi) field (`computeNearestMap`, precomputed per
size, recoloured O(W·H) per frame). **CSD-along-depth: backend DONE** — `csd` view computes
-d²V/dz² along a linear probe's depth axis (`_compute_csd_depth`, sign + boundary-drop per
neuroscience convention; mirrors `cogpy.depth_probe.csd`), returned as a depth×time image that
flows through the existing raster/depth_map render. **Remaining (CSD frontend):** expose `csd` in
linear-probe `available_views` + a depth_map↔csd toggle/slot (reuses `RasterView`); deferred
pending a layout-slot decision and a linear-probe to verify against (the prototype probe is
planar).

**Out of scope (explicitly not this ADR):** the Zarr/on-disk chunked-multiscale storage format
(a separate, complementary decision — channel-native is its natural chunk axis); editing cogpy's
grid-locked ops beyond calling its existing adjacency-capable functions.

## Alternatives considered

- **Keep grid canonical, treat channel-native as a niche** — rejected: the efficiency penalty is
  real and grows with probe sparsity, and non-lattice probes (a growing fraction of the data we
  target) simply didn't work.
- **Big-bang: delete AP/ML everywhere** — rejected: high blast radius, regresses the dense-grid
  imshow/propagation/psd_spatial that work well today. The fast-path approach keeps them.
- **Re-derive the grid in every grid view from channel-native** — deferred: more rework than
  keeping `(AP, ML)` dims as the lattice fast path, for no user-visible gain.

## References

- `core/schema.py`, `core/geometry.py`, `io/assemble.py` (`prepare_planar_probe`),
  `server/state.py` (`electrode_layout`, `apply_processing`, `available_views`),
  `server/routers/tensors.py` (`/electrodes`), `frontend/.../ScatterMapView.tsx`.
- `bench/RESULTS.md` — efficiency proof + live-validation outcome.
- [docs/design/neuropixels-multiprobe.md](../design/neuropixels-multiprobe.md) — the coord-driven
  geometry lineage this generalizes.
