# Changelog

Notable user-facing changes. Dates are when the work landed on the `master` trunk.

## 2026-06-06 — channel-native geometry + the contract-v2 / ultracode-batch accumulation

`master` was fast-forwarded from `c2d5389` to `fa4c5f3` — **100 commits / 238 files** — promoting
the `refactor/contract-v2-phase1` → `refactor/ultracode-batch` → `prototype/channel-native-geometry`
line onto trunk. Gates at the merge tip: **backend 690 tests · frontend 454 tests · `tsc -b` clean.**
Grouped by theme below; see the linked ADRs / design docs for detail.

### Channel-native geometry — canonical spatial layout ([ADR-0010](docs/adr/0010-channel-native-canonical-geometry.md))
The headline change. Geometry is now **data, not array shape**: the canonical spatial tensor is
`(time, channel)` with per-channel coordinates (`x`/`y`[/`z`/`shank`/`region`], or `depth` for
linear probes). The dense `(time, AP, ML)` grid is demoted to a **detected lattice fast path** for
regular ECoG, not a requirement.

- **Non-rectangular probes are first-class** — a 4-shank Neuropixels, sparse / L-shaped ECoG, or
  SEEG loads, classifies (`core.schema.geometry_kind` → `grid|planar|linear|flat`), and is usable
  across every spatial view, with no dense-lattice padding. `validate_and_normalize_grid` only
  densifies a *complete* lattice; `to_channel_native` demotes a grid losslessly;
  `io.assemble.prepare_planar_probe` stamps arbitrary positions.
- **Faster + smaller for sparse probes** — measured ~**4–8× faster** compute and ~**4× smaller**
  payloads at 25% lattice fill, with zero penalty on dense data ([bench/RESULTS.md](bench/RESULTS.md)).
- **Position-driven spatial views** — `spatial_map`, `psd_spatial`, and `propagation` render as a
  per-electrode scatter (`• dots` or an interpolated `▦ fill` Voronoi surface), with mask greying,
  region rings, cross-view hover highlight, and click-to-select (scrolls the timeseries to the
  electrode). Propagation plays back as an animated scatter (RAF + cursor-sync).
- **Position-aware analysis** — CMR + a positions-derived k-NN graph **spatial-median** run on any
  geometry (`core.geometry`). Linear/depth probes get a **CSD-along-depth** view (`-d²V/dz²`) as an
  LFP↔CSD toggle on the depth panel.
- New: `GET /tensors/{name}/electrodes` (geometry + per-channel positions).

### Spectrogram / spectral
- **Spectral-window decoupling** — the `spectrogram_live` frequency resolution is now fixed by the
  spectral window (`nperseg_s`) and stays constant as you zoom (the compute window is padded ±½
  window and cropped back), instead of shrinking with the view. New `nperseg`/overlap controls; the
  *effective* overlap is surfaced when the segment cap widens the hop.
- Frontend spectrogram **freq-range + window controls** (raise F_max to see ripples; A1).
- Spectrogram time axis aligns with the timeseries; viridis colormap.

### Propagation playback ([ADR-0008](docs/adr/0008-propagation-playback.md))
- **Movie is the default** — preload N frames over the window once, smooth RAF playback that drives
  the global cursor (15 Hz, "⌖ sync"); player/event/strip/tiled modes remain. Perceptual **viridis**
  colormap selector (no hardcoded jet); per-frame color-lock.

### Events & coupling tooling
- **Event property-filter UI** with per-property histograms, per-stream predicates, and an
  apply-seam (E1–E2).
- **Interval-span shading + stream legend** on the timeseries (E3).
- cogpy **slow-wave detector** registered + enriched spindle properties (E4).
- Filtered-band overlay, channel scroll, keyboard event review (review-workflow G1–G3).

### Multi-probe / Neuropixels & depth probes ([neuropixels-multiprobe](docs/design/neuropixels-multiprobe.md))
- **"Probe lanes" layout** — ECoG + Neuropixels on a shared time axis (Tracks C1–C5):
  per-slot tensor routing in the data layer, per-panel channel-mask routing, shared session clock.
- **`depth_map`** — a windowed depth×time image for linear probes (depth-sorted), not a single
  instant; `io.assemble.prepare_linear_probe` adapter.

### Context tracks & trajectory
- **Context-track stack** (brainstate band + scalar lanes e.g. speed) and a **2-D trajectory view**
  for `(time, axis)` position tensors — backend `/tracks` API + `io/tracks.py` and the frontend
  TrackStack / TrajectoryView. NWB-audit launcher.

### Contract-v2 & navigation
- **Contract-v2 wire format** — v1→v2 cutover complete; binary Arrow IPC slices, worker-side decode,
  per-view extractors. ([contract-v2](docs/design/contract-v2.md))
- **Navigation ownership** — client-authoritative cursor/window, stateless slicer
  ([ADR-0009](docs/adr/0009-navigation-ownership.md)); **unified time-transport** single
  `{cursor, window}` source ([ADR-0007](docs/adr/0007-unified-time-transport.md)).

### Layout & UI
- **Functional layout presets** (Overview / Signal+Space / Spectral / Events / Probe lanes),
  rebalanced spatial panels, pruned PSD trio.
- **Dockable / collapsible header**, raster-as-timeseries display mode, time-axis alignment across
  rows, overlay colorbars + `@`-coordinate readouts.
- Aspect-ratio-1 (square) cells for AP×ML spatial heatmaps; per-view **staleness / error badges** (N2).

### Performance
- **Navigation LOD ladder** + per-view result cache + tile overscan — ~22–25× faster timeseries /
  navigator on long recordings, instant revisits, local pans without refetch (perf-navigation P1–P8).
- **Per-channel display normalization computed once** (robust IQR), so trace amplitude is stable
  across pan/zoom instead of "breathing".
- Per-channel z-score in the navigator overview; honest decimation.

### Docs / tooling
- ADR-0010 (channel-native geometry); design docs for spectral-window decoupling, multichannel
  display, oscillation-coupling, roadmap; `bench/` benchmarks + probe launchers
  (`serve_planar_probe.py`, `serve_linear_probe.py`).
- Skills: `/verify-ui`, `/session-wrap`, `/ultra-batch`.
