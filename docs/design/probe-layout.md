# ProbeLayout / channel-group metadata model

**Status:** proposal — for review
**Author:** agent (drafted 2026-05-02)
**Source review:** [`docs/log/idea/idea-arash-20260502-130000-expert-review.md`](../log/idea/idea-arash-20260502-130000-expert-review.md)
**Driving task:** [`task-probelayout-design-20260502-140000-001.md`](../log/issue/task-probelayout-design-20260502-140000-001.md)

## 1. Problem

TensorScope's data model assumes every recording is a `(time, AP, ML)`
xarray — i.e. a 2-D Utah-style or µECoG grid. The expert review
documents the consequences:

- Tetrodes (`time, shank, ch_on_shank`), Neuropixels (`time, depth` or
  `time, shank, depth`), laminar electrodes (`time, depth`), and
  heterogeneous multi-region recordings (flat channel list) cannot be
  loaded without lying about the geometry.
- `cmrx` medians over **all** channels. Multi-region recordings get
  cross-region structure injected into every trace.
- Per-channel metadata (region, anatomy, colour, show/hide) — the
  load-bearing feature of NeuroScope2 — has nowhere to live.

The current code carries one workaround — `_median_spatial_flat` in
[`server/state.py:541`](../../src/tensorscope/server/state.py) — that
rebuilds a dense AP×ML grid from `(time, channel)` + per-channel AP/ML
coords just so `median_spatialx` can run. That pattern doesn't
generalize and shouldn't be replicated for every other transform.

The core surfaces that hard-code AP/ML today:

| Surface | What's hard-coded |
|---|---|
| `_VIEW_REGISTRY` ([state.py:40](../../src/tensorscope/server/state.py)) | `frozenset({"time","AP","ML"})` keys gate which views are available |
| `apply_slice_request` ([state.py:341](../../src/tensorscope/server/state.py)) | `ap_range`, `ml_range`, `isel(AP=…, ML=…)`, spatial_map / propagation_frame / psd_spatial branches |
| `apply_processing` ([state.py:473](../../src/tensorscope/server/state.py)) | calls `cmrx` (auto-detects AP/ML), branches `median_spatialx` vs `_median_spatial_flat` on dim presence |
| `electrode_layout` ([state.py:137](../../src/tensorscope/server/state.py)) | returns `n_ap`, `n_ml`, ap_coords, ml_coords |
| `zscore_offset` ([state.py:581](../../src/tensorscope/server/state.py)) | stacks AP×ML to channel for offset arithmetic |
| `validate_and_normalize_grid` ([core/schema.py:60](../../src/tensorscope/core/schema.py)) | enforces canonical `(time, AP, ML)`, formula `channel = ap*n_ml + ml` |
| `GridLFPModality` ([core/data/modalities.py:23](../../src/tensorscope/core/data/modalities.py)) | requires exactly `(time, AP, ML)` |
| `SelectionState` / `SelectionDTO` | fields `ap: int`, `ml: int` |
| `TensorSliceRequestDTO` | `ap_range`, `ml_range` |
| Events router `get_event_window` ([routers/events.py:103](../../src/tensorscope/server/routers/events.py)) | query params `ap`, `ml`, filters frame columns |
| Frontend `VIEW_DESCRIPTORS` | `requiredDims: ["AP","ML"]` |
| Frontend `SpatialSelection` | `{ap: 0, ml: 0}` |

Plus the cogpy primitives behind these (`cmrx`, `median_spatialx`,
`zscorex`) auto-detect AP/ML inside cogpy itself, with a flat-channel
fallback in `_median_spatial_flat`.

## 2. Recommendation (committed path)

**Introduce `ProbeLayout` as a sidecar metadata object on `ServerState`,
keyed by tensor name.** The canonical xarray dim becomes
`(time, channel)` for everything that is not already `(time, freq, …)`.
ProbeLayout owns geometry, channel groups, per-group reference scheme,
and per-group display attributes. The 2-D AP/ML grid becomes a *derived
view* of a ProbeLayout (a "grid group" whose channels carry `ap_idx`
and `ml_idx` attributes), not a primary dim.

Why a sidecar and not xarray attrs / accessor:

- `xr.DataArray.attrs` is a `dict[str, Any]` with opaque round-tripping
  through netCDF/zarr. Putting a typed object in there is fragile.
- Multiple tensors in the workspace (raw + derived) share the same
  probe. Storing a single `ProbeLayout` on `ServerState` and looking it
  up by `probe_id` avoids drift between raw and derived tensors.
- Server-side it's a Python object; we can keep a separate
  serialization layer for sidecar files (NWB ElectrodeTable, JSON,
  whatever) without coupling it to in-memory xarray.

Keep `(time, AP, ML)` as a *renderable special case* rather than the
normalized form. The schema still accepts it on input (data is dense,
2-D, regular grid → autogenerate a "grid"-style ProbeLayout). Internally,
`apply_slice_request` always sees `(time, channel)` plus a layout.

Effort estimate: **multi-week** (~2–3 weeks of focused work, not
multi-month). The blast radius is wide but the change is mechanical
once the layout object and the slicing pivot are in place; most of the
work is replumbing existing call sites and updating tests.

## 3. Data model

```python
@dataclass(frozen=True)
class Electrode:
    channel_id: int            # canonical index into the `channel` dim
    position: tuple[float, ...] # 2D (x,y) or 3D (x,y,z) in microns
    group_id: str              # FK into ChannelGroup
    skip: bool = False         # NeuroScope-style skip flag
    label: str | None = None   # optional human label

@dataclass(frozen=True)
class ChannelGroup:
    id: str                    # "ca1", "shank0", "cortex"
    label: str                 # "CA1 pyramidal layer"
    channel_ids: tuple[int, ...]
    region: str | None = None  # anatomical tag, free text
    color: str | None = None   # hex; default from a palette
    fs: float | None = None    # per-group sample rate (LFP vs spike-band)
    parent_id: str | None = None  # for hierarchy: shank → tetrode → channel
    geometry: GroupGeometry | None = None  # see below

@dataclass(frozen=True)
class GroupGeometry:
    """How channels in this group lay out in space."""
    kind: Literal["grid", "linear", "tetrode", "irregular"]
    # for "grid": shape=(n_rows, n_cols), order is row-major over channel_ids
    # for "linear": positions are taken as 1-D depth ordering
    # for "tetrode" / "irregular": positions on Electrode are authoritative
    shape: tuple[int, ...] | None = None
    axis_labels: tuple[str, ...] | None = None  # e.g. ("AP","ML"), ("depth",)

@dataclass(frozen=True)
class ReferenceSpec:
    """How CMR / re-referencing is computed."""
    scheme: Literal["none", "global", "per_group", "custom"]
    # "per_group": median computed within each ChannelGroup
    # "custom": explicit dict[group_id -> list[channel_id] used as ref]
    custom: dict[str, tuple[int, ...]] | None = None

@dataclass(frozen=True)
class ProbeLayout:
    id: str                              # "demo_8x8", "np2_shank0", …
    electrodes: tuple[Electrode, ...]    # ordered by channel_id
    groups: tuple[ChannelGroup, ...]
    reference: ReferenceSpec = ReferenceSpec("global")

    # Derived helpers (lazily computed):
    def channels_for(self, group_id: str) -> np.ndarray: ...
    def grid_for(self, group_id: str) -> tuple[np.ndarray, tuple[str,...]]:
        """Return (channel_id grid, axis_labels) if group has grid geometry."""
    def positions(self, channel_ids=None) -> np.ndarray: ...
```

**Why these choices:**

- `channel_id` (int) is the canonical addressing primitive. Everything
  spatial (positions, group membership, grid coordinates) is metadata
  attached to channels, not separate dims.
- Groups are first-class because they carry the four NeuroScope2-load-
  bearing features in one place: colour, ordering, show/hide (via
  `skip`), per-group references.
- A group can declare `geometry.kind="grid"` and supply `shape` — that
  re-creates the AP×ML view on demand, without making AP/ML a
  workspace-wide assumption.
- `ReferenceSpec` is a separate object so the "per-region CMR" change
  is a one-line config edit, not a code change.
- Sample rate per group lets us hold LFP and spike-band data in one
  ProbeLayout once spike-band lands.

## 4. Schema integration

### 4.1 Where it lives

```python
class ServerState:
    ...
    probes: dict[str, ProbeLayout] = field(default_factory=dict)
    tensor_probe: dict[str, str] = field(default_factory=dict)  # tensor_name -> probe_id
```

- One `ProbeLayout` can be shared by many tensors (raw, filtered,
  z-scored, …). Derived tensors inherit `tensor_probe` from their parent
  unless the transform explicitly produces a different probe (rare —
  e.g. CSD reduces channel count).
- Tensors store only a string reference (`probe_id`) in their xarray
  `.attrs`, so data round-trips through netCDF/zarr without losing the
  link. Full `ProbeLayout` is reconstituted on load.
- For multi-tensor sessions (`create_server_state` accepting a `dict`),
  `tensor_probe` lets each tensor declare its probe. We do **not**
  conflate this with `xr.Dataset`: keep the workspace as a map of
  independent DataArrays.

### 4.2 Canonical dim order

| Modality | Old dims | New dims |
|---|---|---|
| LFP / wideband grid | `(time, AP, ML)` | `(time, channel)` + grid-geometry group |
| LFP flat (already supported) | `(time, channel)` | unchanged |
| Spectrogram grid | `(time, freq, AP, ML)` | `(time, freq, channel)` |
| Spectrogram flat | `(time, freq, channel)` | unchanged |
| PSD spatial | `(freq, AP, ML)` | `(freq, channel)` |

Views that need a 2-D layout (`spatial_map`, `psd_spatial`,
`propagation_frame`) request a *named group* with grid geometry from
the ProbeLayout and reshape on the fly.

### 4.3 Sidecar serialization (out of M9)

Persisting probes is a follow-up. Three plausible targets:

- JSON sidecar (`{tensor}.probe.json`) — simplest, ours to define
- NWB `ElectrodeTable` + `electrode_groups` — buys us NWB compatibility
- NeuroScope `.xml` (cogpy already parses it via
  [`io/xml_io.py`](../../../cogpy/src/cogpy/io/xml_io.py))

Mark this as a separate decision; the in-memory model is what unblocks
M9 work.

## 5. Migration path

`(time, AP, ML)` data must keep working without any user action.

1. **`validate_and_normalize_grid` becomes `normalize_to_channel_dim`.**
   When it sees `(time, AP, ML)`, it:
   - flattens row-major to `(time, channel)` (already the formula in
     `flatten_grid_to_channels`),
   - synthesizes a `ProbeLayout` with one group `id="grid"`, geometry
     `kind="grid"` and `shape=(n_AP, n_ML)`, axis_labels `("AP","ML")`,
   - stores it on `ServerState.probes[probe_id]` and binds the tensor.
2. **Existing per-channel `AP/ML` coord path** (the
   `_median_spatial_flat` workaround) becomes the new normal: we read
   AP/ML coords if present, otherwise use a generic `position` coord,
   otherwise fall back to channel index.
3. **Auto-derived layouts vs user overrides.** If a netCDF has a
   `probe_id` attr and a sidecar exists, use it. Otherwise auto-derive.
   Users can always replace the auto layout via a future
   `PUT /tensors/{name}/layout` (out of scope for M9, but the ServerState
   shape is right).
4. **DTO compatibility.** Keep `SelectionDTO.ap`, `ml` for one release
   as deprecated optional fields that the server resolves to a
   `channel_id` via the bound ProbeLayout. New field is
   `selection.channel_id: int` plus optional `group_id: str` for the
   "active spatial region" (which group `spatial_map` shows).
5. **Frontend.** `SpatialSelection` becomes
   `{channelId: number, groupId: string}`. `ap`/`ml` are derived from
   the active group's grid geometry on the client. View descriptors'
   `requiredDims` shifts to `requiredGroupGeometry: "grid" | "linear"
   | "any"`.

The migration is ordered so each step is independently shippable:
ProbeLayout object → schema normalizer → server slice path → DTOs →
frontend.

## 6. Impact list

### 6.1 Backend

- **`server/state.py`**
  - `_VIEW_REGISTRY` keyed by `(set of non-spatial dims, group geometry)`
    instead of frozensets of dim names.
  - `apply_slice_request`: drop `ap_range/ml_range` branches; introduce
    `group_id`-scoped slicing. For grid geometry: compute (AP, ML)
    indices from group → reshape on the fly for spatial_map /
    propagation_frame / psd_spatial.
  - `apply_processing`:
    - CMR: read `probe.reference`. For `per_group`, compute median per
      group and broadcast back via `channels_for(group_id)`.
    - spatial median: for grid groups, reuse `median_spatialx` after a
      group-local reshape; for non-grid groups, no-op or use
      cogpy's nearest-neighbour median (out of scope here).
  - `electrode_layout`: returns the ProbeLayout itself (or a flattened
    DTO listing groups, geometry, and per-channel positions).
  - `zscore_offset`: operate on `channel` dim uniformly; group-aware
    rendering happens in the view, not the offset math.
  - `_median_spatial_flat`: deleted. The new path replaces it.

- **`core/schema.py`**: `validate_and_normalize_grid` →
  `normalize_to_channel_dim` returning `(DataArray, ProbeLayout)`.
  Old grid path becomes one of three branches (grid → flatten + synth
  layout, flat with positions → synth layout, flat without positions →
  trivial layout with one channel-index group).

- **`core/data/modalities.py`**: `GridLFPModality` and `FlatLFPModality`
  collapse into a single `LFPModality` whose `validate` accepts
  `(time, channel)` and a `ProbeLayout`. `SpectrogramModality` similarly
  unifies.

- **DTOs (`server/models.py`)**:
  - `SelectionDTO`: deprecate `ap`, `ml`; add
    `channel_id: int`, `group_id: str | None`.
  - `TensorSliceRequestDTO`: deprecate `ap_range`, `ml_range`; add
    `channel_range: tuple[int,int] | None`,
    `group_id: str | None`.
  - `ElectrodeLayoutDTO` → `ProbeLayoutDTO` carrying `groups: list[GroupDTO]`,
    `electrodes: list[ElectrodeDTO]`.
  - `ProcessingParamsDTO.cmr`: keep boolean for back-compat; honour
    `probe.reference.scheme` rather than always-global.

- **`core/transforms/builtins.py`**: `_compute_spectrogram` already
  flattens non-time dims; small change to preserve `channel` instead of
  re-expanding to AP/ML. PSD wrappers similarly.

- **Events router**: `get_event_window` `ap`/`ml` query params replaced
  by `channel_id`; events that today carry per-event `ap`/`ml` columns
  carry `channel_id` (cogpy detectors that emit channel-keyed events
  already do).

### 6.2 Frontend

- `selectionStore`: replace `{ap, ml}` with `{channelId, groupId}`.
  Helpers `apFromChannelId(layout, ch)` for views that still want a 2-D
  index.
- `viewRegistry`: `requiredDims` → `requiredGeometry` (`"grid"`,
  `"linear"`, `"any"`).
- `viewGridLayout`: stays the same — the slot grid is independent of
  probe geometry.
- New tab in sidebar: **Probe** (groups list, colour swatches, per-
  group show/hide, reference scheme). Sits alongside Tensors / Events.
- Timeseries view: colour traces by `groupId`, order by group then by
  intra-group position.
- Spatial views: read `getActiveGroup(probe)` and reshape.

### 6.3 Tests

Backend test surface is medium: ~30 tests touch AP/ML, mostly slice
fixtures. The fixture in `tests/conftest.py` should produce both a
2-D grid and a multi-group flat probe so every router test runs both
paths. Frontend: arrow extractors are dim-agnostic already; the
selectionStore tests need rewriting (~10 cases).

## 7. NeuroScope2 alignment — what we get for free

Adopting groups + per-group display attributes lights up several
NeuroScope2 features as configuration, not new code:

| NeuroScope2 feature | How ProbeLayout delivers it |
|---|---|
| Channel show/hide | `Electrode.skip` + `groups[*].channel_ids` filtering at slice time |
| Per-channel / per-group colour | `ChannelGroup.color`; consumed by timeseries renderer |
| Anatomical group ordering (CA1 ▸ DG ▸ CTX) | `ProbeLayout.groups` is an ordered tuple; group `parent_id` enables collapsible hierarchy |
| Per-region CMR | `ReferenceSpec.scheme = "per_group"` |
| Tag detected events with source region | Detector outputs `channel_id`; lookup `group_id` via probe |
| Filter EventTable by region | UI filter on `event.group_id` |
| `.xml` session config import | `cogpy.io.xml_io.read_anat_map` already returns `(id, grp, skip)` rows — direct constructor for `Electrode`/`ChannelGroup` |

What it does **not** auto-deliver: spike raster overlay, click-to-jump-
to-cluster, `.res`/`.clu` readers, free-text annotations layer. Those
are independent surfaces.

## 8. Out of scope

This proposal does not address:

- **Spike-band data** (event times keyed to `(group_id, cluster_id)`).
  ProbeLayout has a hook for it (`group.fs`) but the spike track itself
  is its own design.
- **Behavioural / task data** (position, trial type, opto). Separate
  schema discussion.
- **File-format readers** (`.xml`, `.res`, `.clu`, NWB ElectrodeTable
  importers). The in-memory model unblocks them; the readers are
  follow-on work.
- **CSD / ICA / decomposition views.** Independent of probe metadata,
  except that CSD needs `linear` geometry and per-channel depth.
- **Persistent layout sidecar format.** Sketched in §4.3.
- **Absolute-time semantics** (Unix vs seconds-from-start). Independent.
- **Pipeline.yaml export and persistent transform cache.** Separate
  expert-review item; touches `_processed_cache`, not ProbeLayout.

## 9. Risks

- **Test churn.** ~30 backend tests, ~10 frontend tests. Mechanical but
  not free.
- **Frontend redraw cost.** Today, `spatial_map` reads AP/ML directly
  from the slice payload. After migration, the view reshapes on the
  fly using group geometry. For 8×8 demos this is irrelevant; for large
  probes (e.g. 384-channel Neuropixels mapped to a 2-D depth × shank
  grid) we should benchmark before/after.
- **Round-tripping through netCDF/zarr.** Storing only `probe_id` in
  attrs means a saved tensor reloaded without a sidecar gets a default
  layout. We need a clear "no probe metadata found" fallback (single
  generic group, no geometry → spatial views unavailable).
- **Backwards compatibility for shipped fixtures.** Demo data
  (`data/demo_lfp.nc`) is `(time, AP, ML)`; the schema normalizer's
  auto-derivation must produce the same view behavior on day one.

## 10. Open questions

These need a user decision before implementation starts:

1. **Sidecar file format.** JSON, NWB, or NeuroScope `.xml`? Ranked
   preference: JSON now (ours), NWB later (interop), `.xml` only as an
   importer.
2. **Default reference scheme for legacy `(time, AP, ML)` data.**
   Today CMR is global. After migration the synthesized layout has one
   group, so global == per_group and behaviour is preserved. Confirm
   this is the intended default — i.e. legacy datasets get one big
   group, not auto-split by anatomy (which would require info we don't
   have).
3. **Is `spatial_map` allowed for non-grid groups?** A linear depth
   probe could render `spatial_map` as a 1×N strip. Cheap, useful,
   maybe out of scope for M9.
4. **Multi-probe sessions.** Two distinct probes in one workspace —
   say a Neuropixels shank and a separate tetrode bundle. The model
   above supports it (`tensor_probe` is per-tensor); confirm we want
   the UI to expose probe-switching, or if a single active probe per
   tensor is enough for M9.
5. **Shared positions, separate groups.** In some setups the same
   electrode site participates in two logical groups (LFP-band vs
   spike-band). Current model is one group per electrode. Decide
   whether to allow many-to-many or solve at the tensor level (one
   tensor per band, each with its own ProbeLayout view).
6. **Effort budget.** Is the 2–3 week estimate acceptable for M9, or
   should we ship a narrower v0 (just per-group CMR + grouped colours,
   no geometry refactor) and defer the schema pivot to M10?
