# Prompt 45: Coherence Tensor

Read first:

- [00_context.md](./00_context.md)
- [41_derived_tensor_model.md](./41_derived_tensor_model.md)
- [40_transform_registry.md](./40_transform_registry.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: compute pairwise coherence tensors.

Scope:

- channel pair relationships
- frequency-resolved coherence

Implementation Tasks:

- define the transform contract for coherence tensors
- specify how channel-pair structure is represented (sparse vs. dense matrix, indexed pairs)
- describe frequency-resolved output coordinates and metadata
- keep the design scalable enough for large channel sets (256+ channels → 32k+ pairs)

Constraints:

- must support large channel sets without hard-coding dense-matrix assumptions
- do not hard-code small-matrix assumptions into the tensor model
- preserve explicit provenance and compatibility metadata
- coherence values that feed a connectivity view should be output as `Float32Array` (pair × freq) for direct GPU consumption

Acceptance Criteria:

- coherence matrices can be visualized efficiently
- channel-pair and frequency coordinates are explicit
- the tensor contract is compatible with large-channel use cases
- sparse pair indexing is defined in the transform contract, not deferred to view logic

Deliverables:

- prompt-ready coherence-tensor spec
- explicit pairwise structure and scaling assumptions

## Reference

For large channel sets, dense pair matrices become impractical. Deck.gl's `DataFilterExtension` GPU-side filtering pattern applies here: encode the coherence value for each channel pair as a scalar filter value so views can GPU-discard low-coherence pairs without a CPU data copy. Specify `CoherenceTensor.outputSchema` to include a sparse pair index array alongside the value array so views can construct the GPU filter buffer without materialising the full dense matrix.

See [docs/reference-studies/deck-gl.md §2.3](../../reference-studies/deck-gl.md).
