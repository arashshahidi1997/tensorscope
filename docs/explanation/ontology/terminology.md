# TensorScope Terminology Observations

This document records naming inconsistencies found by cross-referencing
backend class names, DTO field names, wire protocol strings, and frontend
store fields. Each entry cites where each name appears.
Observations come first; recommendations follow where a fix is warranted.

See [entities.md](entities.md) for entity definitions and
[relationships.md](relationships.md) for the relationship model.

---

## T1. `time` (backend) vs `timeCursor` (frontend) — same concept, two names

| Location | Name | File |
|---|---|---|
| `SelectionState` field | `time: float` | [src/tensorscope/core/state.py](../../../src/tensorscope/core/state.py) |
| `SelectionDTO` wire field | `time: float` | [src/tensorscope/server/models.py](../../../src/tensorscope/server/models.py) |
| `useSelectionStore` field | `timeCursor: number` | [frontend/src/store/selectionStore.ts](../../../frontend/src/store/selectionStore.ts) |

The backend and wire protocol call the selected time point `time`. The
frontend store calls the same concept `timeCursor`. The conversion happens
silently inside `patchFromDTO()` in `selectionStore.ts`. A reader following
`SelectionDTO.time` to the store will not find a field with that name.

**Recommendation:** Rename the frontend field to `time`, matching the DTO.
`timeCursor` carries no additional meaning that `time` does not; the
"cursor" metaphor is already implied by the selection context.

---

## T2. `active_tensor` (backend) vs `selectedTensor` (frontend) — same concept, two names

| Location | Name | File |
|---|---|---|
| `TensorScopeState` field | `active_tensor: str` | [src/tensorscope/core/state.py](../../../src/tensorscope/core/state.py) |
| `StateDTO` field | `active_tensor: str` | [src/tensorscope/server/models.py](../../../src/tensorscope/server/models.py) |
| `useAppStore` field | `selectedTensor: string \| null` | [frontend/src/store/appStore.ts](../../../frontend/src/store/appStore.ts) |

Both refer to the tensor currently in focus for all view queries. The DTO
field `active_tensor` arrives from the server and is read as
`stateQuery.data?.active_tensor` in `WorkspaceMain`, but the store field
holding the same value is `selectedTensor`.

**Recommendation:** Align to one name. `activeTensor` (camelCase of the DTO
name) is the cleaner choice because it matches the server concept precisely.
`selected` implies a user-initiated pick; `active` covers both the initial
server default and subsequent user picks.

---

## T3. `timeWindow` (selection store) vs `time_range` (slice request) — same `[t0, t1]` concept, two names

| Location | Name | File |
|---|---|---|
| `useSelectionStore` field | `timeWindow: [number, number]` | [frontend/src/store/selectionStore.ts](../../../frontend/src/store/selectionStore.ts) |
| `TensorSliceRequestDTO` field | `time_range: [float, float] \| None` | [src/tensorscope/server/models.py](../../../src/tensorscope/server/models.py) |

Both represent the same two-element `[start, end]` time interval. The
frontend constructs `time_range` from `timeWindow` inside
`makeDefaultSliceRequest`. Any code path following the visible window from
store to server must mentally rename the value at the boundary.

**Recommendation:** No code change is strictly required; the conversion is
in one place. However, naming the store field `timeRange` would remove the
translation. `viewportDuration` (a derived scalar) can remain unchanged — it
has no wire equivalent and is a genuinely different concept.

---

## T4. `psd_live` is a server-internal view id, not a renderable frontend view

| Location | Behaviour |
|---|---|
| `_VIEW_REGISTRY` in [src/tensorscope/server/state.py](../../../src/tensorscope/server/state.py) | Listed as a valid view id for `(time, AP, ML)` and `(time, channel)` tensors |
| `TensorMetaDTO.available_views` | Returned to the client as `"psd_live"` |
| `expandPSDLive()` in [frontend/src/components/views/WorkspaceMain.tsx](../../../frontend/src/components/views/WorkspaceMain.tsx) | Immediately replaces `"psd_live"` with `["psd_heatmap", "psd_curve", "psd_spatial"]` |
| `viewRegistry` in [frontend/src/registry/viewRegistry.ts](../../../frontend/src/registry/viewRegistry.ts) | No entry for `"psd_live"`; the three expansion ids are mapped to `PlaceholderSliceView` |

`psd_live` is a protocol artefact, not a view the user can toggle directly.
The three expansion ids exist in `VIEW_DESCRIPTORS` and the slot layout, but
the server knows nothing about them. The implicit split is not documented in
the server's slice handler or the frontend's view registry.

**Recommendation:** Add a comment to `_VIEW_REGISTRY` marking `psd_live` as
a "compute-and-expand" entry, and add a symmetric comment to `expandPSDLive`
naming the contract explicitly. Alternatively, make the server return the
three expanded ids directly and remove the client-side expansion step.

---

## T5. Backend sidebar panel ids vs frontend sidebar tab ids — completely disjoint sets

| Source | Values |
|---|---|
| `LayoutPreset.sidebar_panels` in [src/tensorscope/core/layout.py](../../../src/tensorscope/core/layout.py) | `"selector"`, `"processing"`, `"navigator"`, `"psd_settings"` |
| `SidebarTabId` in [frontend/src/store/layoutStore.ts](../../../frontend/src/store/layoutStore.ts) | `"explore"`, `"graph"`, `"tensors"`, `"events"`, `"pipeline"` |

The two sets share no strings. The backend presets describe a legacy sidebar
panel model that does not match the five-tab sidebar the frontend renders.
The `sidebar_panels` field on `LayoutDTO` is sent to the frontend but appears
to have no consumer in the current codebase.

**Recommendation:** Either remove `sidebar_panels` from `LayoutPreset` and
`LayoutDTO`, or replace its values with the five tab ids the frontend
actually uses. Leaving both sets in place misleads readers who try to
correlate backend preset definitions with the rendered UI.

**Severity: High** — this is the most actionable inconsistency in the
current codebase.

---

## T6. `WorkspaceObject` (frontend) vs `DAGTensorNode` (backend) — parallel concepts, incompatible fields

| Aspect | `WorkspaceObject` (frontend) | `DAGTensorNode` (backend) |
|---|---|---|
| Purpose | Chip-strip UI entry for one tensor | Graph node representing one tensor in the DAG |
| Tensor reference field | `tensorName: string` | `tensor_id: str` |
| Classification field | `type: "source" \| "derived"` | `node_type: "source" \| "derived"` |
| Visibility field | `visible: boolean` | `visible: boolean` |
| File | [frontend/src/store/appStore.ts](../../../frontend/src/store/appStore.ts) | [src/tensorscope/core/transforms/dag.py](../../../src/tensorscope/core/transforms/dag.py) |

`WorkspaceObject` is assembled from `TensorSummaryDTO`, not from
`DAGTensorNodeDTO`, so the two structures never need to be merged. The
divergence is structural rather than a bug; the entities serve different
concerns (UI chip state vs graph topology).

**Observation (no code change required):** A comment in `appStore.ts`
pointing to `DAGTensorNode` as the backend counterpart would aid
cross-layer navigation.

---

## T7. `WorkspaceDAG.get_node_type` vs `DAGTensorNode.node_type` — same attribute name, different discriminants

| Method / field | Return values | Classifies |
|---|---|---|
| `WorkspaceDAG.get_node_type(id)` | `"tensor"` or `"transform"` | Whether a graph node is a tensor-node or a transform-node |
| `DAGTensorNode.node_type` | `"source"` or `"derived"` | Whether a tensor-node is a root or a transform output |

Both use the word `node_type` in adjacent contexts but answer different
questions. A reader calling `get_node_type` and then inspecting
`DAGTensorNode.node_type` on the result will encounter two unrelated
discriminants under the same name.

**Recommendation:** Rename `get_node_type` to `get_graph_node_kind` or
`classify_node` to distinguish the graph-level question ("is this a tensor
or a transform node?") from the tensor-level question ("is this tensor a
source or derived?").

---

## T8. `brainstate` (singular, all uses) vs `brainstates` (plural, storage field)

| Location | Name |
|---|---|
| `ServerState` field | `brainstates: xr.DataArray \| None` |
| Server helper functions | `brainstate_intervals()`, `brainstate_meta()` |
| Router file | `routers/brainstates.py` |
| Frontend DTO types | `BrainstateMetaDTO`, `BrainstateIntervalDTO` |
| Frontend store fields | `brainstateOverlay`, `showHypnogram` |

The storage field is plural because it can conceptually hold data for
multiple state systems, but in practice it holds exactly one `DataArray`.
All other uses — function names, router file, frontend types — are singular.

**Recommendation:** Rename the field to `brainstate` to match the consistent
singular usage everywhere else.

---

## T9. View id strings serve dual roles as layout panel ids — implicit coupling

The strings `"timeseries"`, `"spatial_map"`, `"navigator"`, and so on appear
both as `view_type` values in `TensorSliceRequestDTO` and as keys in
`LayoutPreset.grid_assignments`. There is no explicit type or constant that
declares this dual use.

The coupling is intentional — the slot layout must reference the same ids the
view registry knows — but it is implicit. A rename of any view id requires
changes in at least five locations: `_VIEW_REGISTRY`, `VIEW_DESCRIPTORS`,
`viewGridLayout.ts`, `DEFAULT_SLOT_LAYOUT`, and any layout presets.

**Recommendation:** Define a single canonical source of view id strings
(e.g. a Python `Enum` or TypeScript `as const` array) and reference it in
both the layout and the view registry. This makes the coupling visible and
makes renames safe.

---

## Summary Table

| # | Inconsistency | Severity | Recommendation |
|---|---|---|---|
| T1 | `time` (DTO) vs `timeCursor` (store) | Medium | Rename store field to `time` |
| T2 | `active_tensor` (DTO) vs `selectedTensor` (store) | Medium | Rename store field to `activeTensor` |
| T3 | `time_range` (request) vs `timeWindow` (store) | Low | Rename store field to `timeRange` |
| T4 | `psd_live` expanded silently by client | Medium | Document the protocol contract; or expand server-side |
| T5 | Backend sidebar panel ids disjoint from frontend tab ids | **High** | Align or remove `sidebar_panels` from backend presets |
| T6 | `WorkspaceObject.tensorName` vs `DAGTensorNode.tensor_id` | Low | Add cross-reference comment; no rename needed |
| T7 | `get_node_type` vs `DAGTensorNode.node_type` — different discriminants | Medium | Rename `get_node_type` to `get_graph_node_kind` |
| T8 | `brainstates` (field) vs `brainstate` (everywhere else) | Low | Rename field to `brainstate` |
| T9 | View id strings used as layout panel ids without a shared constant | Low | Introduce a single canonical view-id constant |
