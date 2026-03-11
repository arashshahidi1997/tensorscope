# Prompt 32: Spatial Selection

Read first:

- [00_context.md](./00_context.md)
- [30_spatial_layout_model.md](./30_spatial_layout_model.md)
- [31_channel_grid_renderer.md](./31_channel_grid_renderer.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: support spatial selection of electrodes.

Scope:

- click electrode
- multi-select electrodes
- brush spatial region

Implementation Tasks:

- define the shared-state representation for spatial selections
- specify single-select, multi-select, and brush behavior
- describe how spatial selection updates downstream linked views
- keep the contract compatible with current `SelectionState` direction

Constraints:

- selections must update the shared `SelectionState`
- do not create a separate spatial-only coordination mechanism
- keep selection semantics explicit and bounded

Acceptance Criteria:

- selecting an electrode highlights corresponding timeseries channel
- multi-select and region selection behavior are defined
- spatial selection remains aligned with shared navigation state

Deliverables:

- prompt-ready spatial-selection contract
- explicit single-select and multi-select behavior

## Reference

HiGlass §2.8 (2D brush) is already referenced in `00_context.md`. Two additional patterns from the deck.gl study are directly applicable here:

**`DataFilterExtension` for GPU-side linked brushing** (`modules/extensions/src/data-filter/data-filter-extension.ts`): the extension injects a GLSL fragment that discards electrodes whose filter values fall outside `filterRange`. For a brush rectangle, encode each electrode's `(AP, ML)` as a 2-element filter value (`filterSize: 2`), then update `filterRange` from the brush bounds. The `SelectionState.spatial` slice maps directly: `filterRange: [[apMin, apMax], [mlMin, mlMax]]`. Objects outside the range are culled on the GPU without a JS data copy. The optional `filterSoftRange` fades edge electrodes for a smooth transition indicator.

**Single-click via color-encoded picking**: deck.gl's offscreen picking pass returns the electrode object on `onClick` with no hit-test computation on the JS side. Wire to `setSelectedElectrode(info.object.id)`. For Shift+click multi-select, accumulate electrode IDs in `SelectionState.spatial.selectedIds` rather than creating a parallel selection store.

**CPU fallback for spatial selection**: `DataFilterExtension` has no CPU fallback. Keep a JS-side filter path — filter the electrode array in `useSelectionStore` using the same `(apMin, apMax, mlMin, mlMax)` bounds — so spatial selection works in environments without WebGL2. The deck.gl path is an optional performance upgrade, not a correctness requirement.

See [docs/reference-studies/deck-gl.md §2.3, §2.6](../../reference-studies/deck-gl.md).
