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
