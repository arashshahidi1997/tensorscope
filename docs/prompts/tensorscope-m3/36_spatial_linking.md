# Prompt 36: Spatial Linking

Read first:

- [00_context.md](./00_context.md)
- [32_spatial_selection.md](./32_spatial_selection.md)
- [35_animation_controller.md](./35_animation_controller.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: link spatial views with existing timeseries and spectrogram views.

Scope:

- hover electrode to highlight timeseries
- hover timeseries to highlight electrode
- shared cursor semantics

Implementation Tasks:

- define the shared linking semantics for spatial and non-spatial views
- separate hover/cursor behavior from committed selection behavior where needed
- specify how spatial highlighting propagates across compatible views
- keep the contract aligned with the no-direct-view-calls invariant

Constraints:

- cross-view linking must work without views calling each other directly
- keep shared cursor semantics lightweight
- do not blur committed selection and transient hover semantics

Acceptance Criteria:

- cross-view linking works without views calling each other directly
- hover and highlight semantics are explicit
- spatial linking remains aligned with shared navigation state

Deliverables:

- prompt-ready cross-view spatial-linking contract
- explicit hover and shared-cursor behavior

## Reference

HiGlass has two directly applicable patterns for spatial linking:

**`ViewportTracker2D`** (`app/scripts/ViewportTracker2D.js`): renders a shaded brush rectangle on one view showing what another view is currently displaying. For TensorScope, this maps to: showing the current AP/ML selection as a highlighted region on an overview electrode map while a detail spatial view is open. The 2D tracker subscribes to the linked view's domain changes and redraws the brush to match — it is data-coordinate-aware, not pixel-coordinate.

**Transient hover vs. committed selection**: HiGlass distinguishes `brush` events (live, lightweight) from `brushEnd` (committed, triggers backend requests). Spatial linking in TensorScope should apply the same split: hover-highlight propagates imperatively without touching the selection store; committed spatial selection (click or drag-release) updates `SelectionState.spatial` and triggers slice requests.

See [docs/reference-studies/higlass.md §2.3, §2.8](../../reference-studies/higlass.md).
