# Prompt 49: Transform Cache

Read first:

- [00_context.md](./00_context.md)
- [40_transform_registry.md](./40_transform_registry.md)
- [41_derived_tensor_model.md](./41_derived_tensor_model.md)
- [48_computation_workers.md](./48_computation_workers.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: introduce caching for derived tensors.

Scope:

- cache keys
- transform parameter hashing
- reuse of computed tensors

Implementation Tasks:

- define cache-key rules for derived tensors
- specify how transform parameters are hashed or normalized
- describe reuse rules for already computed tensor products
- keep caching aligned with provenance and correctness requirements

Constraints:

- repeated transform requests should reuse cached results only when provenance and parameters match
- do not let caching obscure correctness or metadata traceability
- keep the cache contract separate from view logic

Acceptance Criteria:

- repeated transform requests reuse cached results
- cache keys and parameter hashing are explicit
- cache behavior preserves provenance and correctness

Deliverables:

- prompt-ready transform-cache spec
- explicit cache-key and reuse contract
