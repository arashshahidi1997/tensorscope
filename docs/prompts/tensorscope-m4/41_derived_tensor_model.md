# Prompt 41: Derived Tensor Model

Read first:

- [00_context.md](./00_context.md)
- [40_transform_registry.md](./40_transform_registry.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: define a `DerivedTensor` model.

Scope:

- tensor metadata
- parent tensor reference
- transform provenance
- coordinate system compatibility

Implementation Tasks:

- define the minimum metadata needed for derived tensors
- specify how parent tensor and transform provenance are recorded
- describe coordinate compatibility expectations
- keep the model aligned with existing tensor registry and view registry direction

Constraints:

- do not treat derived tensors as second-class view inputs
- preserve enough provenance for reproducibility
- keep compatibility rules explicit
- every derived tensor must be serializable and restorable without re-running its transform

Acceptance Criteria:

- derived tensors behave like base tensors in the view registry
- provenance and parent references are explicit
- coordinate compatibility rules are documented
- derived tensor metadata satisfies a `Trackable`-style contract (toJSON / restoreState / changed signal)

Deliverables:

- prompt-ready `DerivedTensor` contract
- explicit metadata and provenance expectations

## Reference

Neuroglancer's `Trackable` interface (`src/trackable_value.ts`) defines the minimum provenance contract for any persistent session object:

```typescript
interface Trackable {
  toJSON(): any;               // serializable snapshot of parameters + provenance
  restoreState(x: any): void;  // restore from snapshot without re-running transform
  reset(): void;               // clear to initial state
  changed: NullarySignal;      // fires when any tracked field mutates
}
```

Every `DerivedTensor` should implement this so its metadata (input tensor id, transform id, parameters, output coordinate ranges) can be serialized to the session store and restored on reload. This is what makes the cache in `49_transform_cache.md` correct: a cache hit is valid when `toJSON()` of the cached entry matches the incoming request parameters, with no ad hoc hashing needed.

See [docs/reference-studies/neuroglancer.md §4.3](../../reference-studies/neuroglancer.md).

Deck.gl's binary attribute API is relevant to the output contract. Derived tensors feeding spatial views (band power, coherence) should declare typed array outputs — `Float32Array` for continuous values, `Uint8Array` for pre-encoded RGBA colors — so consuming views can pass them directly to GPU attribute slots with zero intermediate JS object allocation. Specify the output dtype as part of `DerivedTensor.outputSchema`.

See [docs/reference-studies/deck-gl.md §2.7](../../reference-studies/deck-gl.md).
