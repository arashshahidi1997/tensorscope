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

## Reference

**deck.gl layer `transitions` prop for propagation animations** (`modules/core/src/lib/attribute/` `AttributeTransitionManager`): the `transitions` prop on any deck.gl layer triggers GPU-side linear interpolation between old and new attribute buffers with no custom `requestAnimationFrame` loop:

```ts
new ScatterplotLayer({
  transitions: {
    getFillColor: { duration: 400, easing: t => t * (2 - t) },  // ease-out
    getRadius:    { duration: 300, type: 'spring', stiffness: 0.05, damping: 0.7 }
  }
})
```

The animation runs inside a WebGL transform-feedback pass with zero CPU work per frame. For TensorScope's propagation animation: advance `timeCursor` in `SelectionState` at the playback frame rate; the `ScatterplotLayer` interpolates `getFillColor` between successive electrode snapshots automatically. The animation controller's only job is to drive `timeCursor` at the right cadence — deck.gl handles the visual interpolation.

**Critical constraint**: deck.gl `transitions` interpolates between two static prop snapshots; it does not model a continuous time axis. `timeCursor` in `SelectionState` remains the single source of truth. Use `transitions` only for cosmetic smoothing (color fade between frames), not for driving the actual time position.

See [docs/reference-studies/deck-gl.md §2.4, §5](../../reference-studies/deck-gl.md).
