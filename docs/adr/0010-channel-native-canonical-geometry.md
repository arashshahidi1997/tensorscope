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

**Phase 2 — Parity (mostly DONE):** channel-native `psd_spatial` renders as a freq-selected
position scatter — `PSDSpatialView` self-branches on geometry (`extractPSDSpatialChannelFrame`
over the `(freq, channel)` cube → `ScatterMapView`), no WorkspaceMain change. Scatter
interactions: mask greying (Phase 1) + hover tooltip (channel · value) DONE. **Remaining:**
click-to-select-channel (needs a channel-focus path through WorkspaceMain) and region overlay
(needs the probe-layout sidecar; inert without one).

**Phase 3 — Propagation (planned):** position-driven `propagation_frame`/`propagation_movie`
(triangulated/interpolated over `(x, y)`); for linear probes this is CSD-along-depth (cogpy has
`depth_probe/csd`).

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
