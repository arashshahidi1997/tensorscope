# TensorScope M4 Prompt Pack

Milestone: M4 - Analysis And Derived Tensors

Read first:

- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)
- [../../architecture/invariants.md](../../architecture/invariants.md)
- [../context_snapshot.md](../context_snapshot.md)
- [../README.md](../README.md)
- [../tensorscope-m3/README.md](../tensorscope-m3/README.md)

## Milestone purpose

M4 introduces explicit analysis transforms and derived-tensor pipelines.

Primary focus:

- transform registration and discovery
- derived tensor modeling and provenance
- worker-based computation
- analysis-oriented tensors such as spectrogram, PSD, band power, coherence, and event-aligned tensors
- caching and reuse of computed tensor products
- analysis views that consume tensors instead of computing them inline

## What must already exist

- M1 architecture boundaries should be stable
- M2 scalable data and scientific-view contracts should be stable enough to build on
- M3 spatial-view contracts should be clear enough to consume derived tensors
- shared navigation state, registry direction, and renderer constraints should already be in place

## What this milestone should produce

- an explicit transform layer between base tensors and views
- derived tensor contracts with provenance and compatibility metadata
- worker-based computation boundaries for heavier transforms
- reusable caching rules for computed tensors
- analysis views that consume derived tensors as first-class inputs

## Prompt order

1. [00_context.md](./00_context.md)
2. [40_transform_registry.md](./40_transform_registry.md)
3. [41_derived_tensor_model.md](./41_derived_tensor_model.md)
4. [42_spectrogram_tensor.md](./42_spectrogram_tensor.md)
5. [43_psd_tensor.md](./43_psd_tensor.md)
6. [44_bandpower_tensor.md](./44_bandpower_tensor.md)
7. [45_coherence_tensor.md](./45_coherence_tensor.md)
8. [46_event_aligned_tensor.md](./46_event_aligned_tensor.md)
9. [47_state_space_view.md](./47_state_space_view.md)
10. [48_computation_workers.md](./48_computation_workers.md)
11. [49_transform_cache.md](./49_transform_cache.md)

## Recommended workflow for agents

1. Read the architecture doc, invariants, context snapshot, and this README.
2. Confirm M3 assumptions still hold before starting M4 work.
3. Start from [00_context.md](./00_context.md) and then [40_transform_registry.md](./40_transform_registry.md).
4. Keep one bounded transform or derived-tensor concern per run.
5. Update architecture/context docs if M4 changes the tensor, transform, or caching model materially.

## M4 guardrails

- views should consume tensors, not compute them inline
- transform definitions must stay explicit and discoverable
- derived tensors should preserve provenance and compatibility metadata
- worker-based computation should keep the UI thread responsive
- caching should not obscure correctness or provenance

## Exit criteria

Treat M4 as done when:

- transforms are explicit system objects rather than ad hoc logic inside views
- derived tensors behave like first-class tensors for view consumption
- heavier computations run asynchronously
- repeated transform requests can reuse computed results through a clear cache contract
