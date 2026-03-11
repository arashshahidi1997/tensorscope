# Prompt 18: Event Browser

Read first:

- [00_context.md](./00_context.md)
- [17_linked_crosshair.md](./17_linked_crosshair.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: create a proper event browser.

Scope:

- event stream listing
- event filtering
- click-to-navigate

Implementation Tasks:

- define the event-browser responsibilities inside the workspace shell
- specify filtering controls and result-list behavior
- define how event selection updates shared navigation state
- keep the browser compatible with current event stream APIs

Constraints:

- do not build a full analysis workflow here
- keep event browsing separate from peri-event visualization logic
- avoid duplicating event state in multiple disconnected stores

Acceptance Criteria:

- selecting an event updates shared navigation state
- filtering and stream selection are explicit
- the browser fits the existing shell and details-panel direction

Deliverables:

- prompt for a bounded event-browser implementation pass
- explicit selection and filtering contract

## Reference

Neuroglancer's annotation system (`src/ui/annotations.ts`, `src/annotation/`) is the strongest production reference for TensorScope's event model. The critical lessons:

**Events as typed first-class state, not rendering artifacts.** Each annotation is a typed object (`{ type, position, metadata }`) that is serializable, participates in session state (`toJSON`/`restoreState`), and drives selection state propagation. TensorScope's equivalent: `EventAnnotation { type, time, channel?, metadata }` should be a typed interface that appears in both the event browser list and as an overlay on signal views — not two separate ad hoc implementations.

**Side panel list ↔ overlay rendering are driven by the same object.** Clicking an event in the list highlights its overlay; clicking an overlay selects it in the list. Both update `SelectionState.event`. Keep both views as projections of the same shared event state rather than maintaining parallel event lists.

**Event type registration.** Neuroglancer registers annotation types via a registry; each type has its own render handler. TensorScope's event types (spike, LFP event, behavioral marker) should be registered in the same way — adding a new event type should not require editing core browser or overlay code.

See [docs/reference-studies/neuroglancer.md §2.7](../../reference-studies/neuroglancer.md).

nivo's annotation pipeline (`packages/annotations/`) provides a concrete implementation of the same principle — a three-stage pipeline that keeps event logic declarative and independently testable:

```typescript
// Stage 1: matcher — binds annotations to data positions
type EventMatcher<Datum> = {
  match: (datum: Datum) => boolean;
  annotation: EventAnnotationSpec;
};

// Stage 2: bound — annotation with resolved data coordinates
type BoundEventAnnotation = { event: EventAnnotation; x: number; y: number; };

// Stage 3: computed — annotation with final rendered geometry
type ComputedEventAnnotation = BoundEventAnnotation & {
  noteX: number; noteY: number; linkPath: string;
};

// Pipeline: useEventAnnotations(data, matchers) → BoundAnnotation[]
//           useComputedAnnotations(bound, scales) → ComputedAnnotation[]
```

The key insight: matchers run against data before scales are applied; geometry computation runs after scales are known. This maps cleanly onto TensorScope's event model — spike events are matched against the tensor's time coordinate (data space), then projected to canvas pixels (pixel space) only at render time. Both SVG (`<EventAnnotation>`) and Canvas (`renderEventsToCanvas`) renderers consume the same `ComputedAnnotation[]` output.

For TensorScope, adapt as: `EventAnnotation { type, time, channel?, duration?, metadata }` → `AnnotationMatcher<TensorDatum>[]` → `bindEventAnnotations` → `ComputedEventAnnotation[]` → rendered as a `layers`-based overlay. Adding a new event type (stimulus, epoch boundary, artifact) requires only a new matcher spec and renderer handler — no changes to the annotation pipeline.

See [docs/reference-studies/nivo.md §2B, §2D, §4](../../reference-studies/nivo.md).
