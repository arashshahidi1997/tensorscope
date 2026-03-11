# Prompt 35: Animation Controller

Read first:

- [00_context.md](./00_context.md)
- [34_propagation_view.md](./34_propagation_view.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: create a reusable animation controller.

Scope:

- play/pause
- frame stepping
- time scrubber
- speed control

Implementation Tasks:

- define the reusable playback-control contract
- specify how frame stepping and scrubber semantics map to shared time state
- define speed-control and pause/play behavior
- keep the controller reusable for propagation and future animated views

Constraints:

- animation state must stay aligned with shared time semantics
- do not push playback hot paths through expensive React rerender loops
- keep controller logic separate from spatial rendering logic

Acceptance Criteria:

- `PropagationView` animation remains synchronized with the shared time window
- play/pause, step, scrub, and speed controls are explicit
- controller design is reusable across animated spatial views

Deliverables:

- prompt-ready animation-controller contract
- bounded implementation target for playback synchronization
