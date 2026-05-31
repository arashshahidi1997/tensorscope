# Neuropixels + ECoG — multi-probe loading & exploration

**Status:** Phase 0 + 1 SHIPPED (2026-05-31, uncommitted on `refactor/contract-v2-phase1`); Phases 2–3 still planned.

**Implemented (verified — 276 backend + 275 frontend tests green, frontend build clean):**
- *Coord-driven geometry* (a refinement of §3): geometry rides on the
  DataArray as a per-channel `depth` coord, so no session-wide probe
  threading is needed — multi-probe sessions get per-tensor geometry for
  free. Grid (AP/ML) tensors are unchanged.
- Backend (`server/state.py`): `available_views` adds `depth_map` for any
  `(time, channel)` tensor carrying a `depth` coord; `electrode_layout`
  returns `geometry="linear"` (n_ml=1, depth-sorted) for such tensors;
  `apply_slice_request` handles the `depth_map` view (collapse time →
  channel profile, depth coord rides along, channels not reordered).
- Adapter (`io/assemble.py`): `prepare_linear_probe(da, depth=, fs=,
  region=, trim_samples=, time_offset_s=)` stamps the depth coord, fs,
  optional region, and a forward-compatible sync offset; `assemble_session`
  validates a `{name: DataArray}` multi-probe dict.
- Frontend: `extractDepthProfile` (arrow.ts) + `DepthMapSliceView` (reuses
  `ChannelGridRenderer` as an N×1 depth strip) + registry wiring;
  `getAvailableViews` now trusts the server's `available_views` when present.
- Tests: `tests/test_neuropixels.py` (8), `frontend/src/api/depthProfile.test.ts` (4).

**Not yet implemented:** Phase 2 (shared session clock + sync-trim applied
at slice time — the adapter *stamps* `time_offset_s` but the slice path
does not yet consume it) and Phase 3 (per-slot tensor binding wired into
queries + "probe lanes" preset). The pixecog-side loader that feeds real
ecog+NP data into this is a separate follow-up (see §9).

---

**Status:** plan — for review
**Created:** 2026-05-31
**Goal:** display both ECoG (iEEG) and Neuropixels (ecephys) data and explore both.
**Builds on:** [`probe-layout.md`](probe-layout.md) (the full geometry
vision — still a proposal) and [`contract-v2.md`](contract-v2.md) Phase 2
(dim-generic selection — not yet shipped). A **minimal `ProbeLayout`
shipped with G7** ([`core/probe_layout.py`](../../src/tensorscope/core/probe_layout.py)),
but it carries **region labels only** — no geometry.

**What the code actually gives us (verified, not assumed):**

- `core/probe_layout.py` is a **region-annotation loader only**:
  `ProbeLayout(electrodes: tuple[Electrode])`, `Electrode{region,
  channel_id, ap, ml, label}`. **No `kind`, no depth/`y`, no positions** —
  its own docstring says the geometry design in `probe-layout.md` "is
  intentionally deferred." So linear/DV geometry must be **added**, not
  reused. It's bound **single-per-session** (`state.probe_layout`) via a
  `probe_layout.json` sidecar + `GET /probe_layout`.
- **Loading is *not* gated by the grid schema** —
  `validate_and_normalize_grid` is referenced only in `core/__init__`,
  `schema.py`, and `tests/`, never in the server load path. So an NP
  `(time, channel)` DataArray **already loads as a tensor today**; it just
  falls into the flat `_VIEW_REGISTRY` bucket (timeseries / navigator /
  psd_live / spectrogram_live / event_average) with **no spatial view**.
  This is the single biggest win — no ingestion/schema fight to load NP.
- `electrode_layout()` ([state.py:236](../../src/tensorscope/server/state.py#L236))
  hard-requires AP/ML and returns `geometry="grid"` — a linear path is missing.
- The frontend already has **`panelTensorOverrides`** (per-slot tensor
  binding) in `appStore` — scaffolding for showing two tensors at once.

So: loading is free; the real work is **adding linear/depth geometry to
ProbeLayout, binding a probe per-tensor, a depth view, and a shared clock.**

## 0. Requirements (from the request)

1. Load Neuropixels with a **DV-only approximation layout** (collapse the
   probe to a single dorsal-ventral depth axis; ignore shank-x / AP/ML).
2. Load **ECoG and Neuropixels simultaneously** when co-recorded.
3. Handle a **synchronization trim** between the two streams.

Confirmed decisions:

- **Input:** both probes are already (or will be pre-converted to)
  xarray / NetCDF. No file-format reader needed — only a thin adapter +
  probe metadata.
- **Display end-state:** simultaneous (both on screen, shared time
  cursor), reached **in phases** — switching first to de-risk, then true
  side-by-side via per-slot tensor binding.
- **Sync trim:** a **known scalar, sample-exact** offset per stream,
  applied as a coordinate transform onto a shared session clock (data on
  disk untouched). Expose both `trim_samples` (int) and `offset_s` (float).

## 1. Where the current code stands

| Capability | Today | Gap for this goal |
|---|---|---|
| Load NP `(time, channel)` | **already loads** — load path doesn't enforce the grid schema; `FlatLFPModality` covers it | none for *loading*; it just has no spatial view |
| ProbeLayout geometry | `core/probe_layout.py` exists but is **region labels only** (no `kind`/depth/positions) | **add** linear/depth geometry to the dataclass + sidecar |
| Per-tensor probe binding | `state.probe_layout` is one object; `GET /probe_layout` returns it | need `tensor_probe: dict[str, ProbeLayout]` so ECoG-grid + NP-linear coexist |
| Spatial view for linear | `_VIEW_REGISTRY` `(time, channel)` → no spatial; `electrode_layout` **raises** without AP/ML ([state.py:236](../../src/tensorscope/server/state.py#L236)) | add a depth view + a linear `electrode_layout` path |
| Multi-tensor session | `create_server_state(dict[str, DataArray])` registers all; `panelTensorOverrides` exists frontend-side | one `active_tensor`; per-slot queries not yet wired to overrides |
| Time / clock | `fs` inferred from `time` coord; **no offset/trim/start-time anywhere** | per-tensor offset + a shared session clock |
| `fs` | inferred from time coord, or `_ensure_fs` for detectors | NP LFP fs (~2.5 kHz) ≠ ECoG (~1.25 kHz) — must stay per-tensor |

## 2. Data contract (Phase 0 — ingestion adapter)

A small `tensorscope.io.assemble` helper (pure, no server deps) that takes
already-loaded DataArrays and returns a validated multi-tensor session
dict. No new file readers.

**Neuropixels (DV-only):** `(time, channel)` with

- coord `depth` (µm, one value per channel) — the DV approximation axis.
- coord `region` (optional, str per channel) — anatomical tag for labels.
- attr `fs` (Hz), attr `probe_kind = "neuropixels"`.
- sync attrs: `trim_samples` (int) and/or `time_offset_s` (float) — see §4.

**ECoG:** unchanged `(time, AP, ML)` (grid). attr `probe_kind = "ecog"`.

**Launcher:** mirror the pixecog audit-launcher pattern — a thin Python
entry (or `tensorscope serve --tensor ecog=a.nc --tensor np=b.nc
--sync np:offset_s=1.234`) that calls
`create_server_state({"ecog": da_ecog, "neuropixels": da_np})`. The
first tensor stays the initial active one.

## 3. Geometry + per-tensor binding + a depth view (Phase 1)

The shipped `ProbeLayout` is region-only, so step one is to **add
geometry**, then **bind a probe per-tensor** and **make `linear` drive a view**.

- **Add geometry to `ProbeLayout`.** Extend `Electrode` with an optional
  `depth` (µm; or reuse `y`) and `ProbeLayout` with
  `kind: "grid" | "linear" = "grid"` (default keeps G7 region sidecars
  valid). For NP, `kind="linear"` + per-electrode `depth` is the DV
  approximation. Cheapest alternative if you'd rather not touch the
  dataclass: carry `depth` as a per-channel coord on the DataArray and
  read it directly — but putting it on `ProbeLayout` keeps geometry in one
  place and is forward-compatible with `probe-layout.md`.
- **Per-tensor binding.** Replace the single `state.probe_layout` with
  `tensor_probe: dict[str, ProbeLayout]` on `ServerState` (keep
  `probe_layout` as a deprecated alias that maps to the active tensor for
  one release). Discovery: `cli.py` already finds `*.probe.json` next to
  the data; for a bundle, match each `<tensor>.probe.json` to its tensor.
  `GET /probe_layout` → `GET /tensors/{name}/probe_layout`.
- **Linear `electrode_layout`.** Add a branch to `electrode_layout`
  ([state.py:236](../../src/tensorscope/server/state.py#L236)): if the
  tensor has a bound `linear` ProbeLayout (or a `depth`/`y` channel coord),
  return a 1-D depth layout instead of raising on missing AP/ML.
- **View availability by geometry.** Today `_VIEW_REGISTRY` keys on dims
  only, so `(time, channel)` gets no spatial view regardless of probe.
  Make availability also consult the bound probe's `kind` — a small step
  toward contract-v2 Phase 2's `ViewDef`:
  - `linear` probe on `(time, channel)` → add **`depth_map`** to the flat set.
  - `grid` → unchanged.
- **New `depth_map` view.** Depth-ordered strip — reuse
  `ChannelGridRenderer` with shape `(N, 1)` (channels sorted by the
  probe's `y`/depth), or a `depth × time` heatmap. The linear analogue of
  `spatial_map` (probe-layout open-Q #3). Timeseries orders channels by
  depth; PSD/spectrogram already work on the flat channel axis untouched.
- **No schema change needed for loading** — NP already loads (§1). Only
  *spatial* features need the probe binding above.

**Outcome of Phase 1:** load NP alone, or switch the active tensor
between ECoG and NP — each renders with its own geometry + a depth view.
Delivers "explore both" *sequentially* and de-risks the simultaneous step.

## 4. Shared session clock + sync trim (Phase 2)

**Convention.** Every tensor has a `time_offset_s` such that:

```
session_time = local_time + time_offset_s
```

`time_offset_s` is supplied directly, or derived sample-exactly from the
trim: `time_offset_s = trim_samples / fs` (sign per dataset; documented
at the adapter). Sample-exact means we store `trim_samples` as an `int`
and compute the offset from that tensor's `fs` — never round-tripping
through a lossy float window.

**Application (at slice time, in `apply_slice_request`).** The selection
store's `time_range` / cursor are **session time**. For tensor *T* with
offset *o*:

1. Translate request → local: `local_range = [s0 - o, s1 - o]`.
2. Slice *T* in its own clock (its own `fs`, untouched data).
3. Re-stamp the returned `time` coord to session time: `coord + o`.

So all views, the persistent cursor, and the **cross-view crosshair**
(from the recent gesture work) operate in one shared clock and line up
across probes. Different `fs` per tensor is irrelevant — the session
clock is in seconds.

**Edge cases (specified):**

- Requested window outside a tensor's available local range → clamp to
  the overlap and set `meta.warnings += ["partial overlap"]`; empty
  overlap → empty slice + explicit warning (no silent blank).
- `trim_samples` + `fs` mismatch (e.g. fs missing) → 400 with a clear
  message; never guess.
- Offset stored in `ServerState.tensor_sync`, settable via a new
  `PUT /api/v1/tensors/{name}/sync {trim_samples?, time_offset_s?}` so it
  can be tuned live; persists in the session.

**Outcome of Phase 2:** a single time cursor scrubs both streams
correctly; the crosshair aligns ECoG and NP even at different sample rates.

## 5. Simultaneous display (Phase 3 — the goal)

- **Per-slot tensor binding — partly built.** `appStore` already has
  `panelTensorOverrides: Record<slotId, tensorName>` +
  `setPanelTensor`/`clearPanelTensor`. The gap is that
  `WorkspaceMain`/queries still resolve data off the single
  `selectedTensor` — they need to honour the per-slot override. Add a
  **"probe lanes"** layout preset: an ECoG lane (timeseries + spatial_map)
  and an NP lane (timeseries + depth_map), sharing one navigator /
  session-time axis.
- **Queries.** `useSliceQuery` / the v2 hooks key off `selectedTensor`;
  thread the resolved per-slot `tensorName` through so two lanes fetch
  independently (each with its own offset from §4). Views already accept
  decoded data as props — the change is query wiring + `WorkspaceMain`
  orchestration, not the renderers.
- **Shared navigation.** One session-time selection drives both lanes;
  windows are fetched per tensor with their offsets applied. Channel
  cursor / spatial selection stay per-lane (per-probe).

**Outcome of Phase 3:** ECoG and NP visible at once, one time cursor,
aligned crosshair — `/goal` met.

## 6. Out of scope (deferred, with hooks left in)

- **Per-region CMR.** NP spans regions; global CMR mixes them. The slim
  geometry doesn't carry groups yet — start with **per-probe** CMR and
  defer per-region to the full ProbeLayout `ReferenceSpec`
  (probe-layout.md §3). Leave the `region` coord in place so it's ready.
- **Multi-shank / true 2-D NP geometry** — beyond the DV approximation.
- **Region labels on the depth map / timeseries** — G7 anatomical-label
  machinery already exists for the grid; extend to `linear` later.
- **Sidecar serialization** of probe metadata (JSON/NWB) — probe-layout.md §4.3.
- **Sync estimation from TTL/barcodes** — not needed (offset is known).

## 7. Phasing & rough effort

| Phase | Deliverable | Effort | Unblocks |
|---|---|---|---|
| 0 | `io.assemble` adapter + multi-tensor/-probe launcher (`<tensor>.probe.json` per tensor) | 0.5–1 d | loading both into one session |
| 1 | add geometry to ProbeLayout + per-tensor binding + linear `electrode_layout` + geometry-aware view registry + `depth_map` view | 4–6 d | NP explores (switching) |
| 2 | shared session clock + sync-trim coord transform + sync API | 2–3 d | aligned time cursor across probes |
| 3 | honour `panelTensorOverrides` in queries + "probe lanes" preset | 3–5 d | **simultaneous display (goal)** |

Estimates are lower than a from-scratch build because schema-free loading
and `panelTensorOverrides` already exist and the ProbeLayout sidecar
scaffolding is in place — but geometry itself still has to be added
(ProbeLayout shipped region-only). Phases 0–2 are independently shippable
and deliver "explore both" sequentially; Phase 3 is the side-by-side end-state.

## 8. Risks / open questions

- **ProbeLayout is region-only today** — no `kind`/geometry (Phase 1
  adds it) and no `ChannelGroup` structure (probe-layout.md §3, needed
  later for per-region CMR). The geometry + per-tensor binding added here
  are forward-compatible; groups can be added to `ProbeLayout` later
  without disturbing them. Keep the default `kind="grid"` so existing G7
  region sidecars keep loading.
- **Frontend single-tensor assumptions.** `selectedTensor` is woven
  through queries and several views; Phase 3 must audit every
  `selectedTensor` read and decide per-slot vs global (navigation =
  global session time; data/geometry = per-slot). ~10–15 call sites.
- **Trim sign convention.** Must be pinned per dataset and asserted in a
  test with a known cross-correlation lag, so a flipped sign is caught.
- **depth_map rendering for 384 ch** — benchmark `ChannelGridRenderer`
  at `(384, 1)`; should be fine but verify (probe-layout.md §9 risk).

## 9. Feeding real pixecog ecog+NP data (follow-up, lives in pixecog)

The pixecog sub-01/ses-04 recording has both probes (verified survey):

- **iEEG/ECoG**: `raw/sub-01/ses-04/ieeg/sub-01_ses-04_task-free_ieeg.lfp`
  — 256-ch (16×16 grid), 1250 Hz. Load via `cogpy.io.ieeg_io.from_file(path,
  grid=True)` → `(time, AP, ML)` (already how the spindle-audit launcher does it).
- **Neuropixels LF**: `raw/sub-01/ses-04/ecephys/…_recording-lf_ecephys.lfp`
  — 212-ch, 1250 Hz. Load as int16 `(time, channel)`; depth = the `DV` (or
  `y`) column of `…_recording-ap_channels.tsv` (per-channel µm).

**Sync trim convention (from `code/utils/ttl_sync.py`):** *"raw .lfp is
trimmed to start at the first TTL onset … `t_ecog = t_sync - t_first_ttl`."*
Both probes are TTL-aligned to first onset, so for the common case they share
`t=0` and `time_offset_s=0`. Where a residual per-stream offset exists, pass it
to `prepare_linear_probe(..., trim_samples=, time_offset_s=)` — sample-exact via
`offset = trim_samples / fs`. Phase 2 then applies it at slice time.

**Loader sketch (belongs in `pixecog/code/`, not tensorscope):**

```python
from cogpy.io.ieeg_io import from_file as ieeg_from_file
from tensorscope.io.assemble import assemble_session, prepare_linear_probe
from tensorscope.server.app import create_app

ecog = ieeg_from_file(str(IEEG_LFP), grid=True).astype("float32")  # (time, AP, ML)
np_lf = load_np_lf(NP_LF)                  # (time, channel) int16→float32
depth = read_channels_tsv(NP_CHANNELS)["DV"].to_numpy()  # µm, per channel
np_lf = prepare_linear_probe(np_lf, depth=depth, fs=1250.0,
                             trim_samples=TRIM or 0)       # offset stamped for Phase 2

session = assemble_session({"ecog": ecog, "neuropixels": np_lf})
app = create_app(session, tensor_name="ecog")  # ecog active first
```

This yields a session where switching to `neuropixels` shows the depth map +
timeseries; `ecog` keeps its grid views. True side-by-side (both lanes, one
clock) lands with Phase 3.

### 9.1 Events — the assembled manifest (loader SHIPPED 2026-05-31)

pixecog's `manifest_assemble` flow writes one tidy parquet per session bundling
every detector, keyed by a `detection_name` column:

`derivatives/manifest_assemble/events/sub-XX/ses-YY/ieeg/sub-XX_ses-YY_task-*_events.parquet`

**Verified schema** (sub-01/ses-04, 76 MB, **1,897,095 rows, 24 cols, 31 detectors**):
`subject, session, task, detection_name, channel_label, AP, ML, region, device,
t_start, t_peak, t_end, amplitude, peak_z, freq_peak, brainstate, segment_raw_rms,
band_isolation_ratio, prominence, power, area, freq_centroid, common_mode_score,
common_mode_artifact`. `brainstate` ∈ {wake, NREM, MA, NaN}.

**Modality is in the name, not a `probe` column.** There is no `probe` column;
`device` is `ecephys` (NP) / `ieeg` and correlates 1:1 with the `_npx_` vs
`_ieeg_` segment in `detection_name`. So routing keys off detection-name segments.

TensorScope's per-file `_load_events` would collapse all rows into one mixed
stream (it keys on a `t`/`time` column the manifest lacks — it has `t_peak`). The
shipped splitter fixes that:

```python
from tensorscope.io.events import load_events_manifest

ieeg_events = load_events_manifest(MANIFEST, probe="ieeg")   # 16 ieeg detectors
npx_events  = load_events_manifest(MANIFEST, probe="npx")    # 15 npx detectors
# or pick the core detectors and drop _blobs/_mtm_blobs/_global_pool variants:
core = load_events_manifest(MANIFEST,
                            include=["spindle_ieeg_cortex", "ripple_npx_hpc"])
```

`load_events_manifest(path, *, key_col="detection_name", time_col=None,
probe=None, include=None, min_events=1)` (and `split_manifest_dataframe` for an
in-memory df) → `EventRegistry`, one stream per `detection_name`, auto-picking
`t_peak`, per-family colors (ripple/spindle/slowwave/so/delta), preserving every
column so brainstate state-locking and the G5 overlay work off one groupby.
Confirmed on the real file: 31 streams, ieeg→16, npx→15, `spindle_ieeg_cortex`=5914.
Tests: `tests/test_events_manifest.py` (11). Caveat: per-session, not cohort-wide
— `pd.concat` the glob for cross-session.

Wire into the loader sketch above via
`create_app(session, events_registry=ieeg_events, ...)`.
