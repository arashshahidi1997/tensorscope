# Prompt 34: Propagation View

Read first:

- [00_context.md](./00_context.md)
- [33_phase_power_maps.md](./33_phase_power_maps.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: introduce `PropagationView`.

Scope:

- display spatial activity over time
- render frames from time slices
- color electrodes by signal amplitude or band power

Implementation Tasks:

- define the core view contract for spatial propagation
- specify how time slices become spatial frames
- define supported value mappings for amplitude and band-power views
- keep the view compatible with later animation and renderer work

Constraints:

- do not merge playback controls into the propagation rendering contract
- keep the first propagation view CPU-first
- maintain shared-state alignment for time and event context

Acceptance Criteria:

- user can scrub through time and see spatial propagation
- frame rendering is defined from bounded time slices
- color semantics for amplitude or band power are explicit

Deliverables:

- prompt-ready propagation-view spec
- bounded implementation contract for spatial frame rendering
